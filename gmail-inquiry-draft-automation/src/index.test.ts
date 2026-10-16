import { afterEach, describe, expect, it, vi } from "vitest";
import { doPost, main, setScriptProperties, setupTrigger } from "./index";
import {
  buildClosing,
  buildDraftBody,
  buildGreeting,
  buildSearchQuery,
  createEmptyResult,
  extractSenderName,
  threadHasExistingDraft,
} from "./inquiry-draft";

describe("GAS entrypoints", () => {
  it("GASから呼び出すmain関数を定義する", () => {
    expect(main).toBeTypeOf("function");
  });

  it("GASから呼び出すsetupTrigger関数を定義する", () => {
    expect(setupTrigger).toBeTypeOf("function");
  });
});

describe("setScriptProperties", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渡されたプロパティをすべて上書きし、既存の他のプロパティは削除しない", () => {
    const setProperties = vi.fn();
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ setProperties }),
    });

    setScriptProperties({ GEMINI_API_KEY: "dummy-key", ORGANIZATION_NAME: "example organization" });

    expect(setProperties).toHaveBeenCalledWith(
      { GEMINI_API_KEY: "dummy-key", ORGANIZATION_NAME: "example organization" },
      false,
    );
  });
});

describe("doPost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubServices(syncSecret: string) {
    const setProperties = vi.fn();
    const getProperty = vi.fn((key: string) => (key === "SYNC_SECRET" ? syncSecret : ""));
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty, setProperties }),
    });

    const output: { setMimeType: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> } =
      {
        setMimeType: vi.fn(() => output),
        setContent: vi.fn(() => output),
      };
    vi.stubGlobal("ContentService", {
      createTextOutput: () => output,
      MimeType: { JSON: "JSON" },
    });

    return { setProperties, output };
  }

  function buildEvent(body: unknown) {
    return { postData: { contents: JSON.stringify(body) } } as GoogleAppsScript.Events.DoPost;
  }

  // 認証ロジックの詳細ケース(シークレット不一致・properties未指定など)は
  // shared/src/script-properties-sync.test.ts で検証済みのため、ここでは
  // shared への委譲と、gmail側固有のJSONパース失敗ハンドリングのみ確認する。
  it("有効なリクエストの場合はshared経由でスクリプトプロパティを更新する", () => {
    const { setProperties, output } = stubServices("correct-secret");

    doPost(buildEvent({ secret: "correct-secret", properties: { ORGANIZATION_NAME: "example" } }));

    expect(setProperties).toHaveBeenCalledWith({ ORGANIZATION_NAME: "example" }, false);
    expect(output.setContent).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
  });

  it("不正なJSONの場合はエラーレスポンスを返す", () => {
    const { output } = stubServices("correct-secret");

    doPost({ postData: { contents: "not-json" } } as GoogleAppsScript.Events.DoPost);

    const [responseJson] = output.setContent.mock.calls.at(0) ?? [];
    expect(JSON.parse(responseJson as string)).toMatchObject({ ok: false });
  });
});

describe("createEmptyResult", () => {
  it("実行結果の初期値を返す", () => {
    expect(createEmptyResult()).toEqual({
      scanned: 0,
      drafted: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    });
  });
});

describe("buildSearchQuery", () => {
  it("件名キーワードを含み処理済みラベルを除外する検索クエリを組み立てる", () => {
    expect(buildSearchQuery("問い合わせ", "下書き作成済み")).toBe(
      'subject:"問い合わせ" -label:"下書き作成済み"',
    );
  });
});

describe("extractSenderName", () => {
  it("表示名とメールアドレスの形式から表示名を取り出す", () => {
    expect(extractSenderName("山田太郎 <taro@example.com>")).toBe("山田太郎");
  });

  it("ダブルクォートで囲まれた表示名からクォートを除いて取り出す", () => {
    expect(extractSenderName('"山田 太郎" <taro@example.com>')).toBe("山田 太郎");
  });

  it("表示名がない場合は空文字を返す", () => {
    expect(extractSenderName("taro@example.com")).toBe("");
  });
});

describe("buildGreeting", () => {
  const config = {
    organizationName: "example organization",
    managerName: "example manager",
    replySignature: "",
    lineFriendUrl: "",
  };

  it("送信者名がある場合は宛名から始まる挨拶文を作る", () => {
    const greeting = buildGreeting("山田太郎", config);

    expect(greeting.startsWith("山田太郎さま\n\n")).toBe(true);
    expect(greeting).toContain("example organization管理人のexample managerと申します。");
  });

  it("送信者名がない場合は「お客様」を宛名にする", () => {
    const greeting = buildGreeting("", config);

    expect(greeting.startsWith("お客様さま\n\n")).toBe(true);
  });
});

describe("buildClosing", () => {
  const config = {
    organizationName: "example organization",
    managerName: "",
    replySignature: "",
    lineFriendUrl: "",
  };

  it("公式ラインURLが設定されている場合は友達追加の案内を挿入する", () => {
    const closing = buildClosing({ ...config, lineFriendUrl: "https://page.line.me/example" });

    expect(closing).toContain("公式ラインの友達追加をお勧めしております");
    expect(closing).toContain("https://page.line.me/example");
  });

  it("公式ラインURLが未設定の場合は案内を挿入しない", () => {
    const closing = buildClosing(config);

    expect(closing).not.toContain("公式ライン");
    expect(closing.startsWith("ご確認よろしくお願いいたします。")).toBe(true);
  });

  it("署名が設定されている場合は末尾に追加する", () => {
    const closing = buildClosing({ ...config, replySignature: "example signature" });

    expect(closing.endsWith("\n\nexample signature")).toBe(true);
  });

  it("公式ラインURLと署名が両方設定されている場合は案内の後に署名を続ける", () => {
    const closing = buildClosing({
      ...config,
      lineFriendUrl: "https://page.line.me/example",
      replySignature: "example signature",
    });

    expect(closing).toContain(
      "https://page.line.me/example\n\nご確認よろしくお願いいたします。\n\nexample signature",
    );
  });
});

describe("buildDraftBody", () => {
  const config = {
    organizationName: "example organization",
    managerName: "example manager",
    replySignature: "",
    lineFriendUrl: "",
  };

  it("挨拶・本文・結びを順に組み立てる", () => {
    const body = buildDraftBody("山田太郎", "内見の希望日について本文です。", config);

    expect(body).toBe(
      `${buildGreeting("山田太郎", config)}\n\n内見の希望日について本文です。\n\n${buildClosing(config)}`,
    );
  });
});

describe("threadHasExistingDraft", () => {
  it("スレッドIDが一致する下書きがあればtrueを返す", () => {
    const thread = { getId: () => "thread-1" } as GoogleAppsScript.Gmail.GmailThread;
    const drafts = [
      {
        getMessage: () => ({
          getThread: () => ({ getId: () => "thread-1" }),
        }),
      },
    ] as unknown as GoogleAppsScript.Gmail.GmailDraft[];

    expect(threadHasExistingDraft(thread, drafts)).toBe(true);
  });

  it("スレッドIDが一致する下書きがなければfalseを返す", () => {
    const thread = { getId: () => "thread-1" } as GoogleAppsScript.Gmail.GmailThread;
    const drafts = [
      {
        getMessage: () => ({
          getThread: () => ({ getId: () => "thread-2" }),
        }),
      },
    ] as unknown as GoogleAppsScript.Gmail.GmailDraft[];

    expect(threadHasExistingDraft(thread, drafts)).toBe(false);
  });
});
