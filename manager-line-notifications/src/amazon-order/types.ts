type CatalogEntry = {
  productName: string;
  aliases: string[];
  asin: string | undefined;
  defaultQuantity: number;
  maxQuantity: number | undefined;
  priceCapPerUnit: number | undefined;
};

// 購入側（Claude Codeによる定期実行）が書き戻すまでの状態遷移: 未処理 → (カート追加済 | 注文済 | 要確認 | 失敗)。
// カートに入れるところまでをClaudeが行い、注文の確定はAmazonアプリで人が行う暫定運用のため「カート追加済」がある。
// キャンセルは未処理から到達する終端状態。
type OrderStatus = "未処理" | "カート追加済" | "注文済" | "要確認" | "失敗" | "キャンセル";

type OrderRecord = {
  receiptId: string;
  receivedAt: Date;
  requesterId: string;
  asin: string | undefined;
  productName: string;
  quantity: number;
  priceCap: number | undefined;
  status: OrderStatus;
  orderNumber: string;
  billedAmount: unknown;
  processedAt: Date | undefined;
  note: string;
  notifiedAt: Date | undefined;
  webhookEventId: string;
};

// 取消・同一ASIN重複チェックの対象となる「まだ購入側に処理されていない」状態。
const ORDER_ACTIVE_STATUSES: readonly OrderStatus[] = ["未処理"];
const ORDER_RESULT_STATUSES: readonly OrderStatus[] = ["カート追加済", "注文済", "要確認", "失敗"];

export type { CatalogEntry, OrderRecord, OrderStatus };
export { ORDER_ACTIVE_STATUSES, ORDER_RESULT_STATUSES };
