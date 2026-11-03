import packageJson from "../package.json";
import { findOrderCommand } from "./amazon-order/commands";
import { formatWeeklyMessage } from "./calendar/formatter";
import { getCurrentWeekMonday, getWeeklyEvents } from "./calendar/schedule";
import { replyTextMessage } from "./line-client";
import { formatMonthlyPayrollMessage } from "./payroll/formatter";
import {
  getMonthlyPayroll,
  getPayrollSpreadsheetUrl,
  markMonthlyPayrollAsPaid,
} from "./payroll/sheet";

type LineCommandContext = {
  replyToken: string;
  groupId?: string;
  userId?: string;
  webhookEventId: string;
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
  const message = formatMonthlyPayrollMessage(result, getPayrollSpreadsheetUrl());

  replyTextMessage(replyToken, message);
}

function replyMarkPayrollAsPaid({ replyToken, webhookEventId }: LineCommandContext): void {
  const updated = markMonthlyPayrollAsPaid(webhookEventId);
  // 更新後に返信だけ失敗しても、再配信では更新も返信も繰り返さない。
  if (updated === undefined) return;
  const message = updated
    ? "給与の支払い状況を「済」に更新しました。"
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

// 注文系コマンドは可変引数（商品名・数量・受付ID）を取るため完全一致の対応表に乗らない。
// 完全一致に該当しないときだけ、パターン一致で注文系ハンドラを探す。
function findLineCommand(text: string): LineCommandHandler | undefined {
  return LINE_COMMANDS[text] ?? findOrderCommand(text);
}

export type { LineCommandContext, LineCommandHandler };
export { findLineCommand };
