import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { Meta } from '@/models/entities/Meta.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { bindThis } from '@/decorators.js';
import { StreamMessages } from '@/server/api/stream/types.js';
import type { OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class MetaService implements OnApplicationShutdown {
	private cache: Meta | undefined;
	private intervalId: NodeJS.Timer;

	constructor(
		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		@Inject(DI.db)
		private db: DataSource,

		private globalEventService: GlobalEventService,
	) {
		//this.onMessage = this.onMessage.bind(this);

		if (process.env.NODE_ENV !== 'test') {
			this.intervalId = setInterval(() => {
				this.fetch(true).then(meta => {
					// fetch内でもセットしてるけど仕様変更の可能性もあるため一応
					this.cache = meta;
				});
			}, 1000 * 60 * 5);
		}

		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);

		if (obj.channel === 'internal') {
			const { type, body } = obj.message as StreamMessages['internal']['payload'];
			switch (type) {
				case 'metaUpdated': {
					this.cache = body;
					break;
				}
				default:
					break;
			}
		}
	}

	@bindThis
	public async fetch(noCache = false): Promise<Meta> {
		if (!noCache && this.cache) return this.cache;

		return await this.db.transaction(async transactionalEntityManager => {
			// 過去のバグでレコードが複数出来てしまっている可能性があるので新しいIDを優先する
			const metas = await transactionalEntityManager.find(Meta, {
				order: {
					id: 'DESC',
				},
			});

			const meta = metas[0];

			if (meta) {
				this.cache = meta;
				return meta;
			} else {
				// metaが空のときfetchMetaが同時に呼ばれるとここが同時に呼ばれてしまうことがあるのでフェイルセーフなupsertを使う
				const saved = await transactionalEntityManager
					.upsert(
						Meta,
						{
							id: 'x',
						},
						['id'],
					)
					.then((x) => transactionalEntityManager.findOneByOrFail(Meta, x.identifiers[0]));

				this.cache = saved;
				return saved;
			}
		});
	}

	@bindThis
	public async update(data: Partial<Meta>): Promise<Meta> {
		const updated = await this.db.transaction(async transactionalEntityManager => {
			const metas = await transactionalEntityManager.find(Meta, {
				order: {
					id: 'DESC',
				},
			});

			const meta = metas[0];

			if (meta) {
				await transactionalEntityManager.update(Meta, meta.id, data);

				const metas = await transactionalEntityManager.find(Meta, {
					order: {
						id: 'DESC',
					},
				});

				return metas[0];
			} else {
				return await transactionalEntityManager.save(Meta, data);
			}
		});

		this.globalEventService.publishInternalEvent('metaUpdated', updated);

		return updated;
	}

	@bindThis
	public dispose(): void {
		clearInterval(this.intervalId);
		this.redisForSub.off('message', this.onMessage);
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
