import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callRoutineFireApi,
  decideRoutineAction,
  getRoutineFireConfig,
  isWithinFireWindow,
  loadRoutineFireState,
  type ReceiptFireRecord,
  saveRoutineFireState,
  toDateKey,
} from "./routine-trigger";

let properties: Map<string, string>;

function stubProperties() {
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key),
      setProperty: (key: string, value: string) => properties.set(key, value),
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRoutineFireConfig", () => {
  it("URL・トークンの両方が設定されている場合のみ値を返す", () => {
    properties = new Map([
      ["ROUTINE_FIRE_URL", "https://example.com/routine-fire"],
      ["ROUTINE_FIRE_TOKEN", "dummy-token"],
    ]);
    stubProperties();

    expect(getRoutineFireConfig()).toEqual({
      url: "https://example.com/routine-fire",
      token: "dummy-token",
    });
  });

  it("未設定の場合はundefinedを返す", () => {
    properties = new Map();
    stubProperties();

    expect(getRoutineFireConfig()).toBeUndefined();
  });
});

describe("isWithinFireWindow", () => {
  it("8:00〜19:59はtrue、それ以外はfalseを返す", () => {
    expect(isWithinFireWindow(new Date(2026, 0, 1, 8, 0))).toBe(true);
    expect(isWithinFireWindow(new Date(2026, 0, 1, 19, 59))).toBe(true);
    expect(isWithinFireWindow(new Date(2026, 0, 1, 7, 59))).toBe(false);
    expect(isWithinFireWindow(new Date(2026, 0, 1, 20, 0))).toBe(false);
  });
});

describe("loadRoutineFireState / saveRoutineFireState", () => {
  it("未保存の場合は空の状態を返す", () => {
    properties = new Map();
    stubProperties();

    expect(loadRoutineFireState()).toEqual({
      receipts: {},
      dailyFiredDate: "",
      dailyFiredCount: 0,
    });
  });

  it("保存した状態をそのまま読み戻せる", () => {
    properties = new Map();
    stubProperties();

    const state = {
      receipts: {
        AB3CD: { firedAt: "2026-01-01T00:00:00.000Z", restarted: false, notified: false },
      },
      dailyFiredDate: "2026-1-1",
      dailyFiredCount: 2,
    };
    saveRoutineFireState(state);

    expect(loadRoutineFireState()).toEqual(state);
  });
});

describe("decideRoutineAction", () => {
  function record(overrides: Partial<ReceiptFireRecord> = {}): ReceiptFireRecord {
    return { firedAt: "2026-01-01T00:00:00.000Z", restarted: false, notified: false, ...overrides };
  }

  it("未起動の受付IDは起動対象になる", () => {
    const result = decideRoutineAction(["AB3CD"], {}, new Date(2026, 0, 1, 9, 0));

    expect(result.idsToFire).toEqual(["AB3CD"]);
    expect(result.idsToNotify).toEqual([]);
  });

  it("起動から6時間未満の受付IDは起動対象にならない", () => {
    const now = new Date(2026, 0, 1, 9, 0);
    const receipts = { AB3CD: record({ firedAt: new Date(2026, 0, 1, 5, 0).toISOString() }) };

    const result = decideRoutineAction(["AB3CD"], receipts, now);

    expect(result.idsToFire).toEqual([]);
    expect(result.idsToNotify).toEqual([]);
    expect(result.cleanedReceipts).toEqual(receipts);
  });

  it("起動から6時間経過し未再起動なら再起動対象になる", () => {
    const now = new Date(2026, 0, 1, 12, 0);
    const receipts = { AB3CD: record({ firedAt: new Date(2026, 0, 1, 6, 0).toISOString() }) };

    const result = decideRoutineAction(["AB3CD"], receipts, now);

    expect(result.idsToFire).toEqual(["AB3CD"]);
    expect(result.idsToNotify).toEqual([]);
  });

  it("再起動済みで6時間経過してもなお未処理なら通知対象になり、起動対象にはならない", () => {
    const now = new Date(2026, 0, 1, 18, 0);
    const receipts = {
      AB3CD: record({ firedAt: new Date(2026, 0, 1, 12, 0).toISOString(), restarted: true }),
    };

    const result = decideRoutineAction(["AB3CD"], receipts, now);

    expect(result.idsToFire).toEqual([]);
    expect(result.idsToNotify).toEqual(["AB3CD"]);
  });

  it("通知済みの受付IDは起動・通知のいずれの対象にもならない", () => {
    const now = new Date(2026, 0, 1, 18, 0);
    const receipts = {
      AB3CD: record({
        firedAt: new Date(2026, 0, 1, 0, 0).toISOString(),
        restarted: true,
        notified: true,
      }),
    };

    const result = decideRoutineAction(["AB3CD"], receipts, now);

    expect(result.idsToFire).toEqual([]);
    expect(result.idsToNotify).toEqual([]);
    expect(result.cleanedReceipts).toEqual(receipts);
  });

  it("未処理でなくなった受付ID（ステータス変更・行削除）の記録は取り除く", () => {
    const now = new Date(2026, 0, 1, 9, 0);
    const receipts = { AB3CD: record() };

    const result = decideRoutineAction([], receipts, now);

    expect(result.cleanedReceipts).toEqual({});
  });
});

describe("callRoutineFireApi", () => {
  const config = { url: "https://example.com/routine-fire", token: "dummy-token" };

  it("指定のURL・ヘッダー・本文でPOSTし、セッションURLを返す", () => {
    const fetch = vi.fn(() => ({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          type: "routine_fire",
          claude_code_session_id: "session-1",
          claude_code_session_url: "https://claude.ai/code/session_1",
        }),
    }));
    vi.stubGlobal("UrlFetchApp", { fetch });

    const result = callRoutineFireApi(config, "未処理 1 件（受付ID: AB3CD）");

    expect(fetch).toHaveBeenCalledWith("https://example.com/routine-fire", {
      method: "post",
      headers: {
        Authorization: "Bearer dummy-token",
        "anthropic-version": "2026-10-21",
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({ text: "未処理 1 件（受付ID: AB3CD）" }),
      muteHttpExceptions: true,
    });
    expect(result).toEqual({ sessionUrl: "https://claude.ai/code/session_1" });
  });

  it("200以外の場合はステータスコードのみを含むエラーを投げ、応答本文を含めない", () => {
    vi.stubGlobal("UrlFetchApp", {
      fetch: vi.fn(() => ({
        getResponseCode: () => 500,
        getContentText: () => `応答本文にはトークンの${config.token}が含まれるとみなす`,
      })),
    });

    expect(() => callRoutineFireApi(config, "text")).toThrow("ステータスコード 500");
    try {
      callRoutineFireApi(config, "text");
    } catch (error) {
      expect((error as Error).message).not.toContain(config.token);
    }
  });
});

describe("toDateKey", () => {
  it("同日は同じキー、別日は異なるキーになる", () => {
    expect(toDateKey(new Date(2026, 0, 1, 0, 0))).toBe(toDateKey(new Date(2026, 0, 1, 23, 59)));
    expect(toDateKey(new Date(2026, 0, 1))).not.toBe(toDateKey(new Date(2026, 0, 2)));
  });
});
