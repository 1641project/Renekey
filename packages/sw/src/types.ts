import * as Misskey from 'misskey-js';

export type SwMessageOrderType = 'post' | 'push';

export type SwMessage = {
	type: 'order';
	order: SwMessageOrderType;
	loginId: string;
	url: string;
	[x: string]: any;
};

// Defined also @/core/PushNotificationService.ts#L12
type PushNotificationDataSourceMap = {
	notification: Misskey.entities.Notification;
	unreadAntennaNote: {
		antenna: { id: string, name: string };
		note: Misskey.entities.Note;
	};
};

export type PushNotificationData<K extends keyof PushNotificationDataSourceMap> = {
	type: K;
	body: PushNotificationDataSourceMap[K];
	userId: string;
	dateTime: number;
};

export type PushNotificationDataMap = {
	[K in keyof PushNotificationDataSourceMap]: PushNotificationData<K>;
};

export type BadgeNames = 
	'null'
	| 'antenna'
	| 'arrow-back-up'
	| 'at'
	| 'chart-arrows'
	| 'circle-check'
	| 'messages'
	| 'plus'
	| 'quote'
	| 'repeat'
	| 'user-plus'
	| 'users'
	;
