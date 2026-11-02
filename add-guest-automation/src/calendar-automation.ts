type AdvancedCalendarEvent = GoogleAppsScript.Calendar.Schema.Event;
type AdvancedCalendarEvents = GoogleAppsScript.Calendar.Schema.Events;
type AdvancedCalendarEventsCollection = GoogleAppsScript.Calendar.Collection.EventsCollection;

type ProcessCreatedEventOptions = {
  includeAllDayEvents: boolean;
  skipTitleKeywords: string[];
  onlyIfCreatorIsMe: boolean;
};

type ExecutionResult = {
  scanned: number;
  updated: number;
  addedGuests: number;
  alreadyComplete: number;
  skipped: number;
  failedGuests: number;
  errors: number;
  durationMs: number;
  skipReasons: Record<string, number>;
};

export function createEmptyResult(): ExecutionResult {
  return {
    scanned: 0,
    updated: 0,
    addedGuests: 0,
    alreadyComplete: 0,
    skipped: 0,
    failedGuests: 0,
    errors: 0,
    durationMs: 0,
    skipReasons: {},
  };
}

export function createCreatedAfterThreshold(lookbackMinutes: number): string {
  return new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
}

export function listRecentlyChangedEvents(
  calendarId: string,
  updatedMin: string,
): { items: AdvancedCalendarEvent[] } {
  const eventsService = getCalendarEventsService();
  const items: AdvancedCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const options: Record<string, string | boolean | undefined> = {
      pageToken,
      showDeleted: true,
      singleEvents: true,
      updatedMin,
    };
    const response: AdvancedCalendarEvents = eventsService.list(calendarId, options);

    items.push(...(response.items || []));
    pageToken = response.nextPageToken;
  } while (pageToken);

  return { items };
}

export function shouldProcessCreatedEvent(
  event: AdvancedCalendarEvent,
  options: ProcessCreatedEventOptions,
  createdWatermark: string,
): { shouldProcess: boolean; reason: string } {
  if (!event.id) {
    return { shouldProcess: false, reason: "missing_event_id" };
  }

  if (event.status === "cancelled") {
    return { shouldProcess: false, reason: "cancelled_event" };
  }

  if (!event.created || event.created <= createdWatermark) {
    return { shouldProcess: false, reason: "not_newly_created" };
  }

  if (!options.includeAllDayEvents && event.start?.date && !event.start.dateTime) {
    return { shouldProcess: false, reason: "all_day_event" };
  }

  const title = event.summary || "";
  const matchedKeyword = options.skipTitleKeywords.some((keyword) => {
    return keyword.length > 0 && title.indexOf(keyword) !== -1;
  });
  if (matchedKeyword) {
    return { shouldProcess: false, reason: "skip_title_keyword" };
  }

  if (options.onlyIfCreatorIsMe && !isCreatedByCurrentUser(event)) {
    return { shouldProcess: false, reason: "creator_mismatch" };
  }

  return { shouldProcess: true, reason: "target" };
}

export function isCreatedByCurrentUser(event: AdvancedCalendarEvent): boolean {
  if (event.creator?.self) {
    return true;
  }

  const currentUserEmail = getCurrentUserEmail();
  if (!currentUserEmail) {
    console.warn(
      "実行ユーザーのメールアドレスを取得できなかったため、作成者判定を失敗扱いにします。",
    );
    return false;
  }

  return normalizeEmail(event.creator?.email) === currentUserEmail;
}

export function hasAllConfiguredGuests(
  event: AdvancedCalendarEvent,
  guestEmails: string[],
): boolean {
  const existingEmails = getExistingAttendeeEmailSet(event);

  return normalizeEmails(guestEmails).every((email) => existingEmails[email]);
}

