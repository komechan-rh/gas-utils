import type { MonthlyPayrollResult, PersonPayment } from "./types";

// 空き部屋数・支払い状況は氏名行にも値を持つが、支払い対象者ではないため除外する。
const NON_PERSON_LABELS = ["空き部屋数", "支払い状況"];

const PAID_STATUS = "済";

// 未払いリマインドの対象月（支払い予定日ベース）。1ヶ月前 = 支払い予定日が前月であるもの。
// 例: 10月の実行では、9月支払い分（8月稼働分）が対象になる。
const UNPAID_REMINDER_MONTHS_AGO = 1;

function getMonthsAgoDate(monthsAgo: number, baseDate: Date = new Date()): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth() - monthsAgo, 1);
}

type ColumnMap = {
  workMonthCol: number;
  paymentDueDateCol: number;
  paymentStatusCol: number;
  totalColumns: { personName: string; col: number }[];
};

function findHeaderRows(values: unknown[][]): {
  nameRow: unknown[];
  labelRow: unknown[];
  dataStartIndex: number;
} {
  const labelRowIndex = values.findIndex((row) => row.includes("稼働月"));
  if (labelRowIndex < 1) {
    throw new Error("スプレッドシートのヘッダー行（稼働月）が見つかりません。");
  }

  return {
    nameRow: values[labelRowIndex - 1],
    labelRow: values[labelRowIndex],
    dataStartIndex: labelRowIndex + 1,
  };
}

function buildColumnMap(nameRow: unknown[], labelRow: unknown[]): ColumnMap {
  const workMonthCol = labelRow.indexOf("稼働月");
  const paymentDueDateCol = labelRow.indexOf("支払い予定日");
  const paymentStatusCol = nameRow.indexOf("支払い状況");

  const totalColumns: { personName: string; col: number }[] = [];
  nameRow.forEach((name, col) => {
    if (typeof name === "string" && name !== "" && !NON_PERSON_LABELS.includes(name)) {
      totalColumns.push({ personName: name, col });
    }
  });

  return { workMonthCol, paymentDueDateCol, paymentStatusCol, totalColumns };
}

function matchesTargetMonth(row: unknown[], columnMap: ColumnMap, targetDate: Date): boolean {
  const dueDate = row[columnMap.paymentDueDateCol];
  return (
    dueDate instanceof Date &&
    dueDate.getFullYear() === targetDate.getFullYear() &&
    dueDate.getMonth() === targetDate.getMonth()
  );
}

function findTargetRow(
  dataRows: unknown[][],
  columnMap: ColumnMap,
  targetDate: Date,
): unknown[] | undefined {
  return dataRows.find((row) => matchesTargetMonth(row, columnMap, targetDate));
}

function formatWorkMonth(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(value ?? "");
}

function extractPayments(row: unknown[], columnMap: ColumnMap): PersonPayment[] {
  return columnMap.totalColumns
    .map(({ personName, col }) => ({ personName, amount: Number(row[col]) || 0 }))
    .filter(({ amount }) => amount > 0);
}

function buildMonthlyPayrollResult(
  values: unknown[][],
  targetDate: Date,
): MonthlyPayrollResult | undefined {
  const { nameRow, labelRow, dataStartIndex } = findHeaderRows(values);
  const columnMap = buildColumnMap(nameRow, labelRow);
  const dataRows = values.slice(dataStartIndex);

  const targetRow = findTargetRow(dataRows, columnMap, targetDate);
  if (!targetRow) return undefined;

  return {
    workMonth: formatWorkMonth(targetRow[columnMap.workMonthCol]),
    paymentDueDate: targetRow[columnMap.paymentDueDateCol] as Date,
    paymentStatus: String(targetRow[columnMap.paymentStatusCol] ?? ""),
    payments: extractPayments(targetRow, columnMap),
  };
}

function getMonthlyPayroll(targetDate: Date = new Date()): MonthlyPayrollResult | undefined {
  const spreadsheetId =
    PropertiesService.getScriptProperties().getProperty("PAYROLL_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("PAYROLL_SPREADSHEET_ID がスクリプトプロパティに設定されていません。");
  }

  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
  const values = sheet.getDataRange().getValues();

  return buildMonthlyPayrollResult(values, targetDate);
}

