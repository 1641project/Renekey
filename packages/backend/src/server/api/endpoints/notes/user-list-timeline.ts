/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MiNote, NotesRepository, UserListMembershipsRepository, UserListsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { FunoutTimelineService } from '@/core/FunoutTimelineService.js';
import { QueryService } from '@/core/QueryService.js';
import { ApiError } from '../../error.js';
import { Brackets } from 'typeorm';

export const meta = {
	tags: ['notes', 'lists'],

	requireCredential: true,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		noSuchList: {
			message: 'No such list.',
			code: 'NO_SUCH_LIST',
			id: '8fb1fbd5-e476-4c37-9fb0-43d55b63a2ff',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		listId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		includeMyRenotes: { type: 'boolean', default: true },
		includeRenotedMyNotes: { type: 'boolean', default: true },
		includeLocalRenotes: { type: 'boolean', default: true },
		withRenotes: { type: 'boolean', default: true },
		withFiles: {
			type: 'boolean',
			default: false,
			description: 'Only show notes that have attached files.',
		},
	},
	required: ['listId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.userListsRepository)
		private userListsRepository: UserListsRepository,

		@Inject(DI.userListMembershipsRepository)
		private userListMembershipsRepository: UserListMembershipsRepository,

		private noteEntityService: NoteEntityService,
		private activeUsersChart: ActiveUsersChart,
		private cacheService: CacheService,
		private idService: IdService,
		private funoutTimelineService: FunoutTimelineService,
		private queryService: QueryService,

	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			const list = await this.userListsRepository.findOneBy({
				id: ps.listId,
				userId: me.id,
			});

			if (list == null) {
				throw new ApiError(meta.errors.noSuchList);
			}

			const [
				userIdsWhoMeMuting,
				userIdsWhoMeMutingRenotes,
				userIdsWhoBlockingMe,
			] = await Promise.all([
				this.cacheService.userMutingsCache.fetch(me.id),
				this.cacheService.renoteMutingsCache.fetch(me.id),
				this.cacheService.userBlockedCache.fetch(me.id),
			]);

			let noteIds = await this.funoutTimelineService.get(ps.withFiles ? `userListTimelineWithFiles:${list.id}` : `userListTimeline:${list.id}`, untilId, sinceId);
			noteIds = noteIds.slice(0, ps.limit);

			let redisTimeline: MiNote[] = [];

			if (noteIds.length > 0) {
				const query = this.notesRepository.createQueryBuilder('note')
					.where('note.id IN (:...noteIds)', { noteIds: noteIds })
					.innerJoinAndSelect('note.user', 'user')
					.leftJoinAndSelect('note.reply', 'reply')
					.leftJoinAndSelect('note.renote', 'renote')
					.leftJoinAndSelect('reply.user', 'replyUser')
					.leftJoinAndSelect('renote.user', 'renoteUser')
					.leftJoinAndSelect('note.channel', 'channel');

				redisTimeline = await query.getMany();

				redisTimeline = redisTimeline.filter(note => {
					if (note.userId === me.id) {
						return true;
					}
					if (isUserRelated(note, userIdsWhoBlockingMe)) return false;
					if (isUserRelated(note, userIdsWhoMeMuting)) return false;
					if (note.renoteId) {
						if (note.text == null && note.fileIds.length === 0 && !note.hasPoll) {
							if (isUserRelated(note, userIdsWhoMeMutingRenotes)) return false;
							if (ps.withRenotes === false) return false;
						}
					}

					return true;
				});

				redisTimeline.sort((a, b) => a.id > b.id ? -1 : 1);
			}

			if (redisTimeline.length > 0) {
				this.activeUsersChart.read(me);
				return await this.noteEntityService.packMany(redisTimeline, me);
			} else { // fallback to db
				//#region Construct query
				const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
					.innerJoin(this.userListMembershipsRepository.metadata.targetName, 'userListMemberships', 'userListMemberships.userId = note.userId')
					.innerJoinAndSelect('note.user', 'user')
					.leftJoinAndSelect('note.reply', 'reply')
					.leftJoinAndSelect('note.renote', 'renote')
					.leftJoinAndSelect('reply.user', 'replyUser')
					.leftJoinAndSelect('renote.user', 'renoteUser')
					.andWhere('userListMemberships.userListId = :userListId', { userListId: list.id })
					.andWhere('note.channelId IS NULL') // チャンネルノートではない
					.andWhere(new Brackets(qb => {
						qb
							.where('note.replyId IS NULL') // 返信ではない
							.orWhere(new Brackets(qb => {
								qb // 返信だけど投稿者自身への返信
									.where('note.replyId IS NOT NULL')
									.andWhere('note.replyUserId = note.userId');
							}))
							.orWhere(new Brackets(qb => {
								qb // 返信だけど自分宛ての返信
									.where('note.replyId IS NOT NULL')
									.andWhere('note.replyUserId = :meId', { meId: me.id });
							}))
							.orWhere(new Brackets(qb => {
								qb // 返信だけどwithRepliesがtrueの場合
									.where('note.replyId IS NOT NULL')
									.andWhere('userListMemberships.withReplies = true');
							}));
					}));

				this.queryService.generateVisibilityQuery(query, me);
				this.queryService.generateMutedUserQuery(query, me);
				this.queryService.generateBlockedUserQuery(query, me);
				this.queryService.generateMutedUserRenotesQueryForNotes(query, me);

				if (ps.includeMyRenotes === false) {
					query.andWhere(new Brackets(qb => {
						qb.orWhere('note.userId != :meId', { meId: me.id });
						qb.orWhere('note.renoteId IS NULL');
						qb.orWhere('note.text IS NOT NULL');
						qb.orWhere('note.fileIds != \'{}\'');
						qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
					}));
				}

				if (ps.includeRenotedMyNotes === false) {
					query.andWhere(new Brackets(qb => {
						qb.orWhere('note.renoteUserId != :meId', { meId: me.id });
						qb.orWhere('note.renoteId IS NULL');
						qb.orWhere('note.text IS NOT NULL');
						qb.orWhere('note.fileIds != \'{}\'');
						qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
					}));
				}

				if (ps.includeLocalRenotes === false) {
					query.andWhere(new Brackets(qb => {
						qb.orWhere('note.renoteUserHost IS NOT NULL');
						qb.orWhere('note.renoteId IS NULL');
						qb.orWhere('note.text IS NOT NULL');
						qb.orWhere('note.fileIds != \'{}\'');
						qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
					}));
				}

				if (ps.withRenotes === false) {
					query.andWhere(new Brackets(qb => {
						qb.orWhere('note.renoteId IS NULL');
						qb.orWhere(new Brackets(qb => {
							qb.orWhere('note.text IS NOT NULL');
							qb.orWhere('note.fileIds != \'{}\'');
						}));
					}));
				}

				if (ps.withFiles) {
					query.andWhere('note.fileIds != \'{}\'');
				}
				//#endregion

				const timeline = await query.limit(ps.limit).getMany();

				this.activeUsersChart.read(me);

				return await this.noteEntityService.packMany(timeline, me);
			}
		});
	}
}
