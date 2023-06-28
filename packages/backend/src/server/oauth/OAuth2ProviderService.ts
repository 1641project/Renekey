import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { JSDOM } from 'jsdom';
import httpLinkHeader from 'http-link-header';
import ipaddr from 'ipaddr.js';
import oauth2orize, { type OAuth2, AuthorizationError, ValidateFunctionArity2, OAuth2Req } from 'oauth2orize';
import oauth2Pkce from 'oauth2orize-pkce';
import fastifyView from '@fastify/view';
import pug from 'pug';
import bodyParser from 'body-parser';
import fastifyExpress from '@fastify/express';
import { verifyChallenge } from 'pkce-challenge';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { kinds } from '@/misc/api-permissions.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { AccessTokensRepository, UsersRepository } from '@/models/index.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import type { LocalUser } from '@/models/entities/User.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import type { FastifyInstance } from 'fastify';

// Follows https://indieauth.spec.indieweb.org/#client-identifier
// This is also mostly similar to https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation
// although Google has stricter rule.
function validateClientId(raw: string): URL {
	// Clients are identified by a [URL].
	const url = ((): URL => {
		try {
			return new URL(raw);
		} catch { throw new AuthorizationError('client_id must be a valid URL', 'invalid_request'); }
	})();

	// Client identifier URLs MUST have either an https or http scheme
	// But then again:
	// https://datatracker.ietf.org/doc/html/rfc6749.html#section-3.1.2.1
	// 'The redirection endpoint SHOULD require the use of TLS as described
	// in Section 1.6 when the requested response type is "code" or "token"'
	const allowedProtocols = process.env.NODE_ENV === 'test' ? ['http:', 'https:'] : ['https:'];
	if (!allowedProtocols.includes(url.protocol)) {
		throw new AuthorizationError('client_id must be a valid HTTPS URL', 'invalid_request');
	}

	// MUST contain a path component (new URL() implicitly adds one)

	// MUST NOT contain single-dot or double-dot path segments,
	const segments = url.pathname.split('/');
	if (segments.includes('.') || segments.includes('..')) {
		throw new AuthorizationError('client_id must not contain dot path segments', 'invalid_request');
	}

	// (MAY contain a query string component)

	// MUST NOT contain a fragment component
	if (url.hash) {
		throw new AuthorizationError('client_id must not contain a fragment component', 'invalid_request');
	}

	// MUST NOT contain a username or password component
	if (url.username || url.password) {
		throw new AuthorizationError('client_id must not contain a username or a password', 'invalid_request');
	}

	// (MAY contain a port)

	// host names MUST be domain names or a loopback interface and MUST NOT be
	// IPv4 or IPv6 addresses except for IPv4 127.0.0.1 or IPv6 [::1].
	if (!url.hostname.match(/\.\w+$/) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		throw new AuthorizationError('client_id must have a domain name as a host name', 'invalid_request');
	}

	return url;
}

interface ClientInformation {
	id: string;
	redirectUris: string[];
	name: string;
}

async function discoverClientInformation(httpRequestService: HttpRequestService, id: string): Promise<ClientInformation> {
	try {
		const res = await httpRequestService.send(id);
		const redirectUris: string[] = [];

		const linkHeader = res.headers.get('link');
		if (linkHeader) {
			redirectUris.push(...httpLinkHeader.parse(linkHeader).get('rel', 'redirect_uri').map(r => r.uri));
		}

		const fragment = JSDOM.fragment(await res.text());

		redirectUris.push(...[...fragment.querySelectorAll<HTMLLinkElement>('link[rel=redirect_uri][href]')].map(el => el.href));

		const name = fragment.querySelector<HTMLElement>('.h-app .p-name')?.textContent?.trim() ?? id;

		return {
			id,
			redirectUris: redirectUris.map(uri => new URL(uri, res.url).toString()),
			name,
		};
	} catch {
		throw new AuthorizationError('Failed to fetch client information', 'server_error');
	}
}

type OmitFirstElement<T extends unknown[]> = T extends [unknown, ...(infer R)]
	? R
	: [];

interface OAuthRequest extends OAuth2Req {
	codeChallenge: string;
	codeChallengeMethod: string;
}

function getQueryMode(issuerUrl: string): oauth2orize.grant.Options['modes'] {
	return {
		query: (txn, res, params): void => {
			// https://datatracker.ietf.org/doc/html/rfc9207#name-response-parameter-iss
			// "In authorization responses to the client, including error responses,
			// an authorization server supporting this specification MUST indicate its
			// identity by including the iss parameter in the response."
			params.iss = issuerUrl;

			const parsed = new URL(txn.redirectURI);
			for (const [key, value] of Object.entries(params)) {
				parsed.searchParams.append(key, value as string);
			}

			return (res as any).redirect(parsed.toString());
		},
	};
}

