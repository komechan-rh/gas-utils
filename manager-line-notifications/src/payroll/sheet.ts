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
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    "PAYROLL_SPREADSHEET_ID",
  );
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
};

// シート上の「支払い状況」セルの位置（1始まりの行・列番号）を求める。
// buildMonthlyPayrollResultは値の抽出のみだが、書き込みにはシート全体における絶対位置が要る。
function findPaymentStatusCell(
  values: unknown[][],
  targetDate: Date,
): PaymentStatusCell | undefined {
  const { nameRow, labelRow, dataStartIndex } = findHeaderRows(values);
  const columnMap = buildColumnMap(nameRow, labelRow);
  const dataRows = values.slice(dataStartIndex);

  const targetRowIndex = dataRows.findIndex((row) => matchesTargetMonth(row, columnMap, targetDate));
  if (targetRowIndex < 0) return undefined;

  return {
    row: dataStartIndex + targetRowIndex + 1,
    col: columnMap.paymentStatusCol + 1,
  };
}

function isCellMarkedPaid(values: unknown[][], cell: PaymentStatusCell): boolean {
  return values[cell.row - 1][cell.col - 1] === PAID_STATUS;
}

// 「給与支払い済」発言時点では対象月が未払いリマインドの対象月（支払いが遅れて
// ずれ込んだ場合）か当月分かが分からないため、未払いのまま残っているリマインド対象月を
// 優先して更新対象にする。
function resolveMarkTargetCell(
  values: unknown[][],
  targetDate: Date,
): PaymentStatusCell | undefined {
  const reminderTargetCell = findPaymentStatusCell(
    values,
    getMonthsAgoDate(UNPAID_REMINDER_MONTHS_AGO, targetDate),
  );
  if (reminderTargetCell && !isCellMarkedPaid(values, reminderTargetCell)) {
    return reminderTargetCell;
  }

  return findPaymentStatusCell(values, targetDate);
}

function markMonthlyPayrollAsPaid(targetDate: Date = new Date()): boolean {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    "PAYROLL_SPREADSHEET_ID",
  );
  if (!spreadsheetId) {
    throw new Error("PAYROLL_SPREADSHEET_ID がスクリプトプロパティに設定されていません。");
  }

  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
  const values = sheet.getDataRange().getValues();

  const cell = resolveMarkTargetCell(values, targetDate);
  if (!cell) return false;

  sheet.getRange(cell.row, cell.col).setValue(PAID_STATUS);
  return true;
}

export {
  getMonthlyPayroll,
  buildMonthlyPayrollResult,
  findPaymentStatusCell,
  markMonthlyPayrollAsPaid,
  resolveMarkTargetCell,
  getMonthsAgoDate,
  UNPAID_REMINDER_MONTHS_AGO,
  PAID_STATUS,
};
