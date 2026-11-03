import { buildCatalogEntries, buildHeaderIndex } from "./catalog";
import {
  evaluateOrderCancel,
  evaluateOrderRequest,
  type OrderCancelEvaluation,
  type OrderRequestEvaluation,
  selectUnnotifiedResults,
} from "./order-logic";
import type { CatalogEntry, OrderRecord, OrderStatus } from "./types";

const SHEET_NAMES = { catalog: "備品カタログ", orderList: "備品購入リスト" } as const;

// 「品目」「数量」「依頼日時」「注文日時」は既存の実シートの列（列名はそのまま使う）。
// 残りはこの機能のために追加する列。
const ORDER_LIST_HEADERS = {
  productName: "品目",
  quantity: "数量",
  receivedAt: "依頼日時",
  orderedAt: "注文日時",
  receiptId: "受付ID",
  asin: "ASIN",
  priceCap: "価格上限",
  status: "ステータス",
  requesterId: "依頼者ID",
  orderNumber: "注文番号",
  billedAmount: "ご請求額",
  processedAt: "処理日時",
  note: "備考",
  notifiedAt: "通知日時",
  webhookEventId: "イベントID",
} as const;

// 受付IDは人が読み書きする短い識別子。0/O・1/I/lなど紛らわしい文字を除く。
const RECEIPT_ID_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const RECEIPT_ID_LENGTH = 5;

// 備品購入リストに必要な見出しが欠けている場合に投げる。シートへの自動列追加はしない。
class OrderSheetConfigError extends Error {}

function getOrderSpreadsheetId(): string {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("ORDER_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("ORDER_SPREADSHEET_ID がスクリプトプロパティに設定されていません。");
  }
  return spreadsheetId;
}

function getSheet(sheetName: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = SpreadsheetApp.openById(getOrderSpreadsheetId()).getSheetByName(sheetName);
  if (!sheet) throw new Error(`シート「${sheetName}」が見つかりません。`);
  return sheet;
}

function readCatalog(): CatalogEntry[] {
  return buildCatalogEntries(getSheet(SHEET_NAMES.catalog).getDataRange().getValues());
}

function toDateOrUndefined(value: unknown): Date | undefined {
  return value instanceof Date ? value : undefined;
}

type OrderRow = OrderRecord & { rowNumber: number };

function validateOrderListHeaders(headerIndex: Record<string, number>): void {
  const missing = Object.values(ORDER_LIST_HEADERS).filter(
    (header) => headerIndex[header] === undefined,
  );
  if (missing.length === 0) return;
  console.error(`備品購入リストに必要な見出しが不足しています: ${missing.join("、")}`);
  throw new OrderSheetConfigError("シート設定が不足しています。");
}

// 備品購入リストの値（1行目=ヘッダー）をOrderRow[]へ変換する。列順には依存しない。
function buildOrderRows(values: unknown[][], headerIndex: Record<string, number>): OrderRow[] {
  const column = (field: keyof typeof ORDER_LIST_HEADERS) => headerIndex[ORDER_LIST_HEADERS[field]];

  return values
    .slice(1)
    .map((row, dataIndex) => ({
      rowNumber: dataIndex + 2,
      receiptId: String(row[column("receiptId")] ?? "").trim(),
      receivedAt: toDateOrUndefined(row[column("receivedAt")]) ?? new Date(0),
      requesterId: String(row[column("requesterId")] ?? "").trim(),
      asin: String(row[column("asin")] ?? "").trim() || undefined,
      productName: String(row[column("productName")] ?? ""),
      quantity: Number(row[column("quantity")]) || 0,
      priceCap:
        row[column("priceCap")] === "" ? undefined : Number(row[column("priceCap")]) || undefined,
      status: String(row[column("status")] ?? "") as OrderStatus,
      orderNumber: String(row[column("orderNumber")] ?? ""),
      billedAmount: row[column("billedAmount")],
      processedAt: toDateOrUndefined(row[column("processedAt")]),
      note: String(row[column("note")] ?? ""),
      notifiedAt: toDateOrUndefined(row[column("notifiedAt")]),
      webhookEventId: String(row[column("webhookEventId")] ?? "").trim(),
    }))
    .filter((row) => row.receiptId !== "");
}

function generateReceiptId(existingIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let id = "";
    for (let i = 0; i < RECEIPT_ID_LENGTH; i++) {
      id += RECEIPT_ID_CHARS[Math.floor(Math.random() * RECEIPT_ID_CHARS.length)];
    }
    if (!existingIds.has(id)) return id;
  }
  throw new Error("受付IDの生成に失敗しました。");
}