class OAuth2Store {
	#cache = new MemoryKVCache<OAuth2>(1000 * 60 * 5); // 5min

	load(req: any, cb: (err: Error | null, txn?: OAuth2) => void): void {
		const { transaction_id } = req.body;
		if (!transaction_id) {
			cb(new AuthorizationError('Missing transaction ID', 'invalid_request'));
			return;
		}
		const loaded = this.#cache.get(transaction_id);
		if (!loaded) {
			cb(new AuthorizationError('Failed to load transaction', 'access_denied'));
			return;
		}
		cb(null, loaded);
	}

	store(req: unknown, oauth2: OAuth2, cb: (err: Error | null, transactionID?: string) => void): void {
		const transactionId = secureRndstr(128, true);
		this.#cache.set(transactionId, oauth2);
		cb(null, transactionId);
	}

	remove(req: unknown, tid: string, cb: () => void): void {
		this.#cache.delete(tid);
		cb();
	}
}

@Injectable()
export class OAuth2ProviderService {
	#server = oauth2orize.createServer({
		store: new OAuth2Store(),
	});
	#logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,
		private httpRequestService: HttpRequestService,
		@Inject(DI.accessTokensRepository)
		accessTokensRepository: AccessTokensRepository,
		idService: IdService,
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
		private cacheService: CacheService,
		loggerService: LoggerService,
	) {
		this.#logger = loggerService.getLogger('oauth');

		// XXX: But MemoryKVCache just grows forever without being cleared if grant codes are left unused
		const grantCodeCache = new MemoryKVCache<{
			clientId: string,
			userId: string,
			redirectUri: string,
			codeChallenge: string,
			scopes: string[],
		}>(1000 * 60 * 5); // 5m

		// https://datatracker.ietf.org/doc/html/rfc7636.html
		this.#server.grant(oauth2Pkce.extensions());
		this.#server.grant(oauth2orize.grant.code({
			modes: getQueryMode(config.url),
		}, (client, redirectUri, token, ares, areq, locals, done) => {
			(async (): Promise<OmitFirstElement<Parameters<typeof done>>> => {
				this.#logger.info(`Checking the user before sending authorization code to ${client.id}`);
				const code = secureRndstr(32, true);

				if (!token) {
					throw new AuthorizationError('No user', 'invalid_request');
				}
				const user = await this.cacheService.localUserByNativeTokenCache.fetch(token,
					() => this.usersRepository.findOneBy({ token }) as Promise<LocalUser | null>);
				if (!user) {
					throw new AuthorizationError('No such user', 'invalid_request');
				}

				this.#logger.info(`Sending authorization code on behalf of user ${user.id} to ${client.id} through ${redirectUri}, with scope: [${areq.scope}]`);
				grantCodeCache.set(code, {
					clientId: client.id,
					userId: user.id,
					redirectUri,
					codeChallenge: (areq as OAuthRequest).codeChallenge,
					scopes: areq.scope,
				});
				return [code];
			})().then(args => done(null, ...args), err => done(err));
		}));
		this.#server.exchange(oauth2orize.exchange.authorizationCode((client, code, redirectUri, body, authInfo, done) => {
			(async (): Promise<OmitFirstElement<Parameters<typeof done>> | undefined> => {
				this.#logger.info('Checking the received authorization code for the exchange');
				const granted = grantCodeCache.get(code);
				if (!granted) {
					return;
				}
				grantCodeCache.delete(code);
				if (body.client_id !== granted.clientId) return;
				if (redirectUri !== granted.redirectUri) return;
				if (!body.code_verifier) return;
				if (!(await verifyChallenge(body.code_verifier as string, granted.codeChallenge))) return;

				const accessToken = secureRndstr(128, true);

				const now = new Date();

				// Insert access token doc
				await accessTokensRepository.insert({
					id: idService.genId(),
					createdAt: now,
					lastUsedAt: now,
					userId: granted.userId,
					token: accessToken,
					hash: accessToken,
					name: granted.clientId,
					permission: granted.scopes,
				});

				this.#logger.info(`Generated access token for ${granted.clientId} for user ${granted.userId}, with scope: [${granted.scopes}]`);

				return [accessToken, undefined, { scope: granted.scopes.join(' ') }];
			})().then(args => done(null, ...args ?? []), err => done(err));
		}));
		this.#server.serializeClient((client, done) => done(null, client));
		this.#server.deserializeClient((id, done) => done(null, id));
	}

	@bindThis
	public async createServer(fastify: FastifyInstance): Promise<void> {
		fastify.get('/.well-known/oauth-authorization-server', async (_request, reply) => {
			reply.send({
				issuer: this.config.url,
				authorization_endpoint: new URL('/oauth/authorize', this.config.url),
				token_endpoint: new URL('/oauth/token', this.config.url),
				scopes_supported: kinds,
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code'],
				service_documentation: 'https://misskey-hub.net',
				code_challenge_methods_supported: ['S256'],
				authorization_response_iss_parameter_supported: true,
			});
		});

		// For now only allow the basic OAuth endpoints, to start small and evaluate
		// this feature for some time, given that this is security related.
		fastify.get('/oauth/authorize', async (request, reply) => {
			const oauth2 = (request.raw as any).oauth2 as OAuth2;
			this.#logger.info(`Rendering authorization page for "${oauth2.client.name}"`);

			reply.header('Cache-Control', 'no-store');
			return await reply.view('oauth', {
				transactionId: oauth2.transactionID,
				clientName: oauth2.client.name,
				scope: oauth2.req.scope.join(' '),
			});
		});
		fastify.post('/oauth/decision', async () => { });
		fastify.post('/oauth/token', async () => { });

		fastify.register(fastifyView, {
			root: fileURLToPath(new URL('../web/views', import.meta.url)),
			engine: { pug },
			defaultContext: {
				version: this.config.version,
				config: this.config,
			},
		});

		await fastify.register(fastifyExpress);
		fastify.use('/oauth/authorize', this.#server.authorize(((areq, done) => {
			(async (): Promise<Parameters<typeof done>> => {
				// This should return client/redirectURI AND the error, or
				// the handler can't send error to the redirection URI

				const { codeChallenge, codeChallengeMethod, clientID, redirectURI, scope, type } = areq as OAuthRequest;

				this.#logger.info(`Validating authorization parameters, with client_id: ${clientID}, redirect_uri: ${redirectURI}, scope: ${scope}`);

				const clientUrl = validateClientId(clientID);

				// TODO: Consider allowing this for native apps (RFC 8252)
				// The current setup requires an explicit list of redirect_uris per
				// https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.1.3
				// which blocks the support. But we could loose the rule in this case.
				if (process.env.NODE_ENV !== 'test' || process.env.MISSKEY_TEST_CHECK_IP_RANGE === '1') {
					const lookup = await dns.lookup(clientUrl.hostname);
					if (ipaddr.parse(lookup.address).range() !== 'unicast') {
						throw new AuthorizationError('client_id resolves to disallowed IP range.', 'invalid_request');
					}
				}

				// Find client information from the remote.
				const clientInfo = await discoverClientInformation(this.httpRequestService, clientUrl.href);
				if (!clientInfo.redirectUris.includes(redirectURI)) {
					throw new AuthorizationError('Invalid redirect_uri', 'invalid_request');
				}

				try {
					const scopes = [...new Set(scope)].filter(s => kinds.includes(s));
					if (!scopes.length) {
						throw new AuthorizationError('`scope` parameter has no known scope', 'invalid_scope');
					}
					areq.scope = scopes;

					if (type !== 'code') {
						throw new AuthorizationError('`response_type` parameter must be set as "code"', 'invalid_request');
					}
					if (typeof codeChallenge !== 'string') {
						throw new AuthorizationError('`code_challenge` parameter is required', 'invalid_request');
					}
					if (codeChallengeMethod !== 'S256') {
						throw new AuthorizationError('`code_challenge_method` parameter must be set as S256', 'invalid_request');
					}
				} catch (err) {
					return [err as Error, clientInfo, redirectURI];
				}

				return [null, clientInfo, redirectURI];
			})().then(args => done(...args), err => done(err));
		}) as ValidateFunctionArity2));
		fastify.use('/oauth/authorize', this.#server.errorHandler({
			mode: 'indirect',
			modes: getQueryMode(this.config.url),
		}));
		fastify.use('/oauth/authorize', this.#server.errorHandler());

		fastify.use('/oauth/decision', bodyParser.urlencoded({ extended: false }));
		fastify.use('/oauth/decision', this.#server.decision((req, done) => {
			this.#logger.info(`Received the decision. Cancel: ${!!(req as any).body.cancel}`);
			req.user = (req as any).body.login_token;
			done(null, undefined);
		}));
		fastify.use('/oauth/decision', this.#server.errorHandler());

		// Clients may use JSON or urlencoded
		fastify.use('/oauth/token', bodyParser.urlencoded({ extended: false }));
		fastify.use('/oauth/token', bodyParser.json({ strict: true }));
		fastify.use('/oauth/token', this.#server.token());
		fastify.use('/oauth/token', this.#server.errorHandler());

		// Return 404 for any unknown paths under /oauth so that clients can know
		// whether a certain endpoint is supported or not.
		fastify.all('/oauth/*', async (_request, reply) => {
			reply.code(404);
			reply.send({
				error: {
					message: 'Unknown OAuth endpoint.',
					code: 'UNKNOWN_OAUTH_ENDPOINT',
					id: 'aa49e620-26cb-4e28-aad6-8cbcb58db147',
					kind: 'client',
				},
			});
		});
	}
}
