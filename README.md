# misskey.js
**Strongly-typed official Misskey SDK for browsers/Node.js.**

[![Test](https://github.com/misskey-dev/misskey.js/actions/workflows/test.yml/badge.svg)](https://github.com/misskey-dev/misskey.js/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/misskey-dev/misskey.js/branch/develop/graph/badge.svg?token=PbrTtk3nVD)](https://codecov.io/gh/misskey-dev/misskey.js)

[![NPM](https://nodei.co/npm/misskey-js.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/misskey-js)

JavaScript(TypeScript)用の公式MisskeySDKです。ブラウザ/Node.js上で動作します。

以下が提供されています:
- ユーザー認証
- APIリクエスト
- ストリーミング
- ユーティリティ関数
- Misskeyの各種型定義

## Install
```
npm i misskey-js
```

# Usage
## Authenticate
todo

## API request
``` ts
import * as Misskey from 'misskey-js';

const cli = new Misskey.api.APIClient({
	origin: 'https://misskey.test',
	credential: 'TOKEN',
});

const meta = await cli.request('meta', { detail: true });
```

## Streaming
misskey.jsのストリーミングでは、二つのクラスが提供されます。
ひとつは、ストリーミングのコネクション自体を司る`Stream`クラスと、もうひとつはストリーミングのチャンネルの概念を表す`Channel`クラスです。
ストリーミングを利用する際は、まず`Stream`クラスのインスタンスを初期化し、その後で`Stream`インスタンスのメソッドを利用して`Channel`クラスのインスタンスを取得する形になります。

``` ts
import * as Misskey from 'misskey-js';

const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });
const mainChannel = stream.useChannel('main');
mainChannel.on('notification', notification => {
	console.log('notification received', notification);
});
```

コネクションが途切れても自動で再接続されます。

### チャンネルへの接続
チャンネルへの接続は`Stream`クラスの`useChannel`メソッドを使用します。

パラメータなし
``` ts
const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });

const mainChannel = stream.useChannel('main');
```

パラメータあり
``` ts
const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });

const messagingChannel = stream.useChannel('messaging', {
	otherparty: 'xxxxxxxxxx',
});
```

### チャンネルから切断
`Channel`クラスの`dispose`メソッドを呼び出します。

``` ts
const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });

const mainChannel = stream.useChannel('main');

mainChannel.dispose();
```

### メッセージの受信
`Channel`クラスはEventEmitterを継承しており、メッセージがサーバーから受信されると受け取ったイベント名でペイロードをemitします。

``` ts
import * as Misskey from 'misskey-js';

const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });
const mainChannel = stream.useChannel('main');
mainChannel.on('notification', notification => {
	console.log('notification received', notification);
});
```

### メッセージの送信
`Channel`クラスの`send`メソッドを使用してメッセージをサーバーに送信することができます。

``` ts
import * as Misskey from 'misskey-js';

const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });
const messagingChannel = stream.useChannel('messaging', {
	otherparty: 'xxxxxxxxxx',
});

messagingChannel.send('read', {
	id: 'xxxxxxxxxx'
});
```

### コネクション確立イベント
`Stream`クラスの`_connected_`イベントが利用可能です。

``` ts
import * as Misskey from 'misskey-js';

const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });
stream.on('_connected_', () => {
	console.log('connected');
});
```

### コネクション切断イベント
`Stream`クラスの`_disconnected_`イベントが利用可能です。

``` ts
import * as Misskey from 'misskey-js';

const stream = new Misskey.Stream('https://misskey.test', { token: 'TOKEN' });
stream.on('_disconnected_', () => {
	console.log('disconnected');
});
```

### コネクションの状態
`Stream`クラスの`state`プロパティで確認できます。

- `initializing`: 接続確立前
- `connected`: 接続完了
- `reconnecting`: 再接続中

---

<div align="center">
	<a href="https://github.com/misskey-dev/misskey/blob/develop/CONTRIBUTING.md"><img src="./i-want-you.png" width="300"></a>
</div>
