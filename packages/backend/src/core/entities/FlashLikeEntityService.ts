/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { FlashLikesRepository } from '@/models/index.js';
import type { } from '@/models/entities/Blocking.js';
import type { MiUser } from '@/models/entities/User.js';
import type { MiFlashLike } from '@/models/entities/FlashLike.js';
import { bindThis } from '@/decorators.js';
import { FlashEntityService } from './FlashEntityService.js';

@Injectable()
export class FlashLikeEntityService {
	constructor(
		@Inject(DI.flashLikesRepository)
		private flashLikesRepository: FlashLikesRepository,

		private flashEntityService: FlashEntityService,
	) {
	}

	@bindThis
	public async pack(
		src: MiFlashLike['id'] | MiFlashLike,
		me?: { id: MiUser['id'] } | null | undefined,
	) {
		const like = typeof src === 'object' ? src : await this.flashLikesRepository.findOneByOrFail({ id: src });

		return {
			id: like.id,
			flash: await this.flashEntityService.pack(like.flash ?? like.flashId, me),
		};
	}

	@bindThis
	public packMany(
		likes: any[],
		me: { id: MiUser['id'] },
	) {
		return Promise.all(likes.map(x => this.pack(x, me)));
	}
}

