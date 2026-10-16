import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./line-commands", () => ({ findLineCommand: vi.fn() }));

import { findLineCommand } from "./line-commands";
import { handleLineWebhook } from "./line-webhook";

const command = vi.fn();
const secret = "test-channel-secret";
const event = {
  type: "message",
  webhookEventId: "event-1",
  replyToken: "reply-1",
  source: { type: "group", groupId: "allowed-group" },
  message: { type: "text", text: "給与支払い済" },
};
function envelope(events: unknown[] = [event]) {
  const body = JSON.stringify({ events });
  return { body, signature: `signature:${secret}:${body}` };
}

beforeEach(() => {
  vi.mocked(findLineCommand).mockReturnValue(command);
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (key: string) =>
        ({ LINE_CHANNEL_SECRET: secret, LINE_GROUP_ID: "allowed-group" })[key],
    }),
  });
  vi.stubGlobal("Utilities", {
    Charset: { UTF_8: "utf8" },
    computeHmacSha256Signature: (body: string, key: string) => `signature:${key}:${body}`,
    base64Encode: (value: string) => value,
  });
  vi.stubGlobal("ContentService", {
    MimeType: { JSON: "json" },
    createTextOutput: () => {
      const output = {
        setMimeType: () => output,
        setContent: (s: string) => {
          Object.assign(output, JSON.parse(s));
          return output;
        },
      };
      return output;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LINE webhook authentication", () => {
  it("正しい署名と許可グループのコマンドのみ実行する", () => {
    handleLineWebhook(envelope());
    expect(command).toHaveBeenCalledWith({
      replyToken: "reply-1",
      groupId: "allowed-group",
      webhookEventId: "event-1",
    });
  });
  it.each([
    null,
    {},
    { body: "{}" },
    { ...envelope(), signature: "forged" },
    { ...envelope(), body: `${envelope().body} ` },
  ])("欠落・偽造・改ざんされた署名を拒否する: %j", (input) => {
    expect(handleLineWebhook(input)).toMatchObject({ ok: false });
    expect(findLineCommand).not.toHaveBeenCalled();
  });
  it("チャネルシークレット未設定では拒否する", () => {
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty: () => null }),
    });
    handleLineWebhook(envelope());
    expect(command).not.toHaveBeenCalled();
  });
  it.each(["今週の予定", "今月の給与", "給与支払い済", "バージョン"])(
    "他グループと個別トークからの%sを拒否する",
    (text) => {
      handleLineWebhook(
        envelope([
          {
            ...event,
            message: { type: "text", text },
            source: { type: "group", groupId: "other-group" },
          },
          { ...event, message: { type: "text", text }, source: { type: "user" } },
        ]),
      );
      expect(command).not.toHaveBeenCalled();
    },
  );
  it("初期設定用ID照会は署名済みグループから許可する", () => {
    handleLineWebhook(
      envelope([
        {
          ...event,
          source: { type: "group", groupId: "other-group" },
          message: { type: "text", text: "ID" },
        },
      ]),
    );
    expect(command).toHaveBeenCalledOnce();
  });
  it("イベントIDなしでは更新しない", () => {
    handleLineWebhook(envelope([{ ...event, webhookEventId: undefined }]));
    expect(command).not.toHaveBeenCalled();
  });
  it("LINEの疎通確認イベントを受け付ける", () => {
    expect(handleLineWebhook(envelope([]))).toMatchObject({ ok: true });
    expect(command).not.toHaveBeenCalled();
  });
});
