import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../line-client", () => ({ replyTextMessage: vi.fn() }));
vi.mock("./sheet", () => ({
  listUnprocessedOrders: vi.fn(),
  OrderSheetConfigError: class OrderSheetConfigError extends Error {},
  resolveOrderCancel: vi.fn(),
  submitOrderRequest: vi.fn(),
}));

import { replyTextMessage } from "../line-client";
import { findOrderCommand } from "./commands";
import {
  listUnprocessedOrders,
  OrderSheetConfigError,
  resolveOrderCancel,
  submitOrderRequest,
} from "./sheet";

const context = { replyToken: "reply-1", userId: "user-1", webhookEventId: "event-1" };

afterEach(() => vi.resetAllMocks());

describe("findOrderCommand", () => {
  it("注文依頼の文言からrequesterId・webhookEventIdを渡してsubmitOrderRequestを呼ぶ", () => {
    vi.mocked(submitOrderRequest).mockReturnValue({
      kind: "accepted",
      entry: {
        productName: "トイレットペーパー",
        aliases: [],
        asin: "B000AAAAAA",
        defaultQuantity: 1,
        maxQuantity: undefined,
        priceCapPerUnit: undefined,
      },
      quantity: 2,
      priceCap: undefined,
      receiptId: "AB3CD",
    });

    const command = findOrderCommand("トイレットペーパーを2つ注文して");
    expect(command).toBeDefined();
    command?.(context);

    expect(submitOrderRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        productQuery: "トイレットペーパー",
        quantityInput: 2,
        requesterId: "user-1",
        webhookEventId: "event-1",
      }),
    );
    expect(replyTextMessage).toHaveBeenCalledWith(
      "reply-1",
      expect.stringContaining("受付ID: AB3CD"),
    );
  });

  it("userIdが無い場合は依頼者IDを空文字にする", () => {
    vi.mocked(submitOrderRequest).mockReturnValue({ kind: "not_found", knownAliases: [] });

    findOrderCommand("注文 存在しない商品")?.({ replyToken: "reply-1", webhookEventId: "event-1" });

    expect(submitOrderRequest).toHaveBeenCalledWith(expect.objectContaining({ requesterId: "" }));
  });

  it("再配信（duplicate_event）では返信しない", () => {
    vi.mocked(submitOrderRequest).mockReturnValue({ kind: "duplicate_event" });

    findOrderCommand("注文 トイレットペーパー")?.(context);

    expect(replyTextMessage).not.toHaveBeenCalled();
  });

  it("「注文取消 <ID>」でresolveOrderCancelを呼ぶ", () => {
    vi.mocked(resolveOrderCancel).mockReturnValue({ kind: "cancelled" });

    findOrderCommand("注文取消 AB3CD")?.(context);

    expect(resolveOrderCancel).toHaveBeenCalledWith("AB3CD");
    expect(replyTextMessage).toHaveBeenCalledWith("reply-1", "注文をキャンセルしました。");
  });

  it("「注文リスト」でlistUnprocessedOrdersを呼ぶ", () => {
    vi.mocked(listUnprocessedOrders).mockReturnValue([]);

    findOrderCommand("注文リスト")?.(context);

    expect(listUnprocessedOrders).toHaveBeenCalled();
    expect(replyTextMessage).toHaveBeenCalledWith("reply-1", "未処理の注文はありません。");
  });

  it("注文系のパターンに一致しない発言はundefined", () => {
    expect(findOrderCommand("こんにちは")).toBeUndefined();
  });

  it("シート設定不足のエラーは定型文で返信する", () => {
    vi.mocked(submitOrderRequest).mockImplementation(() => {
      throw new OrderSheetConfigError("シート設定が不足しています。");
    });

    findOrderCommand("注文 トイレットペーパー")?.(context);

    expect(replyTextMessage).toHaveBeenCalledWith("reply-1", "シート設定が不足しています。");
  });
});
