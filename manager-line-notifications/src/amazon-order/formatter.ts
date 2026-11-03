import type { OrderCancelEvaluation } from "./order-logic";
import type { SubmitOrderRequestResult } from "./sheet";
import type { OrderRecord } from "./types";

// 呼び出し側はkind: "duplicate_event"の場合はこの関数を呼ばず、何も返信しない。
function formatOrderRequestReply(evaluation: SubmitOrderRequestResult): string {
  switch (evaluation.kind) {
    case "duplicate_event":
      // 呼び出し側（commands.ts）が返信そのものを省略するため、ここには到達しない。
      throw new Error("duplicate_event は呼び出し側で返信をスキップすること。");
    case "not_found": {
      const aliases = [...new Set(evaluation.knownAliases)];
      return aliases.length === 0
        ? "カタログに商品が登録されていません。"
        : `カタログに登録されていない商品です。登録済みの別名: ${aliases.join("、")}`;
    }
    case "ambiguous":
      return `商品名が複数の候補に一致しました。別名を具体的にしてください: ${evaluation.candidates
        .map((entry) => entry.productName)
        .join("、")}`;
    case "missing_asin":
      return "Amazonリンク未登録のため注文できません。";
    case "invalid_quantity":
      return evaluation.max === undefined
        ? "数量は1個以上を指定してください。"
        : `数量は1〜${evaluation.max}個の範囲で指定してください。`;
    case "duplicate_pending":
      return `すでに未処理の注文があります（受付ID: ${evaluation.receiptId}）。`;
    case "accepted": {
      const priceCapLabel =
        evaluation.priceCap === undefined
          ? ""
          : `、価格上限 ${evaluation.priceCap.toLocaleString()}円`;
      return `${evaluation.entry.productName} を ${evaluation.quantity}個${priceCapLabel}で受け付けました（受付ID: ${evaluation.receiptId}）。毎日の定期実行で処理します。`;
    }
  }
}

function formatOrderCancelReply(evaluation: OrderCancelEvaluation): string {
  switch (evaluation.kind) {
    case "not_found":
      return "指定された受付IDの注文が見つかりません。";
    case "cancelled":
      return "注文をキャンセルしました。";
    case "not_cancellable":
      return `この注文は「${evaluation.status}」のため取消できません。`;
  }
}

function formatOrderListReply(orders: OrderRecord[]): string {
  if (orders.length === 0) return "未処理の注文はありません。";

  return orders
    .map((order) => `・${order.productName} ${order.quantity}個 / 受付ID: ${order.receiptId}`)
    .join("\n");
}

function formatOrderResultLine(order: OrderRecord): string {
  const header = `${order.productName}（${order.quantity}個）`;
  if (order.status === "カート追加済") {
    return [
      `${header}: カートに追加しました。Amazonアプリで注文を確定してください。`,
      order.note && `備考: ${order.note}`,
    ]
      .filter(Boolean)
      .join(" / ");
  }

  return [
    `${header}: ${order.status}`,
    order.orderNumber && `注文番号: ${order.orderNumber}`,
    order.billedAmount !== undefined &&
      order.billedAmount !== "" &&
      `ご請求額: ${order.billedAmount}`,
    order.note && `備考: ${order.note}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatOrderResultNotification(orders: OrderRecord[]): string {
  return orders.map(formatOrderResultLine).join("\n");
}

export {
  formatOrderCancelReply,
  formatOrderListReply,
  formatOrderRequestReply,
  formatOrderResultNotification,
};
