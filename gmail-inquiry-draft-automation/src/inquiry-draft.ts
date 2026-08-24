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

export function buildSearchQuery(inquirySubjectKeyword: string, processedLabelName: string): string {
  return `subject:"${inquirySubjectKeyword}" -label:"${processedLabelName}"`;
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

export function buildDraftBody(senderName: string, viewingMessage: string, config: InquiryDraftConfig): string {
  return `${buildGreeting(senderName, config)}\n\n${viewingMessage}\n\n${buildClosing(config)}`;
}

export function buildDraftSubject(config: Pick<InquiryDraftConfig, "organizationName">): string {
  return `【${config.organizationName}】内見に関して`;
}

const EMAIL_PATTERN = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const LABELED_EMAIL_REGEX = new RegExp(`(?:メール(?:アドレス)?|e-?mail)\\s*[:：]\\s*(${EMAIL_PATTERN})`, "i");
const EMAIL_REGEX = new RegExp(EMAIL_PATTERN);

export function extractInquirerEmail(inquiryBody: string): string {
  const labeledMatch = inquiryBody.match(LABELED_EMAIL_REGEX);
  if (labeledMatch) {
    return labeledMatch[1];
  }

  const fallbackMatch = inquiryBody.match(EMAIL_REGEX);
  if (!fallbackMatch) {
    throw new Error("問い合わせメール本文から問い合わせ者のメールアドレスを取得できませんでした。");
  }

  return fallbackMatch[0];
}

const LABELED_NAME_REGEX = /(?:お名前|氏名|名前|name)\s*[:：]\s*(.+)/i;

export function extractInquirerName(inquiryBody: string): string {
  const match = inquiryBody.match(LABELED_NAME_REGEX);
  if (!match) {
    return "";
  }

  return match[1].trim();
}

export function buildDraftRecipient(inquirerEmail: string, inquirerName: string): string {
  return inquirerName ? `"${inquirerName}" <${inquirerEmail}>` : inquirerEmail;
}

export function threadHasExistingDraft(recipient: string, drafts: InquiryDraft[]): boolean {
  return drafts.some((draft) => draft.getMessage().getTo() === recipient);
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
  recipient: string,
  inquirerName: string,
  viewingMessage: string,
  config: InquiryDraftConfig,
): void {
  GmailApp.createDraft(recipient, buildDraftSubject(config), buildDraftBody(inquirerName, viewingMessage, config));
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
