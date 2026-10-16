type InquiryThread = GoogleAppsScript.Gmail.GmailThread;
type InquiryDraft = GoogleAppsScript.Gmail.GmailDraft;
type InquiryLabel = GoogleAppsScript.Gmail.GmailLabel;

export type InquiryDraftConfig = {
  organizationName: string;
  managerName: string;
  replySignature: string;
  lineFriendUrl: string;
};

export type ExecutionResult = {
  scanned: number;
  drafted: number;
  skipped: number;
  errors: number;
  durationMs: number;
};

export function createEmptyResult(): ExecutionResult {
  return {
    scanned: 0,
    drafted: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };
}

export function buildSearchQuery(
  inquirySubjectKeyword: string,
  processedLabelName: string,
): string {
  return `subject:"${inquirySubjectKeyword}" -label:"${processedLabelName}"`;
}

export function extractSenderName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]*)"?\s*<[^>]+>$/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

export function buildGreeting(senderName: string, config: InquiryDraftConfig): string {
  const salutation = senderName || "お客様";

  return (
    `${salutation}さま\n\n` +
    `初めまして！\n` +
    `${config.organizationName}管理人の${config.managerName}と申します。\n` +
    `${config.organizationName}に興味を持っていただき、大変ありがとうございます。\n` +
    `是非とも${config.organizationName}に内見にお越しいただきたく思います。`
  );
}

export function buildClosing(config: InquiryDraftConfig): string {
  const lineSection = config.lineFriendUrl
    ? `また、今後のやりとりをスムーズに行うためにも、公式ラインの友達追加をお勧めしております。\n` +
      `追加いただける場合は、以下のリンクから友達追加をしていただくようにお願いいたします。\n${config.lineFriendUrl}\n\n`
    : "";
  const signature = config.replySignature ? `\n\n${config.replySignature}` : "";

  return `${lineSection}ご確認よろしくお願いいたします。${signature}`;
}

export function buildDraftBody(
  senderName: string,
  viewingMessage: string,
  config: InquiryDraftConfig,
): string {
  return `${buildGreeting(senderName, config)}\n\n${viewingMessage}\n\n${buildClosing(config)}`;
}

export function threadHasExistingDraft(thread: InquiryThread, drafts: InquiryDraft[]): boolean {
  const threadId = thread.getId();
  return drafts.some((draft) => draft.getMessage().getThread().getId() === threadId);
}

export function findUnprocessedInquiryThreads(
  inquirySubjectKeyword: string,
  processedLabelName: string,
): InquiryThread[] {
  return GmailApp.search(buildSearchQuery(inquirySubjectKeyword, processedLabelName), 0, 1);
}

export function getOrCreateLabel(name: string): InquiryLabel {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

export function createDraftForThread(
  thread: InquiryThread,
  viewingMessage: string,
  config: InquiryDraftConfig,
): void {
  const messages = thread.getMessages();
  const latestMessage = messages[messages.length - 1];
  const senderName = extractSenderName(latestMessage.getFrom());

  thread.createDraftReply(buildDraftBody(senderName, viewingMessage, config));
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

export function logResult(result: ExecutionResult): void {
  console.log(
    `処理結果: 確認したスレッド ${result.scanned}件、下書き作成 ${result.drafted}件、` +
      `スキップ ${result.skipped}件、エラー ${result.errors}件、処理時間 ${result.durationMs}ms。`,
  );
}
