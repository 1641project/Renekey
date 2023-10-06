/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type { MiNote } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';

const GLOBAL_NOTES_RANKING_WINDOW = 1000 * 60 * 60 * 24 * 3; // 3日ごと

@Injectable()
export class FeaturedService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis, // TODO: 専用のRedisサーバーを設定できるようにする
	) {
	}

	@bindThis
	private getCurrentWindow(windowRange: number): number {
		const passed = new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime();
		return Math.floor(passed / windowRange);
	}

	@bindThis
	private async updateRankingOf(name: string, windowRange: number, element: string, score = 1): Promise<void> {
		const currentWindow = this.getCurrentWindow(windowRange);
		const redisTransaction = this.redisClient.multi();
		redisTransaction.zincrby(
			`${name}:${currentWindow}`,
			score,
			element);
		redisTransaction.expire(
			`${name}:${currentWindow}`,
			(windowRange * 3) / 1000,
			'NX'); // "NX -- Set expiry only when the key has no expiry" = 有効期限がないときだけ設定
		await redisTransaction.exec();
	}

	@bindThis
	private async getRankingOf(name: string, windowRange: number, limit: number): Promise<string[]> {
		const currentWindow = this.getCurrentWindow(windowRange);
		const previousWindow = currentWindow - 1;

		const [currentRankingResult, previousRankingResult] = await Promise.all([
			this.redisClient.zrange(
				`${name}:${currentWindow}`, 0, limit, 'REV', 'WITHSCORES'),
			this.redisClient.zrange(
				`${name}:${previousWindow}`, 0, limit, 'REV', 'WITHSCORES'),
		]);

		const ranking = new Map<string, number>();
		for (let i = 0; i < currentRankingResult.length; i += 2) {
			const noteId = currentRankingResult[i];
			const score = parseInt(currentRankingResult[i + 1], 10);
			ranking.set(noteId, score);
		}
		for (let i = 0; i < previousRankingResult.length; i += 2) {
			const noteId = previousRankingResult[i];
			const score = parseInt(previousRankingResult[i + 1], 10);
			const exist = ranking.get(noteId);
			if (exist != null) {
				ranking.set(noteId, (exist + score) / 2);
			} else {
				ranking.set(noteId, score);
			}
		}

		return Array.from(ranking.keys());
	}

	@bindThis
	public updateGlobalNotesRanking(noteId: MiNote['id'], score = 1): Promise<void> {
		return this.updateRankingOf('featuredGlobalNotesRanking', GLOBAL_NOTES_RANKING_WINDOW, noteId, score);
	}

	@bindThis
	public updateInChannelNotesRanking(noteId: MiNote['id'], channelId: MiNote['channelId'], score = 1): Promise<void> {
		return this.updateRankingOf(`featuredInChannelNotesRanking:${channelId}`, GLOBAL_NOTES_RANKING_WINDOW, noteId, score);
	}

	@bindThis
	public getGlobalNotesRanking(limit: number): Promise<MiNote['id'][]> {
		return this.getRankingOf('featuredGlobalNotesRanking', GLOBAL_NOTES_RANKING_WINDOW, limit);
	}

	@bindThis
	public getInChannelNotesRanking(channelId: MiNote['channelId'], limit: number): Promise<MiNote['id'][]> {
		return this.getRankingOf(`featuredInChannelNotesRanking:${channelId}`, GLOBAL_NOTES_RANKING_WINDOW, limit);
	}
}
