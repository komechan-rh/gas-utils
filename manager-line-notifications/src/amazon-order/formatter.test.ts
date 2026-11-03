import { describe, expect, it } from "vitest";
import {
  formatOrderCancelReply,
  formatOrderListReply,
  formatOrderRequestReply,
  formatOrderResultNotification,
} from "./formatter";
import type { SubmitOrderRequestResult } from "./sheet";
import type { CatalogEntry, OrderRecord } from "./types";

const entry: CatalogEntry = {
  productName: "トイレットペーパー",
  aliases: ["トイレットペーパー"],
  asin: "B000AAAAAA",
  defaultQuantity: 1,
  maxQuantity: 5,
  priceCapPerUnit: 500,
};

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    receiptId: "AB3CD",
    receivedAt: new Date(2026, 0, 1),
    requesterId: "",
    asin: "B000AAAAAA",
    productName: "トイレットペーパー",
    quantity: 2,
    priceCap: 1000,
    status: "注文済",
    orderNumber: "",
    billedAmount: "",
    processedAt: undefined,
    note: "",
    notifiedAt: undefined,
    webhookEventId: "event-1",
    ...overrides,
  };
}

describe("formatOrderRequestReply", () => {
  it("accepted: 商品名・数量・価格上限・受付IDを案内する", () => {
    const result: SubmitOrderRequestResult = {
      kind: "accepted",
      entry,
      quantity: 2,
      priceCap: 1000,
      receiptId: "AB3CD",
    };
    expect(formatOrderRequestReply(result)).toBe(
      "トイレットペーパー を 2個、価格上限 1,000円で受け付けました（受付ID: AB3CD）。毎日の定期実行で処理します。",
    );
  });

  it("accepted: 価格上限が無い場合は価格上限の記載を省く", () => {
    const result: SubmitOrderRequestResult = {
      kind: "accepted",
      entry,
      quantity: 2,
      priceCap: undefined,
      receiptId: "AB3CD",
    };
    expect(formatOrderRequestReply(result)).toBe(
      "トイレットペーパー を 2個で受け付けました（受付ID: AB3CD）。毎日の定期実行で処理します。",
    );
  });

  it("not_found: 登録済みの別名一覧を案内する", () => {
    expect(formatOrderRequestReply({ kind: "not_found", knownAliases: ["トイペ", "トイペ"] })).toBe(
      "カタログに登録されていない商品です。登録済みの別名: トイペ",
    );
  });

  it("not_found: カタログが空の場合は専用の文言にする", () => {
    expect(formatOrderRequestReply({ kind: "not_found", knownAliases: [] })).toBe(
      "カタログに商品が登録されていません。",
    );
  });

  it("ambiguous: 候補の商品名を列挙する", () => {
    expect(
      formatOrderRequestReply({
        kind: "ambiguous",
        candidates: [entry, { ...entry, productName: "別商品" }],
      }),
    ).toBe(
      "商品名が複数の候補に一致しました。別名を具体的にしてください: トイレットペーパー、別商品",
    );
  });

  it("missing_asin", () => {
    expect(formatOrderRequestReply({ kind: "missing_asin" })).toBe(
      "Amazonリンク未登録のため注文できません。",
    );
  });

  it("invalid_quantity: 上限ありとなしでメッセージを変える", () => {
    expect(formatOrderRequestReply({ kind: "invalid_quantity", max: 5 })).toBe(
      "数量は1〜5個の範囲で指定してください。",
    );
    expect(formatOrderRequestReply({ kind: "invalid_quantity", max: undefined })).toBe(
      "数量は1個以上を指定してください。",
    );
  });

  it("duplicate_pending: 既存の受付IDを案内する", () => {
    expect(formatOrderRequestReply({ kind: "duplicate_pending", receiptId: "EXIST1" })).toBe(
      "すでに未処理の注文があります（受付ID: EXIST1）。",
    );
  });
});

describe("formatOrderCancelReply", () => {
  it.each([
    [{ kind: "not_found" as const }, "指定された受付IDの注文が見つかりません。"],
    [{ kind: "cancelled" as const }, "注文をキャンセルしました。"],
    [
      { kind: "not_cancellable" as const, status: "注文済" as const },
      "この注文は「注文済」のため取消できません。",
    ],
  ])("%j -> %s", (evaluation, expected) => {
    expect(formatOrderCancelReply(evaluation)).toBe(expected);
  });
});

describe("formatOrderListReply", () => {
  it("未処理の注文がない場合はその旨を返す", () => {
    expect(formatOrderListReply([])).toBe("未処理の注文はありません。");
  });

  it("未処理の注文を列挙する", () => {
    expect(formatOrderListReply([order({ status: "未処理" })])).toBe(
      "・トイレットペーパー 2個 / 受付ID: AB3CD",
    );
  });
});

describe("formatOrderResultNotification", () => {
  it("カート追加済はアプリでの確定を案内する", () => {
    expect(formatOrderResultNotification([order({ status: "カート追加済", note: "在庫薄" })])).toBe(
      "トイレットペーパー（2個）: カートに追加しました。Amazonアプリで注文を確定してください。 / 備考: 在庫薄",
    );
  });

  it("注文済・要確認・失敗は注文番号・ご請求額・備考を含める", () => {
    const text = formatOrderResultNotification([
      order({ status: "注文済", orderNumber: "123-456", billedAmount: 1180, note: "備考テキスト" }),
    ]);
    expect(text).toBe(
      "トイレットペーパー（2個）: 注文済 / 注文番号: 123-456 / ご請求額: 1180 / 備考: 備考テキスト",
    );
  });
});