export function addGuestsToCalendarEvent(
  calendarId: string,
  event: AdvancedCalendarEvent,
  guestEmails: string[],
): { addedEmails: string[]; failedEmails: string[] } {
  const eventId = event.id;
  if (!eventId) {
    return { addedEmails: [], failedEmails: ["イベントIDがありません"] };
  }

  const existingEmails = getExistingAttendeeEmailSet(event);
  const addedEmails = normalizeEmails(guestEmails).filter((email) => !existingEmails[email]);

  if (addedEmails.length === 0) {
    return { addedEmails: [], failedEmails: [] };
  }

  const attendees = [...(event.attendees || []), ...addedEmails.map((email) => ({ email }))];

  try {
    getCalendarEventsService().patch({ attendees }, calendarId, eventId, {
      sendUpdates: "none",
    });

    return { addedEmails, failedEmails: [] };
  } catch (error) {
    return {
      addedEmails: [],
      failedEmails: addedEmails.map((email) => `${email} (${formatError(error)})`),
    };
  }
}

export function getExistingAttendeeEmailSet(event: AdvancedCalendarEvent): Record<string, boolean> {
  const emailSet: Record<string, boolean> = {};

  (event.attendees || []).forEach((attendee) => {
    const email = normalizeEmail(attendee.email);
    if (email) {
      emailSet[email] = true;
    }
  });

  return emailSet;
}

export function getCurrentUserEmail(): string {
  const effectiveUserEmail = normalizeEmail(Session.getEffectiveUser().getEmail());
  if (effectiveUserEmail) {
    return effectiveUserEmail;
  }

  return normalizeEmail(Session.getActiveUser().getEmail());
}

export function normalizeEmails(emails: string[]): string[] {
  const seen: Record<string, boolean> = {};
  const normalized: string[] = [];

  emails.forEach((email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || seen[normalizedEmail]) {
      return;
    }

    seen[normalizedEmail] = true;
    normalized.push(normalizedEmail);
  });

  return normalized;
}

export function normalizeEmail(email: string | null | undefined): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function logAdvancedEvent(
  level: string,
  event: AdvancedCalendarEvent,
  message: string,
): void {
  console.log(`${toJapaneseLogLevel(level)}: ${message} 対象イベント: ${formatEventForLog(event)}`);
}

export function logResult(result: ExecutionResult): void {
  console.log(
    `処理結果: 確認したイベント ${result.scanned}件、ゲスト追加したイベント ${result.updated}件、追加したゲスト ${result.addedGuests}件、既に追加済み ${result.alreadyComplete}件、対象外 ${result.skipped}件、追加失敗ゲスト ${result.failedGuests}件、エラー ${result.errors}件、処理時間 ${result.durationMs}ms。対象外理由: ${formatSkipReasons(result.skipReasons)}`,
  );
}

export function formatError(error: unknown): string {
  if (!error) {
    return "不明なエラー";
  }

  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

export function formatEventForLog(event: AdvancedCalendarEvent): string {
  return `タイトル「${event.summary || "無題"}」、ID「${event.id || "不明"}」、作成日時「${event.created || "不明"}」、更新日時「${event.updated || "不明"}」`;
}

export function formatSkipReason(reason: string): string {
  const reasonMap: Record<string, string> = {
    missing_event_id: "イベントIDが取得できないため対象外です。",
    cancelled_event: "キャンセル済みイベントのため対象外です。",
    not_newly_created: "直近に作成されたイベントではないため対象外です。",
    all_day_event: "終日イベントは設定で除外されているため対象外です。",
    skip_title_keyword: "タイトルに除外キーワードが含まれているため対象外です。",
    creator_mismatch: "作成者が実行ユーザーではないため対象外です。",
  };

  return reasonMap[reason] || `対象外です。理由コード: ${reason}`;
}

function formatSkipReasons(skipReasons: Record<string, number>): string {
  const entries = Object.keys(skipReasons);
  if (entries.length === 0) {
    return "なし";
  }

  return entries
    .map((reason) => `${formatSkipReason(reason)} ${skipReasons[reason]}件`)
    .join(" / ");
}

function toJapaneseLogLevel(level: string): string {
  const levelMap: Record<string, string> = {
    SKIP: "対象外",
    NOOP: "追加不要",
    UPDATED: "追加完了",
    PARTIAL: "一部失敗",
    ERROR: "エラー",
  };

  return levelMap[level] || level;
}

export function getCalendarEventsService(): AdvancedCalendarEventsCollection {
  if (!Calendar?.Events) {
    throw new Error("Advanced Calendar Service が有効になっていません。");
  }

  return Calendar.Events;
}
