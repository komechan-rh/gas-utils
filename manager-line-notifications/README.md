# manager-line-notifications

TypeScript、pnpm、clasp を使った Google Apps Script プロジェクトです。
マネージャー向けの LINE グループ通知をまとめて扱います。

- カレンダー通知: GAS 実行アカウント本人の Google カレンダー（デフォルトカレンダー）から今週の予定を取得し、毎週月曜 8:00 に LINE グループへ送信します。また、LINE グループ内で「今週の予定」と発言すると、その場で今週の予定を返信します。
- 給与支払い通知: 給与管理用スプレッドシートから当月（支払い予定日ベース）の支払い情報を取得し、毎月25日 8:00 に LINE グループへ送信します。また、LINE グループ内で「今月の給与」と発言すると、その場で当月の支払い情報を返信します。
- 給与未払いリマインド: 前月（支払い予定日ベース。例: 10月なら9月支払い分＝8月稼働分）の支払い状況が「未済」のままの場合、毎朝10:00 に LINE グループへリマインド通知します（支払い済みなら送信しません）。通知には、このグループで「給与支払い済」と発言すると支払い状況を更新できる旨を添えます。

## セットアップ

```bash
pnpm install
```

1. 新規 GAS プロジェクトを作成する場合は `clasp create --type standalone --title "manager-line-notifications"` を実行します（複数アカウントを使う場合は `--user <name>` を付与）。
2. 既存の GAS プロジェクトへ紐付ける場合は `.clasp.json` を作成し、`scriptId` と `rootDir: "dist"` を設定します。
3. `pnpm run build` で TypeScript をコンパイルします。
4. `pnpm run push` で Apps Script に反映します。
5. Apps Script のブラウザ画面（`pnpm run open`）でスクリプトプロパティを設定します（下記「スクリプトプロパティ」参照）。
6. `setupTrigger` を一度だけ手動実行し、毎週月曜 8:00（カレンダー通知）・毎月25日 8:00（給与支払い通知）・毎朝10:00（給与未払いリマインド）の実行トリガーを登録します。

`.clasp.json` の例:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

## LINE Developers 設定

このプロジェクトは LINE Messaging API を使います。

- 毎週月曜 8:00 に push メッセージ（`https://api.line.me/v2/bot/message/push`）で今週の予定を送信
- 毎月25日 8:00 に push メッセージで当月の給与支払い情報を送信
- 毎朝10:00 に、前月分（支払い予定日ベース）の給与支払い状況が「未済」であれば push メッセージでリマインド通知を送信（`src/index.ts` の `unpaidPayrollReminderToLine`）
- LINE グループ内で「今週の予定」と発言すると、reply メッセージ（`https://api.line.me/v2/bot/message/reply`）でその場で返信（`src/line-webhook.ts` の `doPost`）
- LINE グループ内で「今月の給与」と発言すると、reply メッセージで当月の給与支払い情報をその場で返信
- LINE グループ内で「給与支払い済」と発言すると、支払い状況を「済」に更新（未済のまま残っているリマインド対象月（前月分）があればそちらを優先して更新し、なければ当月分を更新する）
- LINE グループ内で「ID」と発言すると、そのグループの `group_id` を返信（`LINE_GROUP_ID` の設定に使う）
- 発言キーワードとハンドラの対応は `src/line-commands.ts` にまとめている。キーワードを追加する場合はここに追記する

reply 機能を使うため、Webhook は一時的にではなく常時オンにしておく必要があります。

