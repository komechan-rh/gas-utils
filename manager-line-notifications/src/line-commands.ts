import packageJson from "../package.json";
import { formatWeeklyMessage } from "./calendar/formatter";
import { getCurrentWeekMonday, getWeeklyEvents } from "./calendar/schedule";
import { replyTextMessage } from "./line-client";
import { formatMonthlyPayrollMessage } from "./payroll/formatter";
import { getMonthlyPayroll, markMonthlyPayrollAsPaid } from "./payroll/sheet";

type LineCommandContext = {
  replyToken: string;
  groupId?: string;
};

type LineCommandHandler = (context: LineCommandContext) => void;

function replyWeeklySchedule({ replyToken }: LineCommandContext): void {
  const monday = getCurrentWeekMonday();
  const events = getWeeklyEvents(monday);
  const message = formatWeeklyMessage(events, monday);

  replyTextMessage(replyToken, message);
}

function replyGroupId({ replyToken, groupId }: LineCommandContext): void {
  const text = groupId ? groupId : "このトークはグループではないため、グループIDを取得できません。";

  replyTextMessage(replyToken, text);
}

function replyMonthlyPayroll({ replyToken }: LineCommandContext): void {
  const result = getMonthlyPayroll();
  const message = formatMonthlyPayrollMessage(result);

  replyTextMessage(replyToken, message);
}

function replyMarkPayrollAsPaid({ replyToken }: LineCommandContext): void {
  const updatedWorkMonth = markMonthlyPayrollAsPaid();
  const message = updatedWorkMonth
    ? `給与の支払い状況（${updatedWorkMonth}稼働分）を「済」に更新しました。`
    : "今月の支払い予定が見つからず、更新できませんでした。";

  replyTextMessage(replyToken, message);
}

function replyVersion({ replyToken }: LineCommandContext): void {
  replyTextMessage(replyToken, `v${packageJson.version}`);
}

// LINEグループ内での発言キーワードとハンドラの対応表。
// 発言キーワードが増えても、この対応表に追加するだけでよい。
const LINE_COMMANDS: Record<string, LineCommandHandler> = {
  今週の予定: replyWeeklySchedule,
  今月の給与: replyMonthlyPayroll,
  給与支払い済: replyMarkPayrollAsPaid,
  ID: replyGroupId,
  バージョン: replyVersion,
};

function findLineCommand(text: string): LineCommandHandler | undefined {
  return LINE_COMMANDS[text];
}

export type { LineCommandContext, LineCommandHandler };
export { findLineCommand };