// 既存行を壊さないよう、ヘッダーの位置に合わせて新規行を組み立てる（列順には依存しない）。
function buildOrderRowValues(headerRow: unknown[], record: OrderRecord): unknown[] {
  const valuesByHeader: Record<string, unknown> = {
    [ORDER_LIST_HEADERS.receiptId]: record.receiptId,
    [ORDER_LIST_HEADERS.receivedAt]: record.receivedAt,
    [ORDER_LIST_HEADERS.requesterId]: record.requesterId,
    [ORDER_LIST_HEADERS.asin]: record.asin ?? "",
    [ORDER_LIST_HEADERS.productName]: record.productName,
    [ORDER_LIST_HEADERS.quantity]: record.quantity,
    [ORDER_LIST_HEADERS.priceCap]: record.priceCap ?? "",
    [ORDER_LIST_HEADERS.status]: record.status,
    [ORDER_LIST_HEADERS.orderNumber]: record.orderNumber,
    [ORDER_LIST_HEADERS.billedAmount]: record.billedAmount ?? "",
    [ORDER_LIST_HEADERS.processedAt]: record.processedAt ?? "",
    [ORDER_LIST_HEADERS.note]: record.note,
    [ORDER_LIST_HEADERS.notifiedAt]: record.notifiedAt ?? "",
    [ORDER_LIST_HEADERS.webhookEventId]: record.webhookEventId,
  };
  return headerRow.map((header) => valuesByHeader[String(header)] ?? "");
}

function setCellByHeader(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  headerIndex: Record<string, number>,
  rowNumber: number,
  headerName: string,
  value: unknown,
): void {
  const col = headerIndex[headerName];
  if (col === undefined) throw new Error(`シートのヘッダー「${headerName}」が見つかりません。`);
  sheet.getRange(rowNumber, col + 1).setValue(value);
}

function withOrderListLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

type OrderListSnapshot = {
  sheet: GoogleAppsScript.Spreadsheet.Sheet;
  values: unknown[][];
  headerIndex: Record<string, number>;
  rows: OrderRow[];
};

function readOrderListSheet(): OrderListSnapshot {
  const sheet = getSheet(SHEET_NAMES.orderList);
  const values = sheet.getDataRange().getValues();
  const headerIndex = buildHeaderIndex(values[0] ?? []);
  validateOrderListHeaders(headerIndex);
  return { sheet, values, headerIndex, rows: buildOrderRows(values, headerIndex) };
}

type SubmitOrderRequestResult =
  | Exclude<OrderRequestEvaluation, { kind: "accepted" }>
  | {
      kind: "accepted";
      entry: CatalogEntry;
      quantity: number;
      priceCap: number | undefined;
      receiptId: string;
    };

function submitOrderRequest(input: {
  productQuery: string;
  quantityInput: number | undefined;
  requesterId: string;
  webhookEventId: string;
  now: Date;
}): SubmitOrderRequestResult {
  return withOrderListLock(() => {
    const catalog = readCatalog();
    const { sheet, values, rows } = readOrderListSheet();

    const evaluation = evaluateOrderRequest({
      productQuery: input.productQuery,
      quantityInput: input.quantityInput,
      catalog,
      existingOrders: rows,
      webhookEventId: input.webhookEventId,
    });
    if (evaluation.kind !== "accepted") return evaluation;

    const receiptId = generateReceiptId(new Set(rows.map((row) => row.receiptId)));
    sheet.appendRow(
      buildOrderRowValues(values[0], {
        receiptId,
        receivedAt: input.now,
        requesterId: input.requesterId,
        asin: evaluation.entry.asin,
        productName: evaluation.entry.productName,
        quantity: evaluation.quantity,
        priceCap: evaluation.priceCap,
        status: "未処理",
        orderNumber: "",
        billedAmount: "",
        processedAt: undefined,
        note: "",
        notifiedAt: undefined,
        webhookEventId: input.webhookEventId,
      }),
    );
    SpreadsheetApp.flush();
    return { ...evaluation, receiptId };
  });
}

function resolveOrderCancel(receiptId: string): OrderCancelEvaluation {
  return withOrderListLock(() => {
    const { sheet, headerIndex, rows } = readOrderListSheet();
    const order = rows.find((row) => row.receiptId === receiptId);

    const evaluation = evaluateOrderCancel(order);
    if (order && evaluation.kind === "cancelled") {
      setCellByHeader(sheet, headerIndex, order.rowNumber, ORDER_LIST_HEADERS.status, "キャンセル");
      SpreadsheetApp.flush();
    }
    return evaluation;
  });
}

function listUnprocessedOrders(): OrderRecord[] {
  return readOrderListSheet().rows.filter((row) => row.status === "未処理");
}

// 通知対象（カート追加済・注文済・要確認・失敗で通知日時が未記入）を選び、通知日時を記入してから返す。
// 選択と記入を同じロック内で行い、トリガーの重複実行で二重通知しないようにする。
function pullUnnotifiedResults(now: Date): OrderRecord[] {
  return withOrderListLock(() => {
    const { sheet, headerIndex, rows } = readOrderListSheet();
    const targets = selectUnnotifiedResults(rows);

    for (const target of targets) {
      setCellByHeader(sheet, headerIndex, target.rowNumber, ORDER_LIST_HEADERS.notifiedAt, now);
    }
    if (targets.length > 0) SpreadsheetApp.flush();
    return targets;
  });
}

export type { SubmitOrderRequestResult };
export {
  listUnprocessedOrders,
  OrderSheetConfigError,
  pullUnnotifiedResults,
  resolveOrderCancel,
  submitOrderRequest,
};
