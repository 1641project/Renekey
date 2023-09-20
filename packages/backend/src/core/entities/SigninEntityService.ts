/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { } from '@/models/Blocking.js';
import type { MiSignin } from '@/models/Signin.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class SigninEntityService {
	constructor(
	) {
	}

	@bindThis
	public async pack(
		src: MiSignin,
	) {
		return src;
	}
}

