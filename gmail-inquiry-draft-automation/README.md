# gmail-inquiry-draft-automation

TypeScript、pnpm、clasp を使った Google Apps Script プロジェクトです。
Gmail に届いた問い合わせメールに対して、返信の下書きを自動作成します。

GAS には「メール受信をトリガーに直接実行する」仕組みがないため、時間主導型トリガーで受信箱を定期的にポーリングする方式にしています。件名に指定キーワードを含むスレッドのうち、まだ下書きを作成していない最新の1件を見つけて処理します。

## 仕組み

1. `main` が `subject:"<問い合わせキーワード>" -label:"<処理済みラベル>"` で該当スレッドを検索し、最新の1件のみを対象にします。件名（タイトル）に `INQUIRY_SUBJECT_KEYWORD`（既定値: `問い合わせ`）を含むメールが対象です（部分一致）。未処理が複数ある場合は、次回以降のトリガー実行で順次処理されます。
2. 最新メッセージの本文から、問い合わせ者のメールアドレスと氏名を取り出します（「メールアドレス: ...」「お名前: ...」のようなラベル付きの行を優先し、メールアドレスが見つからない場合は本文中の最初のメールアドレスを使用。氏名が見つからない場合は空扱いとします）。この宛先に、既に下書きが存在する場合はスキップします。
3. なければ、最新メッセージの本文を Gemini API に渡し、内見希望日の有無に応じた文面（希望日があればその日時で確定する旨、なければ候補日時を3つ程度提案する旨）を生成させます。
4. 下書き本文は「固定の冒頭挨拶」＋「Gemini APIが生成した本文」＋「固定のLINE案内・署名」で組み立てます。件名は `【<ORGANIZATION_NAME>】内見に関して` に固定です。宛先は問い合わせメール自体の送信元（ポータルサイト等の通知元アドレス）ではなく、2. で取り出した問い合わせ者のメールアドレスに、取り出せた場合は氏名を表示名として付与します（問い合わせスレッドへの返信ではなく、新規の下書きとして作成します）。
5. 処理したスレッドには処理済みラベル（`PROCESSED_LABEL_NAME`、既定値: `下書き作成済み`。存在しない場合は自動作成）を付与し、次回以降の重複処理を防ぎます。

下書きを作成するだけで送信は行いません。内容を確認のうえ、手動で送信してください。

## セットアップ

```bash
pnpm install
```

