import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptFireRecord, RoutineFireState } from "./amazon-order/routine-trigger";
import type { OrderRecord } from "./amazon-order/types";

vi.mock("./amazon-order/sheet", () => ({ listUnprocessedOrders: vi.fn() }));
vi.mock("./amazon-order/routine-trigger", () => ({
  callRoutineFireApi: vi.fn(),
  DAILY_FIRE_LIMIT: 4,
  decideRoutineAction: vi.fn(),
  getRoutineFireConfig: vi.fn(),
  isWithinFireWindow: vi.fn(),
  loadRoutineFireState: vi.fn(),
  saveRoutineFireState: vi.fn(),
  toDateKey: vi.fn(),
  withRoutineFireLock: vi.fn((fn: () => void) => fn()),
}));
vi.mock("./line-client", () => ({ pushTextMessage: vi.fn() }));

import {
  callRoutineFireApi,
  decideRoutineAction,
  getRoutineFireConfig,
  isWithinFireWindow,
  loadRoutineFireState,
  saveRoutineFireState,
  toDateKey,
  withRoutineFireLock,
} from "./amazon-order/routine-trigger";
import { listUnprocessedOrders } from "./amazon-order/sheet";
import { fireCartRoutineIfPending } from "./index";
import { pushTextMessage } from "./line-client";

const CONFIG = { url: "https://example.com/routine-fire", token: "dummy-token" };
const NOW = new Date(2026, 0, 1, 9, 0);
const TODAY_KEY = "2026-1-1";

function order(receiptId: string): OrderRecord {
  return {
    receiptId,
    receivedAt: new Date(2026, 0, 1),
    requesterId: "user-1",
    asin: "B000AAAAAA",
    productName: "トイレットペーパー",
    quantity: 1,
    priceCap: 500,
    status: "未処理",
    orderNumber: "",
    billedAmount: "",
    processedAt: undefined,
    note: "",
    notifiedAt: undefined,
    webhookEventId: `event-${receiptId}`,
  };
}

function emptyState(overrides: Partial<RoutineFireState> = {}): RoutineFireState {
  return { receipts: {}, dailyFiredDate: "", dailyFiredCount: 0, ...overrides };
}

function noAction(cleanedReceipts: Record<string, ReceiptFireRecord> = {}) {
  return { cleanedReceipts, idsToNotify: [] as string[], idsToFire: [] as string[] };
}

