import { respondJson, syncScriptProperties } from "shared/script-properties-sync";
import { formatOrderResultNotification } from "./amazon-order/formatter";
import {
  callRoutineFireApi,
  DAILY_FIRE_LIMIT,
  decideRoutineAction,
  getRoutineFireConfig,
  isWithinFireWindow,
  loadRoutineFireState,
  saveRoutineFireState,
  toDateKey,
  withRoutineFireLock,
} from "./amazon-order/routine-trigger";
import { listUnprocessedOrders, pullUnnotifiedResults } from "./amazon-order/sheet";
import { formatWeeklyMessage } from "./calendar/formatter";
import { getCurrentWeekMonday, getWeeklyEvents } from "./calendar/schedule";
import { pushTextMessage } from "./line-client";
import { handleLineWebhook } from "./line-webhook";
import {
  formatMonthlyPayrollMessage,
  formatUnpaidPayrollReminderMessage,
} from "./payroll/formatter";
import {
  formatYearMonth,
  getMonthlyPayroll,
  getMonthsAgoDate,
  getPayrollSpreadsheetUrl,
  PAID_STATUS,
  UNPAID_REMINDER_MONTHS_AGO,
} from "./payroll/sheet";

function getLineGroupId(): string {
  const groupId = PropertiesService.getScriptProperties().getProperty("LINE_GROUP_ID");
  if (!groupId) throw new Error("LINE_GROUP_ID がスクリプトプロパティに設定されていません。");
  return groupId;
}

function weeklyScheduleToLine(): void {
  const groupId = getLineGroupId();
  const monday = getCurrentWeekMonday();
  const events = getWeeklyEvents(monday);
  const message = formatWeeklyMessage(events, monday);

  pushTextMessage(groupId, message);
}

function monthlyPayrollToLine(): void {
  const groupId = getLineGroupId();
  const result = getMonthlyPayroll();
  const message = formatMonthlyPayrollMessage(result, getPayrollSpreadsheetUrl());

  pushTextMessage(groupId, message);
}

function unpaidPayrollReminderToLine(): void {
  const groupId = getLineGroupId();
  const targetDate = getMonthsAgoDate(UNPAID_REMINDER_MONTHS_AGO);
  const targetMonthLabel = formatYearMonth(targetDate);
  const result = getMonthlyPayroll(targetDate);
  if (!result || result.paymentStatus === PAID_STATUS) {
    console.log(
      `給与未払いリマインド: 対象月(${targetMonthLabel})は未払いではないため、通知をスキップしました。`,
    );
    return;
  }

  const message = formatUnpaidPayrollReminderMessage(result, getPayrollSpreadsheetUrl());
  pushTextMessage(groupId, message);
}

function notifyOrderResultsToLine(): void {
  const results = pullUnnotifiedResults(new Date());
  if (results.length === 0) return;

  const groupId = getLineGroupId();
  pushTextMessage(groupId, formatOrderResultNotification(results));
}