1. [LINE Developers コンソール](https://developers.line.biz/console/) にログインし、Provider を作成します（既にあれば流用）。
2. Provider 内に新規チャネルを作成し、チャネルタイプは **Messaging API** を選択します。
3. 作成したチャネルの「Messaging API設定」タブで、以下を行います。
   - **チャネルアクセストークン（長期）** を発行する → `LINE_CHANNEL_ACCESS_TOKEN` に使用
   - 「応答メッセージ」（LINE公式アカウントのデフォルト応答機能）をオフにする（`doPost` 側の応答と重複させないため）
   - 「Webhookの利用」をオンにする
4. 下記「署名検証用中継のセットアップ」に従い、中継をデプロイしてそのURLをLINEのWebhook URLに登録します。GASのURLへ直接送信する旧構成ではコマンドを実行しません。

5. 作成した Bot を、通知を送りたい LINE グループに招待します（QRコードまたは Bot の LINE ID で友だち追加してからグループに招待）。
6. グループ内で「ID」と発言し、返信された `group_id` を `LINE_GROUP_ID` に使います。
7. 取得したチャネルアクセストークンとグループIDを、GAS のスクリプトプロパティに設定します。

### 署名検証用中継のセットアップ（既存環境も移行が必要）

GAS の `doPost` は `x-line-signature` ヘッダーを取得できません。このため `webhook-relay/worker.mjs`（Cloudflare Workers）でLINE署名を検証し、未加工の本文と署名を `{ lineWebhook: { body, signature } }` としてGASへ渡します。GAS側でもチャネルシークレットで署名を再検証します。中継を通さない偽のPOSTや、本文の改ざんではコマンドを実行できません。

1. LINE Developersの「チャネル基本設定」からチャネルシークレットを取得し、GASの Script Properties と Infisical に `LINE_CHANNEL_SECRET` を追加します（アクセストークンとは別の値）。
2. 新規GASはウェブアプリを「自分として実行・全員」でデプロイします。既存GASは `DEPLOYMENT_ID=<既存ID> CLASP_USER=<alias> pnpm run redeploy` で同じURLのまま更新します。設定同期用の `MANAGER_LINE_WEBAPP_URL` もGASのURLを保持します。
3. Cloudflareアカウントで認証した Wrangler CLI から、以下を実行します。秘密値はコマンド引数やファイルへ記載せず、入力プロンプトに入力してください。

```bash
cd webhook-relay
pnpm dlx wrangler deploy
pnpm dlx wrangler secret put LINE_CHANNEL_SECRET
pnpm dlx wrangler secret put GAS_WEBAPP_URL
```

`LINE_CHANNEL_SECRET` はGASと同じチャネルシークレット、`GAS_WEBAPP_URL` は既存GASの `/exec` URLです。シークレット設定完了までは中継は503を返します。

4. LINE Developers の Webhook URL を発行された **Worker のURL** に変更し、疎通確認を実行します。LINEの空イベント検証は200を返します。GASの認証失敗・例外は中継が502として返します。
5. 設定済みグループで「今週の予定」「今月の給与」を確認します。個別トークや別グループでは業務コマンドが実行されないことを確認します。「ID」のみ、初期設定のため署名済みのグループから利用できます。

設定順の切り替え中は応答が一時停止するため、GASと中継の準備後にLINE側のURLを切り替えてください。運用中のGASコード更新は既存デプロイへの `redeploy` を使います。中継のコード変更時のみ `wrangler deploy` を実行します。GASデプロイを作り直した場合は中継の `GAS_WEBAPP_URL` も更新してください。

`deploy:webhook` は `DEPLOYMENT_ID` で指定した既存GASを更新し、`LINE_WEBHOOK_RELAY_URL` をLINEのWebhook URLへ登録します。初回の中継作成・シークレット設定は上記で行ってください。Infisicalに `LINE_WEBHOOK_RELAY_URL`（WorkerのURL）を登録後、次のように実行できます。

```bash
DEPLOYMENT_ID=<既存ID> CLASP_USER=<alias> pnpm run deploy:webhook
```

### 給与更新の再配信対策

「給与支払い済」は `webhookEventId` ごとに対象のスプレッドシートと支払い月を Script Properties の `PAYROLL_EVENT_<ID>` に永続保存します。Script Lockで同時実行を直列化し、対象月の保存後にシート更新・flush・完了記録を行います。シート更新後に処理が中断されても、再配信では保存済みの同じ月だけを更新します。完了済みなら更新と返信を省略します。返信だけ失敗した場合はシートで結果を確認してください。

記録を削除すると古いイベントの重複防止が失われるため、自動削除しません。Script Propertiesの容量上限に達した場合は、新規記録の保存で失敗し、シートは更新しません。長期運用で記録が増えた場合は、永続ストレージへの移行を検討してください。

## 給与支払いスプレッドシートの設定

給与支払い通知は、以下の構成のスプレッドシートを前提にしています（`src/payroll/sheet.ts`）。

- 「稼働月」というヘッダーを含む行を自動検出し、その行を列ラベル行、1つ上の行を氏名行として扱う
- 列ラベル行に `稼働月` / `支払い予定日` の列がある
- 氏名行で、値が入っている（かつ `空き部屋数` / `支払い状況` ではない）セルを「その人物の合計金額列」として扱う。氏名はコードにハードコードせず、実行時にスプレッドシートから読み取る
- 氏名行に `支払い状況` の列がある
- データ行の `支払い予定日` が当月であるものを、その月の通知対象として1件抽出する

例（ダミー値、列は一部省略）:

```text
氏名行　：|          |        | Aさん | ... | 空き部屋数 | 支払い状況 |
列ラベル行：| 稼働月    | 支払い予定日 | 合計   | ... |           |            |
データ行  ：| 2026/06  | 2026/07/30 | 40000 | ... | 4         | 未済        |
```

## スクリプトプロパティ

Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で以下を設定します。

| キー | 必須 | 値 |
|------|------|----|
| `LINE_GROUP_ID` | 必須 | 送信先 LINE グループのID |
| `LINE_CHANNEL_SECRET` | 必須 | LINEチャネルのシークレット（署名検証用。アクセストークンとは別） |
| `LINE_CHANNEL_ACCESS_TOKEN` | 必須 | LINE Developers で発行したチャネルアクセストークン（長期） |
| `PAYROLL_SPREADSHEET_ID` | 必須 | 給与支払い管理スプレッドシートのID（スプレッドシートURLの `/d/` と `/edit` の間の文字列） |
| `SYNC_SECRET` | 下記「Infisicalによる自動同期」を使う場合のみ必須 | `sync-props` からの同期リクエストを認証する共有シークレット。ランダムな文字列を生成し、Apps Script エディタで手動設定したうえで、同じ値を Infisical にも登録する |

### `doPost` について

このプロジェクトの Web アプリは署名付き中継リクエスト（`lineWebhook`）と、共有シークレットで認証する設定同期リクエスト（`secret` / `properties`）を受け付けます。署名のない `events` 直送では業務コマンドを実行しません。Webhook本文・返信トークンはログへ出力しません。

### Infisical によるスクリプトプロパティの自動同期（任意）

上記の値（`SYNC_SECRET` を除く）を毎回 Apps Script エディタで手入力する代わりに、[Infisical](https://infisical.com/) に登録した値を、上記の `doPost` 経由でスクリプトプロパティへ同期できます。仕組みの詳細は [gmail-inquiry-draft-automation/README.md](../gmail-inquiry-draft-automation/README.md#infisical-によるスクリプトプロパティの自動同期任意) を参照してください。

前提:

- Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で `SYNC_SECRET` にランダムな文字列を手動設定済みであること（初回のみ、Web アプリ経由では設定できない）
- [Infisical CLI](https://infisical.com/docs/cli/overview) をインストール済みで、`infisical login` / `infisical init` をこのディレクトリで実行済みであること
- Infisical 側に、`LINE_GROUP_ID`・`LINE_CHANNEL_ACCESS_TOKEN`・`LINE_CHANNEL_SECRET`・`PAYROLL_SPREADSHEET_ID`・`SYNC_SECRET`（エディタで設定した値と同じもの）・`MANAGER_LINE_WEBAPP_URL`（GAS設定同期用のURL。WorkerのURLではない）を登録済みであること（automationごとにキー名を分けており、フォルダによる分離は行っていない）

実行方法:

```bash
pnpm run sync-props
```

## コマンド

- `pnpm run build` - TypeScript をコンパイルし、`appsscript.json` を `dist/` にコピー
- `pnpm run watch` - TypeScript の変更を監視して型チェック（ファイルは出力しない。GAS 用のビルドは `pnpm run build`）
- `pnpm run push` - ビルド後に Apps Script へプッシュ
- `pnpm run sync-props` - Infisical のシークレットをスクリプトプロパティへ同期（前掲の「Infisical によるスクリプトプロパティの自動同期」参照）
- `pnpm run deploy` - clasp で新規デプロイを作成する（**本番Webhookが有効な間は使用禁止**。既存デプロイの更新には `redeploy` を使うこと）
- `pnpm run redeploy` - `DEPLOYMENT_ID` 環境変数で指定した既存デプロイをコードごと更新する（URLは変わらない）
- `pnpm run deploy:webhook` - 既存GASを更新し、設定済み中継URLをLINEに登録する（前掲「署名検証用中継のセットアップ」参照）
- `pnpm run open` - Apps Script エディタを開く
- `pnpm run typecheck` - 型チェック
- `pnpm run lint` - Biome lint
- `pnpm run test` - Vitest
