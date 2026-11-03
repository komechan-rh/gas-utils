import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listUnprocessedOrders,
  OrderSheetConfigError,
  pullUnnotifiedResults,
  resolveOrderCancel,
  submitOrderRequest,
} from "./sheet";

const CATALOG_HEADER = ["品目", "Amazonリンク", "既定数量", "上限数量", "価格上限"];
// 実シートの既存列（品目・数量・依頼日時・注文日時）と追加列を混在させ、列順に依存しないことを確認する。
const ORDER_HEADER = [
  "品目",
  "数量",
  "依頼日時",
  "注文日時",
  "受付ID",
  "ASIN",
  "価格上限",
  "ステータス",
  "依頼者ID",
  "注文番号",
  "ご請求額",
  "処理日時",
  "備考",
  "通知日時",
  "イベントID",
];

function col(header: string): number {
  return ORDER_HEADER.indexOf(header);
}

let catalogValues: unknown[][];
let orderValues: unknown[][];
let properties: Map<string, string>;
const setValueSpy = vi.fn();
const appendRowSpy = vi.fn();
const releaseLock = vi.fn();
const waitLock = vi.fn();

function makeSheet(values: unknown[][]) {
  return {
    getSheetId: () => (values === catalogValues ? 111 : 222),
    getDataRange: () => ({ getValues: () => values }),
    getRange: (row: number, column: number) => ({
      setValue: (value: unknown) => {
        values[row - 1][column - 1] = value;
        setValueSpy(row, column, value);
      },
    }),
    appendRow: (row: unknown[]) => {
      values.push(row);
      appendRowSpy(row);
    },
  };
}

beforeEach(() => {
  properties = new Map([["ORDER_SPREADSHEET_ID", "test-sheet"]]);
  catalogValues = [
    CATALOG_HEADER,
    ["トイレットペーパー", "https://www.amazon.co.jp/dp/B000AAAAAA?psc=1", 1, 5, 500],
  ];
  orderValues = [ORDER_HEADER];

  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key) }),
  });
  vi.stubGlobal("LockService", { getScriptLock: () => ({ waitLock, releaseLock }) });
  vi.stubGlobal("SpreadsheetApp", {
    openById: () => ({
      getSheetByName: (name: string) =>
        name === "備品カタログ" ? makeSheet(catalogValues) : makeSheet(orderValues),
    }),
    flush: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("submitOrderRequest", () => {
  it("カタログに一致しない場合は登録せず、備品カタログのシートURLを返す", () => {
    const result = submitOrderRequest({
      productQuery: "存在しない商品",
      quantityInput: 1,
      requesterId: "user-1",
      webhookEventId: "event-nf",
      now: new Date(2026, 0, 1),
    });

    expect(result).toEqual({
      kind: "not_found",
      catalogUrl: "https://docs.google.com/spreadsheets/d/test-sheet/edit#gid=111",
    });
    expect(appendRowSpy).not.toHaveBeenCalled();
  });

  it("受付可能な依頼は未処理として1行追加する", () => {
    const now = new Date(2026, 0, 1, 9, 0);
    const result = submitOrderRequest({
      productQuery: "トイレットペーパー",
      quantityInput: undefined,
      requesterId: "user-1",
      webhookEventId: "event-1",
      now,
    });

    expect(result).toMatchObject({ kind: "accepted", quantity: 1, priceCap: 500 });
    expect(appendRowSpy).toHaveBeenCalledOnce();
    const [row] = appendRowSpy.mock.calls[0];
    expect(row[col("品目")]).toBe("トイレットペーパー");
    expect(row[col("数量")]).toBe(1);
    expect(row[col("依頼日時")]).toBe(now);
    expect(row[col("ASIN")]).toBe("B000AAAAAA");
    expect(row[col("価格上限")]).toBe(500);
    expect(row[col("ステータス")]).toBe("未処理");
    expect(row[col("依頼者ID")]).toBe("user-1");
    expect(row[col("イベントID")]).toBe("event-1");
    if (result.kind === "accepted") expect(row[col("受付ID")]).toBe(result.receiptId);
  });

  it("同一webhookEventIdの再配信では何も追加しない", () => {
    const input = {
      productQuery: "トイレットペーパー",
      quantityInput: undefined,
      requesterId: "user-1",
      webhookEventId: "event-1",
      now: new Date(2026, 0, 1),
    };
    submitOrderRequest(input);
    const result = submitOrderRequest(input);

    expect(result).toEqual({ kind: "duplicate_event" });
    expect(appendRowSpy).toHaveBeenCalledOnce();
  });
});

describe("resolveOrderCancel", () => {
  function seedOrder(status: string, receiptId = "AB3CD"): void {
    const row = ORDER_HEADER.map(() => "");
    row[col("受付ID")] = receiptId;
    row[col("ステータス")] = status;
    orderValues.push(row);
  }

  it("未処理ならキャンセルできる", () => {
    seedOrder("未処理");
    expect(resolveOrderCancel("AB3CD")).toEqual({ kind: "cancelled" });
    expect(orderValues[1][col("ステータス")]).toBe("キャンセル");
  });

  it("未処理以外は取消できない", () => {
    seedOrder("注文済");
    expect(resolveOrderCancel("AB3CD")).toEqual({ kind: "not_cancellable", status: "注文済" });
    expect(setValueSpy).not.toHaveBeenCalled();
  });

  it("存在しない受付IDはnot_found", () => {
    expect(resolveOrderCancel("NONE1")).toEqual({ kind: "not_found" });
  });
});

describe("listUnprocessedOrders / pullUnnotifiedResults", () => {
  function seedOrder(fields: Partial<Record<string, unknown>>): void {
    const row: unknown[] = ORDER_HEADER.map(() => "");
    for (const [header, value] of Object.entries(fields)) row[col(header)] = value;
    orderValues.push(row);
  }

  it("未処理の行のみを返す", () => {
    seedOrder({ 受付ID: "A", ステータス: "未処理", 品目: "商品A" });
    seedOrder({ 受付ID: "B", ステータス: "注文済", 品目: "商品B" });
    expect(listUnprocessedOrders().map((o) => o.receiptId)).toEqual(["A"]);
  });

  it("通知日時が未記入の結果行だけを通知対象にし、通知日時を記入する", () => {
    const now = new Date(2026, 0, 2, 10, 0);
    seedOrder({ 受付ID: "A", ステータス: "注文済", 品目: "商品A" });
    seedOrder({ 受付ID: "B", ステータス: "カート追加済", 品目: "商品B" });
    seedOrder({ 受付ID: "C", ステータス: "要確認", 品目: "商品C", 通知日時: new Date(2025, 0, 1) });
    seedOrder({ 受付ID: "D", ステータス: "未処理", 品目: "商品D" });

    const results = pullUnnotifiedResults(now);
    expect(results.map((o) => o.receiptId)).toEqual(["A", "B"]);
    expect(orderValues[1][col("通知日時")]).toBe(now);
    expect(orderValues[2][col("通知日時")]).toBe(now);
    expect(orderValues[3][col("通知日時")]).not.toBe(now);
  });

  it("対象が無ければ書き込みもflushもしない", () => {
    expect(pullUnnotifiedResults(new Date())).toEqual([]);
    expect(setValueSpy).not.toHaveBeenCalled();
  });
});

describe("シート設定の検証", () => {
  it("必要な見出しが欠けている場合はOrderSheetConfigErrorを投げる", () => {
    orderValues = [ORDER_HEADER.filter((header) => header !== "ASIN")];
    expect(() => listUnprocessedOrders()).toThrow(OrderSheetConfigError);
  });
});
