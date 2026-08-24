import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildClosing,
  buildDraftBody,
  buildDraftRecipient,
  buildDraftSubject,
  buildGreeting,
  buildSearchQuery,
  createEmptyResult,
  extractInquirerEmail,
  extractInquirerName,
  threadHasExistingDraft,
} from "./inquiry-draft";
import { doPost, main, setScriptProperties, setupTrigger } from "./index";

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

    const output: { setMimeType: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> } = {
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
  const config = { organizationName: "example organization", managerName: "", replySignature: "", lineFriendUrl: "" };

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

    expect(closing).toContain("https://page.line.me/example\n\nご確認よろしくお願いいたします。\n\nexample signature");
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
  it("宛先が一致する下書きがあればtrueを返す", () => {
    const drafts = [
      {
        getMessage: () => ({ getTo: () => '"山田太郎" <taro@example.com>' }),
      },
    ] as unknown as GoogleAppsScript.Gmail.GmailDraft[];

    expect(threadHasExistingDraft('"山田太郎" <taro@example.com>', drafts)).toBe(true);
  });

  it("宛先が一致する下書きがなければfalseを返す", () => {
    const drafts = [
      {
        getMessage: () => ({ getTo: () => "other@example.com" }),
      },
    ] as unknown as GoogleAppsScript.Gmail.GmailDraft[];

    expect(threadHasExistingDraft("taro@example.com", drafts)).toBe(false);
  });
});

describe("buildDraftSubject", () => {
  it("組織名を角括弧で囲み固定文言を続けた件名を組み立てる", () => {
    expect(buildDraftSubject({ organizationName: "example organization" })).toBe(
      "【example organization】内見に関して",
    );
  });
});

describe("extractInquirerEmail", () => {
  it("ラベル付きの行からメールアドレスを取り出す", () => {
    const body = "お名前: 山田太郎\nメールアドレス: taro@example.com\nご希望日: 未定";

    expect(extractInquirerEmail(body)).toBe("taro@example.com");
  });

  it("Eメールなどのラベル表記にも対応する", () => {
    const body = "Eメール：taro@example.com";

    expect(extractInquirerEmail(body)).toBe("taro@example.com");
  });

  it("角括弧ラベル＋同一行の値の形式に対応する", () => {
    const body = "* [メールアドレス] taro@example.com";

    expect(extractInquirerEmail(body)).toBe("taro@example.com");
  });

  it("ラベルがない場合は本文中の最初のメールアドレスを取り出す", () => {
    const body = "お問い合わせありがとうございます。taro@example.com までご連絡ください。";

    expect(extractInquirerEmail(body)).toBe("taro@example.com");
  });

  it("メールアドレスが見つからない場合はエラーを投げる", () => {
    expect(() => extractInquirerEmail("メールアドレスの記載がありません。")).toThrow();
  });
});

describe("extractInquirerName", () => {
  it("ラベル付きの行から氏名を取り出す", () => {
    const body = "お名前: 山田太郎\nメールアドレス: taro@example.com";

    expect(extractInquirerName(body)).toBe("山田太郎");
  });

  it("氏名・name などのラベル表記にも対応する", () => {
    expect(extractInquirerName("氏名：山田太郎")).toBe("山田太郎");
    expect(extractInquirerName("Name: Taro Yamada")).toBe("Taro Yamada");
  });

  it("角括弧ラベル＋同一行の値の形式に対応する", () => {
    expect(extractInquirerName("* [お名前] Mariano  Vazquez")).toBe("Mariano  Vazquez");
  });

  it("記号付きラベル＋改行後の値の形式に対応する", () => {
    expect(extractInquirerName("■お名前：\n長野寿子")).toBe("長野寿子");
  });

  it("ラベルが見つからない場合は空文字を返す", () => {
    expect(extractInquirerName("お名前の記載がありません。")).toBe("");
  });
});

describe("buildDraftRecipient", () => {
  it("氏名がある場合は表示名付きの宛先を組み立てる", () => {
    expect(buildDraftRecipient("taro@example.com", "山田太郎")).toBe('"山田太郎" <taro@example.com>');
  });

  it("氏名がない場合はメールアドレスのみを返す", () => {
    expect(buildDraftRecipient("taro@example.com", "")).toBe("taro@example.com");
  });
});
