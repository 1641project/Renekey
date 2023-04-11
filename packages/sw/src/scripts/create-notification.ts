/*
 * Notification manager for SW
 */
import { swLang } from '@/scripts/lang';
import { cli } from '@/scripts/operations';
import { BadgeNames, PushNotificationDataMap } from '@/types';
import getUserName from '@/scripts/get-user-name';
import { I18n } from '@/scripts/i18n';
import { getAccountFromId } from '@/scripts/get-account-from-id';
import { char2fileName } from '@/scripts/twemoji-base';
import * as url from '@/scripts/url';

const closeNotificationsByTags = async (tags: string[]) => {
	for (const n of (await Promise.all(tags.map(tag => globalThis.registration.getNotifications({ tag })))).flat()) {
		n.close();
	}
};

const iconUrl = (name: BadgeNames) => `/static-assets/tabler-badges/${name}.png`;
/* How to add a new badge:
 * 1. Find the icon and download png from https://tabler-icons.io/
 * 2. vips resize ~/Downloads/icon-name.png vipswork.png 0.4; vips scRGB2BW vipswork.png ~/icon-name.png"[compression=9,strip]"; rm vipswork.png;
 * 3. mv ~/icon-name.png ~/misskey/packages/backend/assets/tabler-badges/
 * 4. Add 'icon-name' to BadgeNames
 * 5. Add `badge: iconUrl('icon-name'),`
 */

export async function createNotification<K extends keyof PushNotificationDataMap>(data: PushNotificationDataMap[K]) {
	const n = await composeNotification(data);

	if (n) {
		return globalThis.registration.showNotification(...n);
	} else {
		console.error('Could not compose notification', data);
		return createEmptyNotification();
	}
}

