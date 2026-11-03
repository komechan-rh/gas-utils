import { replyTextMessage } from "../line-client";
import type { LineCommandContext, LineCommandHandler } from "../line-commands";
import { formatOrderCancelReply, formatOrderListReply, formatOrderRequestReply } from "./formatter";
import { parseOrderCancelCommand, parseOrderRequestCommand } from "./parse";
import {
  listUnprocessedOrders,
  OrderSheetConfigError,
  resolveOrderCancel,
  submitOrderRequest,
} from "./sheet";

const SHEET_CONFIG_ERROR_REPLY = "シート設定が不足しています。";

// シート設定不足（見出し欠落）はログに詳細を出した上で、返信は定型文に留める。
function replyOrGuard(context: LineCommandContext, run: () => string | undefined): void {
  let text: string | undefined;
  try {
    text = run();
  } catch (error) {
    if (!(error instanceof OrderSheetConfigError)) throw error;
    text = SHEET_CONFIG_ERROR_REPLY;
  }
  if (text !== undefined) replyTextMessage(context.replyToken, text);
}

function handleOrderRequest(
  context: LineCommandContext,
  productQuery: string,
  quantity: number | undefined,
): void {
  replyOrGuard(context, () => {
    const result = submitOrderRequest({
      productQuery,
      quantityInput: quantity,
      requesterId: context.userId ?? "",
      webhookEventId: context.webhookEventId,
      now: new Date(),
    });
    // 再配信対策: 同一イベントの行が既にある場合は何もしない。
    if (result.kind === "duplicate_event") return undefined;
    return formatOrderRequestReply(result);
  });
}

function handleOrderCancel(context: LineCommandContext, receiptId: string): void {
  replyOrGuard(context, () => formatOrderCancelReply(resolveOrderCancel(receiptId)));
}

function handleOrderList(context: LineCommandContext): void {
  replyOrGuard(context, () => formatOrderListReply(listUnprocessedOrders()));
}

// 完全一致の対応表に無い発言のうち、注文系コマンドのパターンに一致するものだけを扱う。
function findOrderCommand(text: string): LineCommandHandler | undefined {
  const request = parseOrderRequestCommand(text);
  if (request) {
    return (context) => handleOrderRequest(context, request.productQuery, request.quantity);
  }

  const cancelReceiptId = parseOrderCancelCommand(text);
  if (cancelReceiptId) {
    return (context) => handleOrderCancel(context, cancelReceiptId);
  }

  if (text === "注文リスト") return handleOrderList;

  return undefined;
}

export { findOrderCommand };
