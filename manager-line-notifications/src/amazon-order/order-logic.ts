import { findCatalogMatches, listAllAliases } from "./catalog";
import type { CatalogEntry, OrderRecord, OrderStatus } from "./types";
import { ORDER_ACTIVE_STATUSES } from "./types";

type OrderRequestEvaluation =
  | { kind: "duplicate_event" }
  | { kind: "not_found"; knownAliases: string[] }
  | { kind: "ambiguous"; candidates: CatalogEntry[] }
  | { kind: "missing_asin" }
  | { kind: "invalid_quantity"; max: number | undefined }
  | { kind: "duplicate_pending"; receiptId: string }
  | { kind: "accepted"; entry: CatalogEntry; quantity: number; priceCap: number | undefined };

// 注文依頼の受付可否を判定する（シートI/Oを含まない純粋関数。GAS側はこの結果に応じて追記・返信する）。
function evaluateOrderRequest(input: {
  productQuery: string;
  quantityInput: number | undefined;
  catalog: CatalogEntry[];
  existingOrders: OrderRecord[];
  webhookEventId: string;
}): OrderRequestEvaluation {
  // 再配信対策を最優先で見る。カタログ照合に先立って同一イベントの行の有無を確認する。
  if (input.existingOrders.some((order) => order.webhookEventId === input.webhookEventId)) {
    return { kind: "duplicate_event" };
  }

  const candidates = findCatalogMatches(input.productQuery, input.catalog);
  if (candidates.length === 0) {
    return { kind: "not_found", knownAliases: listAllAliases(input.catalog) };
  }
  if (candidates.length > 1) {
    return { kind: "ambiguous", candidates };
  }

  const entry = candidates[0];
  if (!entry.asin) return { kind: "missing_asin" };

  const quantity = input.quantityInput ?? entry.defaultQuantity;
  if (quantity < 1 || (entry.maxQuantity !== undefined && quantity > entry.maxQuantity)) {
    return { kind: "invalid_quantity", max: entry.maxQuantity };
  }

  const duplicatePending = input.existingOrders.find(
    (order) => order.asin === entry.asin && ORDER_ACTIVE_STATUSES.includes(order.status),
  );
  if (duplicatePending) {
    return { kind: "duplicate_pending", receiptId: duplicatePending.receiptId };
  }

  return {
    kind: "accepted",
    entry,
    quantity,
    priceCap: entry.priceCapPerUnit === undefined ? undefined : entry.priceCapPerUnit * quantity,
  };
}

type OrderCancelEvaluation =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_cancellable"; status: OrderStatus };

function evaluateOrderCancel(order: OrderRecord | undefined): OrderCancelEvaluation {
  if (!order) return { kind: "not_found" };
  if (!ORDER_ACTIVE_STATUSES.includes(order.status)) {
    return { kind: "not_cancellable", status: order.status };
  }
  return { kind: "cancelled" };
}

// 通知日時が未記入の結果（カート追加済・注文済・要確認・失敗）を通知対象として選ぶ。
// ジェネリクスで受け取った配列の要素型（OrderRow等の拡張型）をそのまま返す。
function selectUnnotifiedResults<T extends OrderRecord>(orders: T[]): T[] {
  return orders.filter(
    (order) =>
      order.notifiedAt === undefined &&
      (order.status === "カート追加済" ||
        order.status === "注文済" ||
        order.status === "要確認" ||
        order.status === "失敗"),
  );
}

export type { OrderCancelEvaluation, OrderRequestEvaluation };
export { evaluateOrderCancel, evaluateOrderRequest, selectUnnotifiedResults };
