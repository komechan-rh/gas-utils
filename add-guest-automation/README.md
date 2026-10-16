# add-guest-automation

TypeScript、pnpm、clasp を使った Google Apps Script プロジェクトです。

## セットアップ

```bash
pnpm install
```

1. `EVENT_CREATED_LOOKBACK_MINUTES` などの設定を `src/index.ts` で変更します。ゲストのメールアドレスはコードにハードコードせず、Apps Script のスクリプトプロパティ `GUEST_EMAILS`（カンマ区切り）に設定します（下記「スクリプトプロパティ」参照）。
2. 新規 GAS プロジェクトを作成する場合は `clasp create --type standalone --title "add-guest-automation"` を実行します（複数アカウントを使う場合は `--user <name>` を付与）。
3. 既存の GAS プロジェクトへ紐付ける場合は `.clasp.json` を作成し、`scriptId` と `rootDir: "dist"` を設定します。
4. `pnpm run build` で TypeScript をコンパイルします。
5. `pnpm run push` で Apps Script に反映します。
6. Apps Script のブラウザ画面で、`main` を Calendar 変更トリガーに設定します。

以降、イベント作成を含む Calendar 変更が発生したときに `main` が呼ばれ、直近 `EVENT_CREATED_LOOKBACK_MINUTES` 分以内に作成されたイベントだけに `GUEST_EMAILS` を追加します。

ゲスト追加時は `sendUpdates: "none"` を指定するため、追加されたゲストへ招待メールは送信されません。

この実装は Advanced Calendar Service を使います。`appsscript.json` で Calendar API v3 を有効化していますが、Apps Script プロジェクト側でもサービスが有効になっていることを確認してください。

`.clasp.json` の例:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

`pnpm run push` / `pnpm run deploy` / `pnpm run open` は `CLASP_USER` 環境変数で指定した clasp ユーザーを使います（未設定の場合はエラーになり、`default` アカウントが誤って使われることはありません）。

```bash
CLASP_USER=<clasp-user-alias> pnpm run push
```

## スクリプトプロパティ

Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で以下を設定します。

| キー | 必須 | 値 |
|------|------|----|
| `GUEST_EMAILS` | 必須 | 自動追加するゲストのメールアドレス（カンマ区切り） |

### Infisical によるスクリプトプロパティの自動同期（任意）

`GUEST_EMAILS` を毎回 Apps Script エディタで手入力する代わりに、[Infisical](https://infisical.com/) に登録した値を、このプロジェクトが公開する Web アプリ（`doPost`）経由でスクリプトプロパティへ同期できます。仕組みの詳細は [gmail-inquiry-draft-automation/README.md](../gmail-inquiry-draft-automation/README.md#infisical-によるスクリプトプロパティの自動同期任意) を参照してください。

前提:

- Web アプリとしてデプロイ済みであること（`appsscript.json` の `webapp` 設定、`pnpm run deploy` 参照）
- Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で `SYNC_SECRET` にランダムな文字列を手動設定済みであること（初回のみ、Web アプリ経由では設定できない）
- Infisical の共有プロジェクトの `/add-guest-automation` フォルダに、`GUEST_EMAILS`・`SYNC_SECRET`（エディタで設定した値と同じもの）・`ADD_GUEST_WEBAPP_URL`（`pnpm run deploy` で発行されたWebアプリのURL）を登録済みであること

実行方法:

```bash
pnpm run sync-props
```

## コマンド

- `pnpm run build` - TypeScript をコンパイルし、`appsscript.json` を `dist/` にコピー
- `pnpm run watch` - TypeScript の変更を監視して型チェック（ファイルは出力しない。GAS 用のビルドは `pnpm run build`）
- `pnpm run push` - ビルド後に Apps Script へプッシュ
- `pnpm run sync-props` - Infisical のシークレットをスクリプトプロパティへ同期（前掲の「Infisical によるスクリプトプロパティの自動同期」参照）
- `pnpm run deploy` - clasp でデプロイ
- `pnpm run open` - Apps Script エディタを開く
- `pnpm run typecheck` - 型チェック
- `pnpm run lint` - Biome lint
- `pnpm run test` - Vitest
