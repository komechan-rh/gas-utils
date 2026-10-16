import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import worker from "./worker.mjs";

const env = { LINE_CHANNEL_SECRET: "test-channel-secret", GAS_WEBAPP_URL: "https://example.com/gas" };
const body = JSON.stringify({ events: [{ message: { type: "text", text: "今週の予定" } }] });
const signature = createHmac("sha256", env.LINE_CHANNEL_SECRET).update(body).digest("base64");
function request(text = body, sig = signature) {
  return new Request("https://example.com/relay", { method: "POST", headers: { "x-line-signature": sig }, body: text });
}
afterEach(() => mock.restoreAll());
test("実際のHMAC署名を検証し未加工の日本語本文と署名をGASへ渡す", async () => {
  const forward = mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, env.GAS_WEBAPP_URL);
    assert.deepEqual(JSON.parse(options.body), { lineWebhook: { body, signature } });
    return Response.json({ ok: true });
  });
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(forward.mock.callCount(), 1);
});
test("署名の欠落・改ざん・偽造はGASに転送しない", async () => {
  const forward = mock.method(globalThis, "fetch", async () => { throw new Error("must not forward"); });
  for (const input of [request(body, ""), request(`${body} `), request(body, "forged")]) {
    assert.equal((await worker.fetch(input, env)).status, 401);
  }
  assert.equal(forward.mock.callCount(), 0);
});
test("GASの認証失敗・HTTP失敗・非JSON・通信失敗を成功扱いしない", async () => {
  for (const response of [Response.json({ ok: false }), Response.json({ ok: true }, { status: 500 }), new Response("error"), null]) {
    mock.method(globalThis, "fetch", async () => { if (!response) throw new Error("network"); return response; });
    assert.equal((await worker.fetch(request(), env)).status, 502);
    mock.restoreAll();
  }
});
test("GETと設定不足は拒否する", async () => {
  assert.equal((await worker.fetch(new Request("https://example.com"), env)).status, 405);
  assert.equal((await worker.fetch(request(), {})).status, 503);
});
