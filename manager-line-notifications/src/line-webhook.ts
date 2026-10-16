import { respondJson } from "shared/script-properties-sync";
import { findLineCommand } from "./line-commands";

type LineWebhookEvent = {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string };
  message?: { type: string; text?: string };
};

// 中継を信頼せず、未加工の本文と署名をチャネルシークレットで再検証する。
function handleLineWebhook(envelope: unknown): GoogleAppsScript.Content.TextOutput {
  const channelSecret = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_SECRET");
  const input = envelope as { body?: unknown; signature?: unknown } | null;
  if (!channelSecret || typeof input?.body !== "string" || typeof input.signature !== "string") {
    return respondJson({ ok: false, error: "unauthorized" });
  }
  const expected = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(input.body, channelSecret, Utilities.Charset.UTF_8),
  );
  if (!constantTimeEqual(expected, input.signature)) {
    return respondJson({ ok: false, error: "unauthorized" });
  }

  const body = JSON.parse(input.body) as { events?: LineWebhookEvent[] };
  if (!Array.isArray(body?.events)) return respondJson({ ok: false, error: "invalid events" });

  const groupId = PropertiesService.getScriptProperties().getProperty("LINE_GROUP_ID");
  for (const event of body.events) {
    if (event?.type !== "message" || event.message?.type !== "text" || !event.replyToken) continue;
    const text = event.message.text;
    if (!text) continue;
    // 初期設定用のID照会のみ、署名済みの別グループからも許可する。
    if (event.source?.type !== "group" || !event.source.groupId) continue;
    if (text !== "ID" && (!groupId || event.source.groupId !== groupId)) continue;
    if (!event.webhookEventId || !/^[\w-]{1,128}$/.test(event.webhookEventId)) continue;
    const command = findLineCommand(text);
    if (command) {
      command({
        replyToken: event.replyToken,
        groupId: event.source.groupId,
        webhookEventId: event.webhookEventId,
      });
    }
  }
  return respondJson({ ok: true });
}

function constantTimeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

export { handleLineWebhook };
