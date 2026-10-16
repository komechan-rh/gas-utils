import { afterEach, describe, expect, it, vi } from "vitest";
import { pushTextMessage, replyTextMessage } from "./line-client";

describe("line-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubServices(statusCode: number) {
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty: () => "dummy-token" }),
    });
    const fetch = vi.fn(() => ({
      getResponseCode: () => statusCode,
      getContentText: () => "error-body",
    }));
    vi.stubGlobal("UrlFetchApp", { fetch });

    return { fetch };
  }

  it("pushTextMessageはpushエンドポイントへ送信先とテキストを送る", () => {
    const { fetch } = stubServices(200);

    pushTextMessage("group-1", "こんにちは");

    expect(fetch).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/push", {
      method: "post",
      headers: { "Content-Type": "application/json", Authorization: "Bearer dummy-token" },
      payload: JSON.stringify({ to: "group-1", messages: [{ type: "text", text: "こんにちは" }] }),
      muteHttpExceptions: true,
    });
  });

  it("replyTextMessageはreplyエンドポイントへリプライトークンとテキストを送る", () => {
    const { fetch } = stubServices(200);

    replyTextMessage("reply-token", "こんにちは");

    expect(fetch).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/reply", {
      method: "post",
      headers: { "Content-Type": "application/json", Authorization: "Bearer dummy-token" },
      payload: JSON.stringify({
        replyToken: "reply-token",
        messages: [{ type: "text", text: "こんにちは" }],
      }),
      muteHttpExceptions: true,
    });
  });

  it("ステータスコードが200以外の場合はエラーを投げる", () => {
    stubServices(400);

    expect(() => pushTextMessage("group-1", "こんにちは")).toThrow(
      "LINE API エラー: ステータスコード 400 - error-body",
    );
  });

  it("LINE_CHANNEL_ACCESS_TOKENが未設定の場合はAPIを呼ばずにエラーを投げる", () => {
    const { fetch } = stubServices(200);
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty: () => null }),
    });

    expect(() => replyTextMessage("reply-token", "こんにちは")).toThrow(
      "LINE_CHANNEL_ACCESS_TOKEN がスクリプトプロパティに設定されていません。",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