1. 新規 GAS プロジェクトを作成する場合は `clasp create --type standalone --title "gmail-inquiry-draft-automation"` を実行します（複数アカウントを使う場合は `--user <name>` を付与）。
2. 既存の GAS プロジェクトへ紐付ける場合は `.clasp.json` を作成し、`scriptId` と `rootDir: "dist"` を設定します。
3. `pnpm run build` で TypeScript をコンパイルします。
4. `pnpm run push` で Apps Script に反映します。
5. Apps Script のブラウザ画面（`pnpm run open`）でスクリプトプロパティを設定します（下記「スクリプトプロパティ」参照）。
6. `setupTrigger` を一度だけ手動実行し、`TRIGGER_INTERVAL_MINUTES`（既定値: 15分）ごとに `main` が実行される時間主導型トリガーを登録します。

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
| `ORGANIZATION_NAME` | 必須 | 下書き本文で名乗る組織・施設名（例: `〇〇ハウス`） |
| `MANAGER_NAME` | 必須 | 下書き本文の冒頭挨拶で名乗る管理人氏名（例: `〇〇`） |
| `GEMINI_API_KEY` | 必須 | Gemini API のAPIキー（[Google AI Studio](https://aistudio.google.com/apikey)で発行） |
| `GEMINI_MODEL` | 任意 | 本文生成に使うGeminiのモデル名（既定値: `gemini-2.5-flash`） |
| `REPLY_SIGNATURE` | 任意 | 下書き本文の末尾に付ける署名（未設定の場合は署名なし） |
| `LINE_FRIEND_URL` | 任意 | 公式LINEアカウントの友達追加URL。設定すると本文と署名の間に友達追加を案内する文言を挿入する（未設定の場合は案内なし） |
| `INQUIRY_SUBJECT_KEYWORD` | 任意 | 問い合わせメールと判定する件名（タイトル）キーワード。部分一致（既定値: `問い合わせ`） |
| `PROCESSED_LABEL_NAME` | 任意 | 下書き作成済みスレッドに付与するラベル名（既定値: `下書き作成済み`） |
| `SYNC_SECRET` | 下記「Infisicalによる自動同期」を使う場合のみ必須 | `sync-props` からの同期リクエストを認証する共有シークレット。ランダムな文字列を生成し、Apps Script エディタで手動設定したうえで、同じ値を Infisical にも登録する |

各プロパティ値の前後の空白は自動で除去されるため、コピー&ペースト時に空白が混入しても判定への影響はありません。

### Infisical によるスクリプトプロパティの自動同期（任意）

上記の値（`SYNC_SECRET` を除く）を毎回 Apps Script エディタで手入力する代わりに、[Infisical](https://infisical.com/) に登録した値を、このプロジェクトが公開する Web アプリ（`doPost`）経由でスクリプトプロパティへ同期できます。

`clasp run`（Apps Script Execution API）は、clasp の共有 OAuth クライアントがこのプロジェクトのカスタムスコープ（`gmail.modify` 等）を要求できず `403 PERMISSION_DENIED` になるため使用していません。代わりに「自分として実行・共有シークレットで認証」する Web アプリを介して同期します。

前提:

- Web アプリとしてデプロイ済みであること（`appsscript.json` の `webapp` 設定、`pnpm run deploy` 参照）
- Apps Script エディタの「プロジェクトの設定」→「スクリプト プロパティ」で `SYNC_SECRET` にランダムな文字列を手動設定済みであること（初回のみ、Web アプリ経由では設定できない）
- [Infisical CLI](https://infisical.com/docs/cli/overview) をインストール済みで、`infisical login` / `infisical init` をこのディレクトリで実行済みであること
- Infisical 側に、上記表と同じキー名（`ORGANIZATION_NAME` / `MANAGER_NAME` / `GEMINI_API_KEY` など）と、`GMAIL_INQUIRY_WEBAPP_URL`（`pnpm run deploy` で発行されたWebアプリのURL）・`SYNC_SECRET`（エディタで設定した値と同じもの）を登録済みであること

実行方法:

```bash
pnpm run sync-props
```

内部では `infisical run -- node scripts/sync-script-properties.mjs` を実行し、Infisicalから注入された環境変数のうち上記表のキーだけを抽出して、Web アプリ（`doPost`）へ `{ secret, properties }` をJSONでPOSTします。`process.env` を丸ごと転送するわけではないため、無関係な環境変数やシークレットが Script Properties に混入することはありません。

セキュリティ上の注意:

- Web アプリの `access` は `ANYONE_ANONYMOUS`（URLを知っていれば誰でも呼び出せる）のため、`SYNC_SECRET` が実質的な認証手段です。第三者に漏れないよう扱ってください。
- 同期対象のキー・値はログに出力されません（出力されるのはキー名のみ）。

## コマンド

- `pnpm run build` - TypeScript をコンパイルし、`appsscript.json` を `dist/` にコピー
- `pnpm run watch` - TypeScript の変更を監視してコンパイル
- `pnpm run push` - ビルド後に Apps Script へプッシュ
- `pnpm run sync-props` - Infisical のシークレットをスクリプトプロパティへ同期（前掲の「Infisical によるスクリプトプロパティの自動同期」参照）
- `pnpm run deploy` - clasp でデプロイ
- `pnpm run open` - Apps Script エディタを開く
- `pnpm run typecheck` - 型チェック
- `pnpm run lint` - Biome lint
- `pnpm run test` - Vitest