async function composeNotification(data: PushNotificationDataMap[keyof PushNotificationDataMap]): Promise<[string, NotificationOptions] | null> {
	if (!swLang.i18n) swLang.fetchLocale();
	const i18n = await swLang.i18n as I18n<any>;
	const { t } = i18n;
	switch (data.type) {
		/*
		case 'driveFileCreated': // TODO (Server Side)
			return [t('_notification.fileUploaded'), {
				body: body.name,
				icon: body.url,
				data
			}];
		*/
		case 'notification':
			switch (data.body.type) {
				case 'follow': {
					// users/showの型定義をswos.apiへ当てはめるのが困難なのでapiFetch.requestを直接使用
					const account = await getAccountFromId(data.userId);
					if (!account) return null;
					const userDetail = await cli.request('users/show', { userId: data.body.userId }, account.token);
					return [t('_notification.youWereFollowed'), {
						body: getUserName(data.body.user),
						icon: data.body.user.avatarUrl,
						badge: iconUrl('user-plus'),
						data,
						actions: userDetail.isFollowing ? [] : [
							{
								action: 'follow',
								title: t('_notification._actions.followBack'),
							},
						],
					}];
				}

				case 'mention':
					return [t('_notification.youGotMention', { name: getUserName(data.body.user) }), {
						body: data.body.note.text ?? '',
						icon: data.body.user.avatarUrl,
						badge: iconUrl('at'),
						data,
						actions: [
							{
								action: 'reply',
								title: t('_notification._actions.reply'),
							},
						],
					}];

				case 'reply':
					return [t('_notification.youGotReply', { name: getUserName(data.body.user) }), {
						body: data.body.note.text ?? '',
						icon: data.body.user.avatarUrl,
						badge: iconUrl('arrow-back-up'),
						data,
						actions: [
							{
								action: 'reply',
								title: t('_notification._actions.reply'),
							},
						],
					}];

				case 'renote':
					return [t('_notification.youRenoted', { name: getUserName(data.body.user) }), {
						body: data.body.note.text ?? '',
						icon: data.body.user.avatarUrl,
						badge: iconUrl('repeat'),
						data,
						actions: [
							{
								action: 'showUser',
								title: getUserName(data.body.user),
							},
						],
					}];

				case 'quote':
					return [t('_notification.youGotQuote', { name: getUserName(data.body.user) }), {
						body: data.body.note.text ?? '',
						icon: data.body.user.avatarUrl,
						badge: iconUrl('quote'),
						data,
						actions: [
							{
								action: 'reply',
								title: t('_notification._actions.reply'),
							},
							...((data.body.note.visibility === 'public' || data.body.note.visibility === 'home') ? [
								{
									action: 'renote',
									title: t('_notification._actions.renote'),
								},
							] : []),
						],
					}];

				case 'reaction': {
					let reaction = data.body.reaction;
					let badge: string | undefined;

					if (reaction.startsWith(':')) {
						// カスタム絵文字の場合
						const name = reaction.substring(1, reaction.length - 1);
						badge = `${origin}/emoji/${name}.webp?${url.query({
							badge: '1',
						})}`;
						reaction = name.split('@')[0];
					} else {
						// Unicode絵文字の場合
						badge = `/twemoji-badge/${char2fileName(reaction)}.png`;
					}

					if (badge ? await fetch(badge).then(res => res.status !== 200).catch(() => true) : true) {
						badge = iconUrl('plus');
					}

					const tag = `reaction:${data.body.note.id}`;
					return [`${reaction} ${getUserName(data.body.user)}`, {
						body: data.body.note.text ?? '',
						icon: data.body.user.avatarUrl,
						tag,
						badge,
						data,
						actions: [
							{
								action: 'showUser',
								title: getUserName(data.body.user),
							},
						],
					}];
				}

				case 'receiveFollowRequest':
					return [t('_notification.youReceivedFollowRequest'), {
						body: getUserName(data.body.user),
						icon: data.body.user.avatarUrl,
						badge: iconUrl('user-plus'),
						data,
						actions: [
							{
								action: 'accept',
								title: t('accept'),
							},
							{
								action: 'reject',
								title: t('reject'),
							},
						],
					}];

				case 'followRequestAccepted':
					return [t('_notification.yourFollowRequestAccepted'), {
						body: getUserName(data.body.user),
						icon: data.body.user.avatarUrl,
						badge: iconUrl('circle-check'),
						data,
					}];

				case 'achievementEarned':
					return [t('_notification.achievementEarned'), {
						body: t(`_achievements._types._${data.body.achievement}.title`),
						badge: iconUrl('medal'),
						data,
						tag: `achievement:${data.body.achievement}`,
					}];

				case 'app':
					return [data.body.header ?? data.body.body, {
						body: data.body.header ? data.body.body : '',
						icon: data.body.icon ?? undefined,
						data,
					}];

				default:
					return null;
			}
		case 'unreadAntennaNote':
			return [t('_notification.unreadAntennaNote', { name: data.body.antenna.name }), {
				body: `${getUserName(data.body.note.user)}: ${data.body.note.text ?? ''}`,
				icon: data.body.note.user.avatarUrl,
				badge: iconUrl('antenna'),
				tag: `antenna:${data.body.antenna.id}`,
				data,
				renotify: true,
			}];
		default:
			return null;
	}
}

export async function createEmptyNotification() {
	return new Promise<void>(async res => {
		if (!swLang.i18n) swLang.fetchLocale();
		const i18n = await swLang.i18n as I18n<any>;
		const { t } = i18n;

		await globalThis.registration.showNotification(
			(new URL(origin)).host,
			{
				body: `Misskey v${_VERSION_}`,
				silent: true,
				badge: iconUrl('null'),
				tag: 'read_notification',
				actions: [
					{
						action: 'markAllAsRead',
						title: t('markAllAsRead'),
					},
					{
						action: 'settings',
						title: t('notificationSettings'),
					},
				],
				data: {},
			},
		);

		setTimeout(async () => {
			try {
				await closeNotificationsByTags(['user_visible_auto_notification']);
			} finally {
				res();
			}
		}, 1000);
	});
}
