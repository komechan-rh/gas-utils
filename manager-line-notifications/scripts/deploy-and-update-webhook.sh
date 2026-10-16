#!/usr/bin/env bash
# 既存GASを更新し、署名検証用中継URLをLINEへ登録する。
# 中継の初回デプロイとシークレット設定はREADMEを参照。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

: "${LINE_CHANNEL_ACCESS_TOKEN:?LINE_CHANNEL_ACCESS_TOKEN is not set}"
: "${CLASP_USER:?CLASP_USER is not set}"
: "${DEPLOYMENT_ID:?DEPLOYMENT_ID is not set}"
: "${LINE_WEBHOOK_RELAY_URL:?LINE_WEBHOOK_RELAY_URL is not set (use the Worker URL, not the GAS URL)}"

# GAS直送の旧構成を誤って再登録しない。
node -e '
  const url = new URL(process.env.LINE_WEBHOOK_RELAY_URL);
  if (url.protocol !== "https:" || /(^|\.)(google\.com|googleusercontent\.com)$/.test(url.hostname)) {
    throw new Error("LINE_WEBHOOK_RELAY_URL must be an HTTPS relay URL, not a GAS URL");
  }
'

pnpm run redeploy

node --input-type=module <<'JS'
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
};
const body = JSON.stringify({ endpoint: process.env.LINE_WEBHOOK_RELAY_URL });
for (const [path, method] of [["endpoint", "PUT"], ["test", "POST"]]) {
  const response = await fetch(`https://api.line.me/v2/bot/channel/webhook/${path}`, { method, headers, body });
  if (!response.ok) throw new Error(`LINE Webhook ${path}: HTTP ${response.status}`);
  if (path === "test" && !(await response.json()).success) {
    throw new Error("LINE Webhook疎通確認が失敗しました。中継設定を確認してください。");
  }
}
console.log("既存GASを更新し、署名検証用中継URLをLINEに登録しました。");
JS
