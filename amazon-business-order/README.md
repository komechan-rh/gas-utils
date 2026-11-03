# amazon-business-order

Amazonビジネスで「いつもの商品」を定期的に自動購入するための置き場です。LINEからの注文受付（`manager-line-notifications/src/amazon-order/`）が「未処理」として登録した注文を、ここで定期実行（例: Claude Codeのクラウド実行）が読み、Playwrightでカートへの追加・注文を行う想定です。

このディレクトリは pnpm workspace のパッケージではありません（`package.json` を置いていません）。Biome の対象（`*/src/**/*.ts`）にも含まれる `.ts` ファイルが無く、ルートの `pnpm -r` コマンド（lint/typecheck/test/build）の対象にもなりません。

## 構成

| ファイル | 実行場所 | 役割 |
|---|---|---|
| `scripts/export-session.mjs` | 手元のMac | ログイン済みのCookieを書き出す（下記） |
| `scripts/add-to-cart.mjs` | クラウド（routine） | 「未処理」の注文をカートに追加する。注文の確定・レジへの遷移はしない |
| `ROUTINE.md` | クラウド（routine） | 毎日の routine が従う手順書（シートの読み書き・書き戻す列・厳守事項） |

注文の確定は、当面は人がAmazonアプリで行います（カートに追加された旨はGASがLINEへ通知します）。

## Cookieの書き出し手順（手元のMacで実行）

Amazonビジネスへのログインは2段階認証や不審なログイン判定が入るため、クラウド環境から直接ログインせず、手元のMacでログイン済みのCookie（`storageState`）を書き出し、クラウド側はそのCookieを使って認証済み状態を再現します。

1. Playwright本体とブラウザをインストールします（このディレクトリにpackage.jsonが無いため、一時的にグローバル/npxで実行します）。

   ```bash
   npm install --no-save playwright
   npx playwright install chromium
   ```

2. 書き出しスクリプトを実行します。

   ```bash
   node scripts/export-session.mjs
   ```

3. 起動したブラウザでAmazonビジネスにログインし、注文履歴ページが表示された状態でターミナルに戻り Enter を押します。
4. `amazon-business-order/.secrets/amazon-state.b64`（パーミッション600）にCookieがbase64で書き出されます。このファイルはGit管理対象外です（`.gitignore` 参照）。

## クラウド実行環境への登録

書き出した `amazon-business-order/.secrets/amazon-state.b64` の内容を、購入処理を実行するClaude Codeクラウド環境の環境変数 `AMAZON_STORAGE_STATE_B64` に登録します。登録が終わったら、**ローカルの出力ファイルは削除してください**（Cookieはこの用途以外には不要なため、手元に残し続けない）。

```bash
rm amazon-business-order/.secrets/amazon-state.b64
```

## 取り扱い上の注意

- このCookieはAmazonビジネスの購入権限を持つ認証情報そのものです。環境変数・シークレットストア以外（チャット・チケット・リポジトリ）に貼らないでください。
- 不要になった場合や漏えいが疑われる場合は、Amazonビジネスアカウントの**パスワードを変更してCookieを失効**させてください。
- Cookieは有効期限があるため、クラウド側の購入処理がログイン失敗で止まった場合は、本手順を再実行してCookieを更新してください。
