import type { MonthlyPayrollResult } from "./types";

const PAYROLL_NOT_FOUND_MESSAGE = "今月の支払い予定は見つかりませんでした。";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDateLabel(date: Date): string {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

function formatPayrollBody(result: MonthlyPayrollResult): string[] {
  if (result.payments.length === 0) {
    return ["対象者なし"];
  }

  const lines = result.payments.map(
    ({ personName, amount }) => `・${personName}: ${amount.toLocaleString()}円`,
  );
  const total = result.payments.reduce((sum, payment) => sum + payment.amount, 0);
  lines.push("");
  lines.push(`合計: ${total.toLocaleString()}円`);

  return lines;
}

function formatSpreadsheetLinkLine(spreadsheetUrl: string): string {
  return `📄 給与支払い管理シート: ${spreadsheetUrl}`;
}

function formatMonthlyPayrollMessage(
  result: MonthlyPayrollResult | undefined,
  spreadsheetUrl: string,
): string {
  if (!result) return PAYROLL_NOT_FOUND_MESSAGE;

  const lines: string[] = [
    `💰 給与支払い通知（${result.workMonth}分 / 支払い予定日 ${formatDateLabel(result.paymentDueDate)}）`,
    `支払い状況: ${result.paymentStatus}`,
    "",
    ...formatPayrollBody(result),
    "",
    formatSpreadsheetLinkLine(spreadsheetUrl),
  ];

  return lines.join("\n");
}

function formatUnpaidPayrollReminderMessage(
  result: MonthlyPayrollResult,
  spreadsheetUrl: string,
): string {
  const lines: string[] = [
    `⚠️ 給与未払いのお知らせ（${result.workMonth}分 / 支払い予定日 ${formatDateLabel(result.paymentDueDate)}）`,
    `支払い状況: ${result.paymentStatus}`,
    "",
    ...formatPayrollBody(result),
    "",
    "支払いが完了したら、このグループで「給与支払い済」と発言すると支払い状況を更新できます。",
    "",
    formatSpreadsheetLinkLine(spreadsheetUrl),
  ];

  return lines.join("\n");
}

export { formatMonthlyPayrollMessage, formatUnpaidPayrollReminderMessage };
