import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IdService } from '@/core/IdService.js';
import type { AnnouncementReadsRepository, AnnouncementsRepository } from '@/models/index.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,

	kind: 'write:account',

	errors: {
		noSuchAnnouncement: {
			message: 'No such announcement.',
			code: 'NO_SUCH_ANNOUNCEMENT',
			id: '184663db-df88-4bc2-8b52-fb85f0681939',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		announcementId: { type: 'string', format: 'misskey:id' },
	},
	required: ['announcementId'],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.announcementsRepository)
		private announcementsRepository: AnnouncementsRepository,

		@Inject(DI.announcementReadsRepository)
		private announcementReadsRepository: AnnouncementReadsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Check if announcement exists
			const announcementExist = await this.announcementsRepository.exist({ where: { id: ps.announcementId } });

			if (!announcementExist) {
				throw new ApiError(meta.errors.noSuchAnnouncement);
			}

			// Check if already read
			const alreadyRead = await this.announcementReadsRepository.exist({
				where: {
					announcementId: ps.announcementId,
					userId: me.id,
				},
			});

			if (alreadyRead) {
				return;
			}

			// Create read
			await this.announcementReadsRepository.insert({
				id: this.idService.genId(),
				createdAt: new Date(),
				announcementId: ps.announcementId,
				userId: me.id,
			});

			if (!await this.userEntityService.getHasUnreadAnnouncement(me.id)) {
				this.globalEventService.publishMainStream(me.id, 'readAllAnnouncements');
			}
		});
	}
}
