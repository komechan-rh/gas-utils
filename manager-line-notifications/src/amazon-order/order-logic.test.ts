import { describe, expect, it } from "vitest";
import { evaluateOrderCancel, evaluateOrderRequest, selectUnnotifiedResults } from "./order-logic";
import type { CatalogEntry, OrderRecord } from "./types";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    productName: "トイレットペーパー",
    aliases: ["トイレットペーパー", "トイペ"],
    asin: "B000AAAAAA",
    defaultQuantity: 1,
    maxQuantity: 5,
    priceCapPerUnit: 500,
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    receiptId: "AB3CD",
    receivedAt: new Date(2026, 0, 1),
    requesterId: "",
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
    webhookEventId: "event-1",
    ...overrides,
  };
}

describe("evaluateOrderRequest", () => {
  it("同一webhookEventIdの行が既にある場合はカタログ照合より先にduplicate_eventになる", () => {
    const result = evaluateOrderRequest({
      productQuery: "該当なし商品",
      quantityInput: undefined,
      catalog: [],
      existingOrders: [order({ webhookEventId: "event-1" })],
      webhookEventId: "event-1",
    });
    expect(result).toEqual({ kind: "duplicate_event" });
  });

  it("カタログに無い商品はnot_found", () => {
    const result = evaluateOrderRequest({
      productQuery: "存在しない商品",
      quantityInput: undefined,
      catalog: [entry()],
      existingOrders: [],
      webhookEventId: "event-2",
    });
    expect(result).toMatchObject({ kind: "not_found" });
  });

  it("別名が複数のカタログ行に一致する場合はambiguous", () => {
    const duplicatedAlias = [entry({ productName: "A" }), entry({ productName: "B" })];
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: undefined,
      catalog: duplicatedAlias,
      existingOrders: [],
      webhookEventId: "event-2",
    });
    expect(result).toMatchObject({ kind: "ambiguous" });
  });

  it("ASINが無いカタログ行はmissing_asin", () => {
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: undefined,
      catalog: [entry({ asin: undefined })],
      existingOrders: [],
      webhookEventId: "event-2",
    });
    expect(result).toEqual({ kind: "missing_asin" });
  });

  it("数量が1未満または上限を超える場合はinvalid_quantity", () => {
    expect(
      evaluateOrderRequest({
        productQuery: "トイペ",
        quantityInput: 0,
        catalog: [entry()],
        existingOrders: [],
        webhookEventId: "event-2",
      }),
    ).toEqual({ kind: "invalid_quantity", max: 5 });

    expect(
      evaluateOrderRequest({
        productQuery: "トイペ",
        quantityInput: 6,
        catalog: [entry()],
        existingOrders: [],
        webhookEventId: "event-2",
      }),
    ).toEqual({ kind: "invalid_quantity", max: 5 });
  });

  it("上限数量が無い場合は数量の上限チェックをしない", () => {
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: 100,
      catalog: [entry({ maxQuantity: undefined })],
      existingOrders: [],
      webhookEventId: "event-2",
    });
    expect(result).toMatchObject({ kind: "accepted", quantity: 100 });
  });

  it("同一ASINが未処理で既にある場合はduplicate_pending", () => {
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: undefined,
      catalog: [entry()],
      existingOrders: [order({ receiptId: "EXIST1", webhookEventId: "other-event" })],
      webhookEventId: "event-2",
    });
    expect(result).toEqual({ kind: "duplicate_pending", receiptId: "EXIST1" });
  });

  it("同一ASINでもキャンセル済なら重複とみなさず受け付ける", () => {
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: 2,
      catalog: [entry()],
      existingOrders: [
        order({ receiptId: "EXIST1", status: "キャンセル", webhookEventId: "other-event" }),
      ],
      webhookEventId: "event-2",
    });
    expect(result).toMatchObject({ kind: "accepted", quantity: 2, priceCap: 1000 });
  });

  it("価格上限が設定されていない場合はpriceCapがundefinedになる", () => {
    const result = evaluateOrderRequest({
      productQuery: "トイペ",
      quantityInput: 2,
      catalog: [entry({ priceCapPerUnit: undefined })],
      existingOrders: [],
      webhookEventId: "event-2",
    });
    expect(result).toMatchObject({ kind: "accepted", priceCap: undefined });
  });
});

describe("evaluateOrderCancel", () => {
  it("受付IDが見つからない場合はnot_found", () => {
    expect(evaluateOrderCancel(undefined)).toEqual({ kind: "not_found" });
  });

  it("未処理なら取消できる", () => {
    expect(evaluateOrderCancel(order({ status: "未処理" }))).toEqual({ kind: "cancelled" });
  });

  it.each(["注文済", "カート追加済", "要確認", "失敗", "キャンセル"] as const)(
    "%sの場合は取消できない",
    (status) => {
      expect(evaluateOrderCancel(order({ status }))).toEqual({ kind: "not_cancellable", status });
    },
  );
});

describe("selectUnnotifiedResults", () => {
  it("通知日時が未記入の結果行のみを選ぶ", () => {
    const orders = [
      order({ receiptId: "A", status: "注文済", notifiedAt: undefined }),
      order({ receiptId: "B", status: "カート追加済", notifiedAt: undefined }),
      order({ receiptId: "C", status: "要確認", notifiedAt: new Date() }),
      order({ receiptId: "D", status: "未処理", notifiedAt: undefined }),
      order({ receiptId: "E", status: "失敗", notifiedAt: undefined }),
    ];
    expect(selectUnnotifiedResults(orders).map((o) => o.receiptId)).toEqual(["A", "B", "E"]);
  });
});
