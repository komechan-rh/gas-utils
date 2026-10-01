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
- LINE グループ内で「給与支払い済」と発言すると、支払い状況を「済」に更新（支払い予定日が当月より前で未済のまま残っている月があれば最も古いものから順に更新し、なければ当月分を更新する。返信で更新した稼働月を知らせる）
- LINE グループ内で「ID」と発言すると、そのグループの `group_id` を返信（`LINE_GROUP_ID` の設定に使う）
- 発言キーワードとハンドラの対応は `src/line-commands.ts` にまとめている。キーワードを追加する場合はここに追記する

reply 機能を使うため、Webhook は一時的にではなく常時オンにしておく必要があります。

1. [LINE Developers コンソール](https://developers.line.biz/console/) にログインし、Provider を作成します（既にあれば流用）。
2. Provider 内に新規チャネルを作成し、チャネルタイプは **Messaging API** を選択します。
3. 作成したチャネルの「Messaging API設定」タブで、以下を行います。
   - **チャネルアクセストークン（長期）** を発行する → `LINE_CHANNEL_ACCESS_TOKEN` に使用
   - 「応答メッセージ」（LINE公式アカウントのデフォルト応答機能）をオフにする（`doPost` 側の応答と重複させないため）
   - 「Webhookの利用」をオンにする
4. 初回は `pnpm run deploy:webhook` を実行すると、ビルド・push・新規デプロイ・Messaging API 設定への Webhook URL 登録までを自動化できます（詳細は下記「デプロイ後の Webhook URL 自動更新」）。手動で行う場合は、`pnpm run push` で反映後、Apps Script エディタで「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」でデプロイし、発行された URL を Messaging API 設定の Webhook URL に登録します。

   **Webhook URL を登録済みの状態でコードを更新した場合は、二度と `pnpm run deploy` / `pnpm run deploy:webhook` を使わないでください。** どちらも新規デプロイ（＝新しいURL）を作成するため、LINE側に登録済みのWebhook URLが無効になります。既存デプロイの更新には、必ず `DEPLOYMENT_ID=<デプロイID> CLASP_USER=<alias> pnpm run redeploy` を使い、同じデプロイ・同じURLのままコードだけを更新してください。デプロイIDは `clasp deployments -u <alias>` で確認できます。更新後は LINE グループで実際にメッセージ（例:「今週の予定」）を送り、Bot が応答することを必ず確認してください。
5. 作成した Bot を、通知を送りたい LINE グループに招待します（QRコードまたは Bot の LINE ID で友だち追加してからグループに招待）。
6. グループ内で「ID」と発言し、返信された `group_id` を `LINE_GROUP_ID` に使います。
7. 取得したチャネルアクセストークンとグループIDを、GAS のスクリプトプロパティに設定します。

### デプロイ後の Webhook URL 自動更新

`clasp deploy` は実行のたびに新しい deploymentId（＝ Web アプリ URL）を発行するため、新規デプロイのたびに LINE Developers 側の Webhook URL を手動で登録し直す必要があります。`scripts/deploy-and-update-webhook.sh` はビルド・push・deploy を実行し、発行された URL を LINE Messaging API（`PUT /v2/bot/channel/webhook/endpoint`）で自動的に反映します。**既存デプロイのコード更新（URLを変えたくない場合）には使わず、`pnpm run redeploy` を使ってください。**

1. `CLASP_USER` を環境変数として設定します（`pnpm run push` / `pnpm run deploy` と同様）。
2. `pnpm run deploy:webhook` を実行します（`LINE_CHANNEL_ACCESS_TOKEN` は Infisical から `infisical run` 経由で自動的に注入されます。前掲「スクリプトプロパティ」「Infisical によるスクリプトプロパティの自動同期」参照）。

内部では以下を行います。

- `pnpm run build` → `clasp push` → `clasp deploy --json` を実行し、レスポンスから `deploymentId` を取得
- `https://script.google.com/macros/s/<deploymentId>/exec` を Webhook URL として LINE の Webhook エンドポイント設定 API に登録
- LINE の Webhook 疎通確認 API（`/v2/bot/channel/webhook/test`）で反映結果を表示

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
| `LINE_CHANNEL_ACCESS_TOKEN` | 必須 | LINE Developers で発行したチャネルアクセストークン（長期） |
| `PAYROLL_SPREADSHEET_ID` | 必須 | 給与支払い管理スプレッドシートのID（スプレッドシートURLの `/d/` と `/edit` の間の文字列） |
| `SYNC_SECRET` | 下記「Infisicalによる自動同期」を使う場合のみ必須 | `sync-props` からの同期リクエストを認証する共有シークレット。ランダムな文字列を生成し、Apps Script エディタで手動設定したうえで、同じ値を Infisical にも登録する |

### `doPost` について

このプロジェクトの Web アプリは、LINE Webhook とスクリプトプロパティ同期の両方を1つの `doPost` で受け付けます。リクエストボディを一度パースし、トップレベルに `events` 配列を持つものは LINE Webhook（`src/line-webhook.ts`）、`secret`/`properties` を持つものはスクリプトプロパティ同期（`shared` の `syncScriptProperties`）へルーティングします。GAS の制約上 `doPost` は1プロジェクトに1つしか持てないため、この2つを共存させています。

### Infisical によるスクリプトプロパティの自動同期（任意）

上記の値（`SYNC_SECRET` を除く）を毎回 Apps Script エディタで手入力する代わりに、[Infisical](https://infisical.com/) に登録した値を、上記の `doPost` 経由でスクリプトプロパティへ同期できます。仕組みの詳細は [gmail-inquiry-draft-automation/README.md](../gmail-inquiry-draft-automation/README.md#infisical-によるスクリプトプロパティの自動同期任意) を参照してください。

前提:

- Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で `SYNC_SECRET` にランダムな文字列を手動設定済みであること（初回のみ、Web アプリ経由では設定できない）
- [Infisical CLI](https://infisical.com/docs/cli/overview) をインストール済みで、`infisical login` / `infisical init` をこのディレクトリで実行済みであること
- Infisical 側に、`LINE_GROUP_ID`・`LINE_CHANNEL_ACCESS_TOKEN`・`PAYROLL_SPREADSHEET_ID`・`SYNC_SECRET`（エディタで設定した値と同じもの）・`MANAGER_LINE_WEBAPP_URL`（LINE Webhookとして既に登録済みのURL）を登録済みであること（automationごとにキー名を分けており、フォルダによる分離は行っていない）

実行方法:

```bash
pnpm run sync-props
```

## コマンド

- `pnpm run build` - TypeScript をコンパイルし、`appsscript.json` を `dist/` にコピー
- `pnpm run watch` - TypeScript の変更を監視してコンパイル
- `pnpm run push` - ビルド後に Apps Script へプッシュ
- `pnpm run sync-props` - Infisical のシークレットをスクリプトプロパティへ同期（前掲の「Infisical によるスクリプトプロパティの自動同期」参照）
- `pnpm run deploy` - clasp で新規デプロイを作成する（**本番Webhookが有効な間は使用禁止**。既存デプロイの更新には `redeploy` を使うこと）
- `pnpm run redeploy` - `DEPLOYMENT_ID` 環境変数で指定した既存デプロイをコードごと更新する（URLは変わらない）
- `pnpm run deploy:webhook` - 新規デプロイを実行し、発行された URL を LINE Developers の Webhook URL に自動反映する（前掲「デプロイ後の Webhook URL 自動更新」参照。既存デプロイの更新には使わないこと）
- `pnpm run open` - Apps Script エディタを開く
- `pnpm run typecheck` - 型チェック
- `pnpm run lint` - Biome lint
- `pnpm run test` - Vitest
