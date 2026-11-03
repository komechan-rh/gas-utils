// 手元のMacでAmazonビジネスにログインし、クラウド実行環境へ引き渡すためのCookie（storageState）を
// base64化して書き出す。ブラウザ操作そのものはしない（ログインは人間が行う）。
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const { chromium } = createRequire(import.meta.url)("playwright");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(scriptDir, "..", ".secrets");
const outputFile = join(outputDir, "amazon-state.b64");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "ja-JP" });
const page = await context.newPage();
await page.goto("https://www.amazon.co.jp/gp/css/order-history");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question(
  "ブラウザで Amazon ビジネスにログインし、注文履歴が表示されたら Enter を押してください: ",
);
rl.close();

const state = await context.storageState();
const cookies = state.cookies.filter((cookie) => cookie.domain.includes("amazon.co.jp"));
const base64 = Buffer.from(JSON.stringify({ cookies, origins: [] })).toString("base64");

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, base64, { mode: 0o600 });

console.log(`Cookie ${cookies.length} 件を ${outputFile} に書き出しました（${base64.length} 文字）。`);

await browser.close();
