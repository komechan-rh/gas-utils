// Cloudflare Workers: LINEの署名ヘッダーと未加工の本文をGASへ中継する。
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.LINE_CHANNEL_SECRET || !env.GAS_WEBAPP_URL) return new Response("Not configured", { status: 503 });
    const body = await request.text();
    const signature = request.headers.get("x-line-signature");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_CHANNEL_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    let valid = false;
    try {
      const bytes = Uint8Array.from(atob(signature ?? ""), (c) => c.charCodeAt(0));
      valid = await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
    } catch {
      // 不正なBase64署名も認証失敗とする。
    }
    if (!valid) return new Response("Unauthorized", { status: 401 });
    try {
      const response = await fetch(env.GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineWebhook: { body, signature } }),
        redirect: "follow",
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) return new Response("Upstream failed", { status: 502 });
      return new Response("OK");
    } catch {
      return new Response("Upstream failed", { status: 502 });
    }
  },
};
