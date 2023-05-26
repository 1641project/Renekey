import { URL } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { InboxQueue } from '@/core/QueueModule.js';

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<'admin/queue/inbox-delayed'> {
	name = 'admin/queue/inbox-delayed' as const;
	constructor(
		@Inject('queue:inbox') public inboxQueue: InboxQueue,
	) {
		super(async (ps, me) => {
			const jobs = await this.inboxQueue.getJobs(['delayed']);

			const res = [] as [string, number][];

			for (const job of jobs) {
				const host = new URL(job.data.signature.keyId).host;
				if (res.find(x => x[0] === host)) {
					res.find(x => x[0] === host)![1]++;
				} else {
					res.push([host, 1]);
				}
			}

			res.sort((a, b) => b[1] - a[1]);

			return res;
		});
	}
}