describe("fireCartRoutineIfPending", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(isWithinFireWindow).mockReturnValue(true);
    vi.mocked(toDateKey).mockReturnValue(TODAY_KEY);
    vi.mocked(loadRoutineFireState).mockReturnValue(emptyState());
    vi.mocked(withRoutineFireLock).mockImplementation((fn: () => void) => fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("ROUTINE_FIRE_URL/ROUTINE_FIRE_TOKENが未設定ならAPIを呼ばない", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(undefined);

    fireCartRoutineIfPending();

    expect(isWithinFireWindow).not.toHaveBeenCalled();
    expect(listUnprocessedOrders).not.toHaveBeenCalled();
    expect(callRoutineFireApi).not.toHaveBeenCalled();
  });

  it("日本時間8:00〜19:59の対象時間外ならAPIを呼ばない", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(isWithinFireWindow).mockReturnValue(false);

    fireCartRoutineIfPending();

    expect(listUnprocessedOrders).not.toHaveBeenCalled();
    expect(callRoutineFireApi).not.toHaveBeenCalled();
  });

  it("新規の受付IDがあればAPIを呼び、起動記録を保存する", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    vi.mocked(decideRoutineAction).mockReturnValue({
      cleanedReceipts: {},
      idsToNotify: [],
      idsToFire: ["AB3CD"],
    });
    vi.mocked(callRoutineFireApi).mockReturnValue({
      sessionUrl: "https://claude.ai/code/session_1",
    });

    fireCartRoutineIfPending();

    expect(decideRoutineAction).toHaveBeenCalledWith(["AB3CD"], {}, NOW);
    expect(callRoutineFireApi).toHaveBeenCalledWith(CONFIG, "未処理 1 件（受付ID: AB3CD）");
    expect(saveRoutineFireState).toHaveBeenLastCalledWith({
      receipts: { AB3CD: { firedAt: NOW.toISOString(), restarted: false, notified: false } },
      dailyFiredDate: TODAY_KEY,
      dailyFiredCount: 1,
    });
    expect(pushTextMessage).not.toHaveBeenCalled();
  });

  it("既起動IDのみ（再起動・通知の対象外）ならAPIを呼ばない", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    const cleanedReceipts = {
      AB3CD: { firedAt: NOW.toISOString(), restarted: false, notified: false },
    };
    vi.mocked(decideRoutineAction).mockReturnValue(noAction(cleanedReceipts));

    fireCartRoutineIfPending();

    expect(callRoutineFireApi).not.toHaveBeenCalled();
    expect(saveRoutineFireState).toHaveBeenCalledWith(emptyState({ receipts: cleanedReceipts }));
  });

  it("起動から6時間経過した受付IDの再起動では、restartedをtrueにして保存する", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    const cleanedReceipts = {
      AB3CD: {
        firedAt: new Date(2026, 0, 1, 2, 0).toISOString(),
        restarted: false,
        notified: false,
      },
    };
    vi.mocked(decideRoutineAction).mockReturnValue({
      cleanedReceipts,
      idsToNotify: [],
      idsToFire: ["AB3CD"],
    });
    vi.mocked(callRoutineFireApi).mockReturnValue({
      sessionUrl: "https://claude.ai/code/session_1",
    });

    fireCartRoutineIfPending();

    expect(callRoutineFireApi).toHaveBeenCalledWith(CONFIG, "未処理 1 件（受付ID: AB3CD）");
    expect(saveRoutineFireState).toHaveBeenLastCalledWith({
      receipts: { AB3CD: { firedAt: NOW.toISOString(), restarted: true, notified: false } },
      dailyFiredDate: TODAY_KEY,
      dailyFiredCount: 1,
    });
  });

  it("再起動後も6時間たって未処理のままの受付IDは、通知を1回送り以後起動しない", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    const cleanedReceipts = {
      AB3CD: {
        firedAt: new Date(2026, 0, 1, 2, 0).toISOString(),
        restarted: true,
        notified: false,
      },
    };
    vi.mocked(decideRoutineAction).mockReturnValue({
      cleanedReceipts,
      idsToNotify: ["AB3CD"],
      idsToFire: [],
    });
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key === "LINE_GROUP_ID" ? "group-1" : ""),
      }),
    });

    fireCartRoutineIfPending();

    expect(callRoutineFireApi).not.toHaveBeenCalled();
    expect(pushTextMessage).toHaveBeenCalledWith(
      "group-1",
      "受付ID AB3CD がカートに追加されていません。定期実行の結果を確認してください。",
    );
    expect(saveRoutineFireState).toHaveBeenCalledWith(
      emptyState({
        receipts: { AB3CD: { ...cleanedReceipts.AB3CD, notified: true } },
      }),
    );
  });

  it("本日の起動回数が上限（4回）に達している場合はAPIを呼ばない", () => {
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    vi.mocked(loadRoutineFireState).mockReturnValue(
      emptyState({ dailyFiredDate: TODAY_KEY, dailyFiredCount: 4 }),
    );
    vi.mocked(decideRoutineAction).mockReturnValue({
      cleanedReceipts: {},
      idsToNotify: [],
      idsToFire: ["AB3CD"],
    });

    fireCartRoutineIfPending();

    expect(callRoutineFireApi).not.toHaveBeenCalled();
  });

  it("APIが失敗した場合は起動記録を保存せず例外を投げ、LINEへ通知する（トークン・応答本文は含めない）", () => {
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key === "LINE_GROUP_ID" ? "group-1" : ""),
      }),
    });
    vi.mocked(getRoutineFireConfig).mockReturnValue(CONFIG);
    vi.mocked(listUnprocessedOrders).mockReturnValue([order("AB3CD")]);
    vi.mocked(decideRoutineAction).mockReturnValue({
      cleanedReceipts: {},
      idsToNotify: [],
      idsToFire: ["AB3CD"],
    });
    vi.mocked(callRoutineFireApi).mockImplementation(() => {
      throw new Error("ステータスコード 500");
    });

    expect(() => fireCartRoutineIfPending()).toThrow("ステータスコード 500");
    expect(saveRoutineFireState).toHaveBeenCalledOnce();
    expect(saveRoutineFireState).toHaveBeenCalledWith(emptyState());
    expect(pushTextMessage).toHaveBeenCalledWith(
      "group-1",
      "カート追加の定期実行を起動できませんでした（ステータスコード 500）。",
    );
    const [, notifiedText] = vi.mocked(pushTextMessage).mock.calls[0];
    expect(notifiedText).not.toContain(CONFIG.token);
  });
});
