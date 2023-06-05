import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IdService } from '@/core/IdService.js';
import type { ClipsRepository } from '@/models/index.js';
import { ClipEntityService } from '@/core/entities/ClipEntityService.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 100 },
		isPublic: { type: 'boolean', default: false },
		description: { type: 'string', nullable: true, minLength: 1, maxLength: 2048 },
	},
	required: ['name'],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<'clips/create'> {
	name = 'clips/create' as const;
	constructor(
		@Inject(DI.clipsRepository)
		private clipsRepository: ClipsRepository,

		private clipEntityService: ClipEntityService,
		private roleService: RoleService,
		private idService: IdService,
	) {
		super(async (ps, me) => {
			const currentCount = await this.clipsRepository.countBy({
				userId: me.id,
			});
			if (currentCount > (await this.roleService.getUserPolicies(me.id)).clipLimit) {
				throw new ApiError(this.meta.errors.tooManyClips);
			}

			const clip = await this.clipsRepository.insert({
				id: this.idService.genId(),
				createdAt: new Date(),
				userId: me.id,
				name: ps.name,
				isPublic: ps.isPublic,
				description: ps.description,
			}).then(x => this.clipsRepository.findOneByOrFail(x.identifiers[0]));

			return await this.clipEntityService.pack(clip, me);
		});
	}
}