type PaymentStatusCell = {
  row: number;
  col: number;
  workMonth: string;
};

function toPaymentStatusCell(
  dataStartIndex: number,
  rowIndex: number,
  row: unknown[],
  columnMap: ColumnMap,
): PaymentStatusCell {
  return {
    row: dataStartIndex + rowIndex + 1,
    col: columnMap.paymentStatusCol + 1,
    workMonth: formatWorkMonth(row[columnMap.workMonthCol]),
  };
}

// シート上の「支払い状況」セルの位置（1始まりの行・列番号）を求める。
// buildMonthlyPayrollResultは値の抽出のみだが、書き込みにはシート全体における絶対位置が要る。
function findPaymentStatusCell(
  values: unknown[][],
  targetDate: Date,
): PaymentStatusCell | undefined {
  const { nameRow, labelRow, dataStartIndex } = findHeaderRows(values);
  const columnMap = buildColumnMap(nameRow, labelRow);
  const dataRows = values.slice(dataStartIndex);

  const targetRowIndex = dataRows.findIndex((row) =>
    matchesTargetMonth(row, columnMap, targetDate),
  );
  if (targetRowIndex < 0) return undefined;

  return toPaymentStatusCell(dataStartIndex, targetRowIndex, dataRows[targetRowIndex], columnMap);
}

// 支払い予定日が当月より前で、支払い状況が「済」以外のまま残っている行のうち最も古いもの。
// 支払い状況が空欄の行は、管理対象外（記録開始前など）とみなして除外する。
function findOldestOverdueUnpaidCell(
  values: unknown[][],
  targetDate: Date,
): PaymentStatusCell | undefined {
  const { nameRow, labelRow, dataStartIndex } = findHeaderRows(values);
  const columnMap = buildColumnMap(nameRow, labelRow);
  const dataRows = values.slice(dataStartIndex);
  const currentMonthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);

  let oldest: { rowIndex: number; dueDate: Date } | undefined;
  dataRows.forEach((row, rowIndex) => {
    const dueDate = row[columnMap.paymentDueDateCol];
    const status = row[columnMap.paymentStatusCol];
    if (!(dueDate instanceof Date) || dueDate >= currentMonthStart) return;
    if (status === "" || status == null || status === PAID_STATUS) return;
    if (!oldest || dueDate < oldest.dueDate) oldest = { rowIndex, dueDate };
  });
  if (!oldest) return undefined;

  return toPaymentStatusCell(dataStartIndex, oldest.rowIndex, dataRows[oldest.rowIndex], columnMap);
}

// 「給与支払い済」発言時点では、支払いが遅れてずれ込んだ過去月分か当月分かが分からないため、
// 未払いのまま残っている過去月分を古い順に優先して更新対象にし、なければ当月分を更新する。
function resolveMarkTargetCell(
  values: unknown[][],
  targetDate: Date,
): PaymentStatusCell | undefined {
  return (
    findOldestOverdueUnpaidCell(values, targetDate) ?? findPaymentStatusCell(values, targetDate)
  );
}

// 更新した行の稼働月（例: "2026/08"）を返す。対象行が見つからなければ undefined。
function markMonthlyPayrollAsPaid(targetDate: Date = new Date()): string | undefined {
  const spreadsheetId =
    PropertiesService.getScriptProperties().getProperty("PAYROLL_SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("PAYROLL_SPREADSHEET_ID がスクリプトプロパティに設定されていません。");
  }

  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
  const values = sheet.getDataRange().getValues();

  const cell = resolveMarkTargetCell(values, targetDate);
  if (!cell) return undefined;

  sheet.getRange(cell.row, cell.col).setValue(PAID_STATUS);
  return cell.workMonth;
}

export {
  buildMonthlyPayrollResult,
  findPaymentStatusCell,
  getMonthlyPayroll,
  getMonthsAgoDate,
  markMonthlyPayrollAsPaid,
  PAID_STATUS,
  resolveMarkTargetCell,
  UNPAID_REMINDER_MONTHS_AGO,
};
