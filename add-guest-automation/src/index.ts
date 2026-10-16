import { respondJson, syncScriptProperties } from "shared/script-properties-sync";
import {
  addGuestsToCalendarEvent,
  createCreatedAfterThreshold,
  createEmptyResult,
  formatError,
  formatSkipReason,
  hasAllConfiguredGuests,
  listRecentlyChangedEvents,
  logAdvancedEvent,
  logResult,
  shouldProcessCreatedEvent,
} from "./calendar-automation";

const CALENDAR_ID = "primary";
const EVENT_CREATED_LOOKBACK_MINUTES = 10;
const INCLUDE_ALL_DAY_EVENTS = false;
const SKIP_TITLE_KEYWORDS = ["[skip-auto-guest]", "招待不要"];
const ONLY_IF_CREATOR_IS_ME = true;

function getGuestEmails(): string[] {
  const raw = PropertiesService.getScriptProperties().getProperty("GUEST_EMAILS");
  if (!raw) {
    throw new Error(
      "GUEST_EMAILS がスクリプトプロパティに設定されていません。カンマ区切りのメールアドレスを設定してください。",
    );
  }
  return raw
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email !== "");
}

export function main(): void {
  const startedAt = new Date();
  const result = createEmptyResult();

  try {
    const GUEST_EMAILS = getGuestEmails();

    if (GUEST_EMAILS.length === 0) {
      throw new Error("GUEST_EMAILS must contain at least one email.");
    }
    if (GUEST_EMAILS.some((email) => email.trim() === "")) {
      throw new Error("GUEST_EMAILS must not contain empty values.");
    }
    if (EVENT_CREATED_LOOKBACK_MINUTES <= 0) {
      throw new Error("EVENT_CREATED_LOOKBACK_MINUTES must be greater than 0.");
    }

    const createdAfter = createCreatedAfterThreshold(EVENT_CREATED_LOOKBACK_MINUTES);
    console.log(
      `カレンダー自動招待を開始します。対象カレンダー: ${CALENDAR_ID}、作成日時の確認範囲: ${createdAfter} 以降、追加対象ゲスト: ${GUEST_EMAILS.join(", ")}`,
    );
    const changedEvents = listRecentlyChangedEvents(CALENDAR_ID, createdAfter);

    result.scanned = changedEvents.items.length;

    changedEvents.items.forEach((event) => {
      try {
        const decision = shouldProcessCreatedEvent(
          event,
          {
            includeAllDayEvents: INCLUDE_ALL_DAY_EVENTS,
            skipTitleKeywords: SKIP_TITLE_KEYWORDS,
            onlyIfCreatorIsMe: ONLY_IF_CREATOR_IS_ME,
          },
          createdAfter,
        );
        if (!decision.shouldProcess) {
          result.skipped += 1;
          result.skipReasons[decision.reason] = (result.skipReasons[decision.reason] || 0) + 1;
          logAdvancedEvent("SKIP", event, formatSkipReason(decision.reason));
          return;
        }

        if (hasAllConfiguredGuests(event, GUEST_EMAILS)) {
          result.alreadyComplete += 1;
          logAdvancedEvent("NOOP", event, "設定済みゲストは既に全員追加されています。");
          return;
        }

        const addResult = addGuestsToCalendarEvent(CALENDAR_ID, event, GUEST_EMAILS);
        result.updated += addResult.addedEmails.length > 0 ? 1 : 0;
        result.addedGuests += addResult.addedEmails.length;
        result.failedGuests += addResult.failedEmails.length;

        logAdvancedEvent(
          addResult.failedEmails.length > 0 ? "PARTIAL" : "UPDATED",
          event,
          `追加できたゲスト: ${formatEmailList(addResult.addedEmails)}。追加に失敗したゲスト: ${formatEmailList(addResult.failedEmails)}。招待メールは送信していません。`,
        );
      } catch (eventError) {
        result.errors += 1;
        logAdvancedEvent(
          "ERROR",
          event,
          `イベント処理中にエラーが発生しました。詳細: ${formatError(eventError)}`,
        );
      }
    });
  } catch (error) {
    result.errors += 1;
    console.error(`カレンダー自動招待を中断しました。詳細: ${formatError(error)}`);
  } finally {
    result.durationMs = Date.now() - startedAt.getTime();
    logResult(result);
  }
}

function formatEmailList(emails: string[]): string {
  return emails.length > 0 ? emails.join(", ") : "なし";
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const body = JSON.parse(e.postData.contents);
    return respondJson(syncScriptProperties(body));
  } catch (error) {
    return respondJson({ ok: false, error: formatError(error) });
  }
}
