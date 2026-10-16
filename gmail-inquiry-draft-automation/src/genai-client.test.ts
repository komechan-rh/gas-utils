import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildInquiryReplyPrompt,
  generateInquiryReplyMessage,
  parseGenAiResponseText,
} from "./genai-client";

describe("buildInquiryReplyPrompt", () => {
  it("問い合わせ本文を含み、宛名・署名を含めない指示のプロンプトを組み立てる", () => {
    const prompt = buildInquiryReplyPrompt("見学希望日: 7月8日の午前");

    expect(prompt).toContain("見学希望日: 7月8日の午前");
    expect(prompt).toContain("宛名、挨拶、署名は含めない");
  });
});

describe("parseGenAiResponseText", () => {
  it("レスポンスからテキストを取り出す", () => {
    const responseBody = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "  ご希望の7月8日午前で確定いたします。  " }] } }],
    });

    expect(parseGenAiResponseText(responseBody)).toBe("ご希望の7月8日午前で確定いたします。");
  });

  it("candidatesが存在しない場合はエラーを投げる", () => {
    const responseBody = JSON.stringify({});

    expect(() => parseGenAiResponseText(responseBody)).toThrow(
      "GenAI APIのレスポンスからメッセージを取得できませんでした。",
    );
  });
});

describe("generateInquiryReplyMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubUrlFetchApp(statusCode: number, body: string) {
    const fetch = vi.fn(() => ({
      getResponseCode: () => statusCode,
      getContentText: () => body,
    }));
    vi.stubGlobal("UrlFetchApp", { fetch });
    return { fetch };
  }

  it("APIキーをURLではなくx-goog-api-keyヘッダーで渡す", () => {
    const { fetch } = stubUrlFetchApp(
      200,
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "返信本文" }] } }] }),
    );

    const message = generateInquiryReplyMessage("問い合わせ本文", {
      apiKey: "dummy-key",
      model: "example-model",
    });

    expect(message).toBe("返信本文");
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      GoogleAppsScript.URL_Fetch.URLFetchRequestOptions,
    ];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/example-model:generateContent",
    );
    expect(url).not.toContain("dummy-key");
    expect(options.headers).toEqual({ "x-goog-api-key": "dummy-key" });
  });

  it("ステータスコードが2xx以外の場合はエラーを投げる", () => {
    stubUrlFetchApp(403, "forbidden");

    expect(() =>
      generateInquiryReplyMessage("問い合わせ本文", {
        apiKey: "dummy-key",
        model: "example-model",
      }),
    ).toThrow("GenAI APIの呼び出しに失敗しました。ステータス: 403、詳細: forbidden");
  });
});
