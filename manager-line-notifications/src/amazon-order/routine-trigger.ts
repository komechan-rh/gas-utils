// 備品購入リストの「未処理」がある時間帯だけ、Claude Code routineをAPIで起動する（詳細はREADME参照）。

type RoutineFireConfig = { url: string; token: string };

// firedAtは直近の起動時刻（初回起動、または再起動時に更新）。
// restartedは再起動を使い切ったか、notifiedは「カートに追加されていません」通知済みかを表す。
type ReceiptFireRecord = {
  firedAt: string;
  restarted: boolean;
  notified: boolean;
};

type RoutineFireState = {
  receipts: Record<string, ReceiptFireRecord>;
  dailyFiredDate: string;
  dailyFiredCount: number;
};

type RoutineAction = {
  cleanedReceipts: Record<string, ReceiptFireRecord>;
  idsToNotify: string[];
  idsToFire: string[];
};

const ROUTINE_FIRE_STATE_KEY = "ROUTINE_FIRE_STATE";
const ANTHROPIC_VERSION = "2026-10-21";
// 日本時間8:00〜19:59のみ起動する（夜の依頼は翌朝8時台にまとめて処理される）。
const FIRE_WINDOW_START_HOUR = 8;
const FIRE_WINDOW_END_HOUR = 20;
const RESTART_AFTER_MS = 6 * 60 * 60 * 1000;
const DAILY_FIRE_LIMIT = 4;
const EMPTY_STATE: RoutineFireState = { receipts: {}, dailyFiredDate: "", dailyFiredCount: 0 };

// Amazon注文機能を使わない環境もあるため、未設定はエラーにせずundefinedを返す。
function getRoutineFireConfig(): RoutineFireConfig | undefined {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("ROUTINE_FIRE_URL");
  const token = props.getProperty("ROUTINE_FIRE_TOKEN");
  if (!url || !token) return undefined;
  return { url, token };
}

// GASのタイムゾーンはAsia/Tokyo（appsscript.json）のため、Dateのローカル値がそのまま日本時間になる。
function isWithinFireWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= FIRE_WINDOW_START_HOUR && hour < FIRE_WINDOW_END_HOUR;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function loadRoutineFireState(): RoutineFireState {
  const saved = PropertiesService.getScriptProperties().getProperty(ROUTINE_FIRE_STATE_KEY);
  return saved ? (JSON.parse(saved) as RoutineFireState) : EMPTY_STATE;
}

function saveRoutineFireState(state: RoutineFireState): void {
  PropertiesService.getScriptProperties().setProperty(
    ROUTINE_FIRE_STATE_KEY,
    JSON.stringify(state),
  );
}

// 未処理の受付IDごとに、新規起動・再起動・通知の対象を判定する（シートI/Oを含まない純粋関数）。
// 未処理でなくなった受付ID（ステータスが変わった・行が消えた）の記録はここで取り除く。
function decideRoutineAction(
  pendingIds: string[],
  receipts: Record<string, ReceiptFireRecord>,
  now: Date,
): RoutineAction {
  const pendingSet = new Set(pendingIds);
  const cleanedReceipts: Record<string, ReceiptFireRecord> = {};
  const idsToNotify: string[] = [];
  const idsToFire: string[] = [];

  for (const [receiptId, record] of Object.entries(receipts)) {
    if (!pendingSet.has(receiptId)) continue;
    cleanedReceipts[receiptId] = record;
    if (record.notified) continue;

    const elapsed = now.getTime() - new Date(record.firedAt).getTime();
    if (elapsed < RESTART_AFTER_MS) continue;
    // 再起動を使い切っている（restarted済み）のに未処理が続いている場合だけ通知する。
    if (record.restarted) idsToNotify.push(receiptId);
    else idsToFire.push(receiptId);
  }

  for (const receiptId of pendingIds) {
    if (!(receiptId in receipts)) idsToFire.push(receiptId);
  }

  return { cleanedReceipts, idsToNotify, idsToFire };
}

function withRoutineFireLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 失敗時はステータスコードのみをエラーに含める。トークンや応答本文はログ・通知に残さない。
function callRoutineFireApi(config: RoutineFireConfig, text: string): { sessionUrl: string } {
  const response = UrlFetchApp.fetch(config.url, {
    method: "post",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error(`ステータスコード ${statusCode}`);
  }

  const body = JSON.parse(response.getContentText()) as { claude_code_session_url: string };
  return { sessionUrl: body.claude_code_session_url };
}

export type { ReceiptFireRecord, RoutineFireConfig, RoutineFireState };
export {
  callRoutineFireApi,
  DAILY_FIRE_LIMIT,
  decideRoutineAction,
  getRoutineFireConfig,
  isWithinFireWindow,
  loadRoutineFireState,
  saveRoutineFireState,
  toDateKey,
  withRoutineFireLock,
};