// 備品購入リストに未処理がある時間帯（日本時間8:00〜19:59）だけ、カート追加の定期実行
// （Claude Code routine）をAPIで起動する。起動から6時間たっても未処理のままの受付IDは1回だけ
// 再起動し、再起動後さらに6時間たっても未処理ならLINEへ通知して以後起動しない。
function fireCartRoutineIfPending(): void {
  const config = getRoutineFireConfig();
  if (!config) {
    console.log(
      "ROUTINE_FIRE_URL/ROUTINE_FIRE_TOKENが未設定のため、routine起動をスキップしました。",
    );
    return;
  }

  const now = new Date();
  if (!isWithinFireWindow(now)) {
    console.log("日本時間8:00〜19:59の対象時間外のため、routine起動をスキップしました。");
    return;
  }

  withRoutineFireLock(() => {
    const pendingIds = listUnprocessedOrders().map((order) => order.receiptId);
    const state = loadRoutineFireState();
    const { cleanedReceipts, idsToNotify, idsToFire } = decideRoutineAction(
      pendingIds,
      state.receipts,
      now,
    );

    for (const receiptId of idsToNotify) {
      cleanedReceipts[receiptId] = { ...cleanedReceipts[receiptId], notified: true };
      pushTextMessage(
        getLineGroupId(),
        `受付ID ${receiptId} がカートに追加されていません。定期実行の結果を確認してください。`,
      );
    }
    // 未処理でなくなった受付IDの記録の削除・通知済みフラグは、起動の成否に関わらず保存する。
    saveRoutineFireState({ ...state, receipts: cleanedReceipts });

    if (idsToFire.length === 0) {
      console.log("新規・再起動対象の受付IDが無いため、routineを起動しません。");
      return;
    }

    const todayKey = toDateKey(now);
    const dailyFiredCount = state.dailyFiredDate === todayKey ? state.dailyFiredCount : 0;
    if (dailyFiredCount >= DAILY_FIRE_LIMIT) {
      console.log(
        `本日の起動回数が上限（${DAILY_FIRE_LIMIT}回）に達しているため、routineを起動しません。`,
      );
      return;
    }

    const text = `未処理 ${idsToFire.length} 件（受付ID: ${idsToFire.join("、")}）`;
    try {
      const result = callRoutineFireApi(config, text);
      const firedReceipts = { ...cleanedReceipts };
      for (const receiptId of idsToFire) {
        firedReceipts[receiptId] = {
          firedAt: now.toISOString(),
          restarted: receiptId in cleanedReceipts,
          notified: false,
        };
      }
      saveRoutineFireState({
        receipts: firedReceipts,
        dailyFiredDate: todayKey,
        dailyFiredCount: dailyFiredCount + 1,
      });
      console.log(`Claude Code routineを起動しました。セッション: ${result.sessionUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushTextMessage(
        getLineGroupId(),
        `カート追加の定期実行を起動できませんでした（${message}）。`,
      );
      throw error;
    }
  });
}

function setupTrigger(): void {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    const handlerFunction = trigger.getHandlerFunction();
    if (
      handlerFunction === "weeklyScheduleToLine" ||
      handlerFunction === "monthlyPayrollToLine" ||
      handlerFunction === "unpaidPayrollReminderToLine" ||
      handlerFunction === "notifyOrderResultsToLine" ||
      handlerFunction === "fireCartRoutineIfPending"
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger("weeklyScheduleToLine")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  ScriptApp.newTrigger("monthlyPayrollToLine").timeBased().onMonthDay(25).atHour(8).create();

  ScriptApp.newTrigger("unpaidPayrollReminderToLine").timeBased().everyDays(1).atHour(10).create();

  ScriptApp.newTrigger("notifyOrderResultsToLine").timeBased().everyHours(1).create();

  ScriptApp.newTrigger("fireCartRoutineIfPending").timeBased().everyHours(1).create();

  console.log(
    "トリガーを登録しました。毎週月曜 8:00 に weeklyScheduleToLine、毎月25日 8:00 に monthlyPayrollToLine、毎朝10:00 に unpaidPayrollReminderToLine、1時間ごとに notifyOrderResultsToLine・fireCartRoutineIfPending が実行されます。",
  );
}

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  let body: unknown;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return respondJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // GASでは署名ヘッダーを取得できないため、中継が包んだ本文と署名を検証する。
  // events直送ではコマンドを実行しない。
  if (body && typeof body === "object" && "lineWebhook" in body) {
    return handleLineWebhook(body.lineWebhook);
  }

  return respondJson(
    syncScriptProperties(body as { secret?: string; properties?: Record<string, string> }),
  );
}

export {
  doPost,
  fireCartRoutineIfPending,
  monthlyPayrollToLine,
  notifyOrderResultsToLine,
  setupTrigger,
  unpaidPayrollReminderToLine,
  weeklyScheduleToLine,
};
