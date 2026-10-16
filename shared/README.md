# shared

複数の GAS automation から参照する共通コードを置くパッケージです。単体では clasp push / deploy の対象になりません。

## 提供している機能

### `shared/script-properties-sync`（GASバンドルから import する用）

Infisical に登録した値を、共有シークレットで認証する `doPost` Web アプリ経由でスクリプトプロパティへ同期する仕組みのコア部分です。

- `syncScriptProperties(request: { secret?: string; properties?: Record<string, string> })` — `SYNC_SECRET`（スクリプトプロパティ）と `request.secret` を比較し、一致すれば `request.properties` で `PropertiesService.getScriptProperties().setProperties(...)` を実行する
- `respondJson(result)` — 結果を JSON にして `ContentService` のレスポンスにする

JSON.parse や try/catch、GAS イベント固有のルーティング（例: LINE Webhook との共存）は各 automation 側の `doPost` に残す。`shared` が持つのは認証つきのプロパティ書き込みという、セキュリティ上ズレてほしくない部分だけ。

各 automation 側の使い方（例）:

```ts
import { respondJson, syncScriptProperties } from "shared/script-properties-sync";

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const body = JSON.parse(e.postData.contents);
    return respondJson(syncScriptProperties(body));
  } catch (error) {
    return respondJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
```

### `shared/sync-script-properties-cli`（Node スクリプトから import する用）

Infisical から注入された環境変数のうち、呼び出し側が指定したキーだけを抽出して Web アプリへ POST する。

```js
import { syncScriptProperties } from "shared/sync-script-properties-cli";

await syncScriptProperties({
  webAppUrlKey: "MY_AUTOMATION_WEBAPP_URL",
  requiredKeys: ["FOO"],
  optionalKeys: ["BAR"],
});
```

各 automation の `scripts/sync-script-properties.mjs` は、このヘルパーに自分のキー一覧を渡すだけの薄いラッパーにする。
