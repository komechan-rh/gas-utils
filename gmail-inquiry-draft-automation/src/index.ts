import { respondJson, syncScriptProperties } from "shared/script-properties-sync";
import { type GenAiConfig, generateInquiryReplyMessage } from "./genai-client";
import {
  buildDraftRecipient,
  createDraftForThread,
  createEmptyResult,
  extractInquirerEmail,
  extractInquirerName,
  findUnprocessedInquiryThreads,
  formatError,
  getOrCreateLabel,
  type InquiryDraftConfig,
  logResult,
  threadHasExistingDraft,
} from "./inquiry-draft";

const INQUIRY_SUBJECT_KEYWORD_DEFAULT = "問い合わせ";
const PROCESSED_LABEL_NAME_DEFAULT = "下書き作成済み";
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const TRIGGER_INTERVAL_MINUTES = 15;

function getTrimmedProperty(props: GoogleAppsScript.Properties.Properties, key: string): string {
  return (props.getProperty(key) || "").trim();
}

function getConfig(): InquiryDraftConfig & {
  inquirySubjectKeyword: string;
  processedLabelName: string;
  genai: GenAiConfig;
} {
  const props = PropertiesService.getScriptProperties();
  const organizationName = getTrimmedProperty(props, "ORGANIZATION_NAME");
  const managerName = getTrimmedProperty(props, "MANAGER_NAME");
  const geminiApiKey = getTrimmedProperty(props, "GEMINI_API_KEY");

  if (!organizationName) {
    throw new Error("ORGANIZATION_NAME がスクリプトプロパティに設定されていません。");
  }
  if (!managerName) {
    throw new Error("MANAGER_NAME がスクリプトプロパティに設定されていません。");
  }
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY がスクリプトプロパティに設定されていません。");
  }

  return {
    organizationName,
    managerName,
    replySignature: getTrimmedProperty(props, "REPLY_SIGNATURE"),
    lineFriendUrl: getTrimmedProperty(props, "LINE_FRIEND_URL"),
    inquirySubjectKeyword:
      getTrimmedProperty(props, "INQUIRY_SUBJECT_KEYWORD") || INQUIRY_SUBJECT_KEYWORD_DEFAULT,
    processedLabelName:
      getTrimmedProperty(props, "PROCESSED_LABEL_NAME") || PROCESSED_LABEL_NAME_DEFAULT,
    genai: {
      apiKey: geminiApiKey,
      model: getTrimmedProperty(props, "GEMINI_MODEL") || GEMINI_MODEL_DEFAULT,
    },
  };
}

function main(): void {
  const startedAt = new Date();
  const result = createEmptyResult();

  try {
    const config = getConfig();
    const processedLabel = getOrCreateLabel(config.processedLabelName);
    const threads = findUnprocessedInquiryThreads(config.inquirySubjectKeyword, config.processedLabelName);
    const drafts = GmailApp.getDrafts();

    result.scanned = threads.length;

    threads.forEach((thread) => {
      try {
        const messages = thread.getMessages();
        const inquiryBody = messages[messages.length - 1].getPlainBody();
        const inquirerEmail = extractInquirerEmail(inquiryBody);
        const inquirerName = extractInquirerName(inquiryBody);
        const recipient = buildDraftRecipient(inquirerEmail, inquirerName);

        if (threadHasExistingDraft(recipient, drafts)) {
          result.skipped += 1;
          processedLabel.addToThread(thread);
          console.log(`既に下書きが存在するためスキップしました。件名「${thread.getFirstMessageSubject()}」`);
          return;
        }

        const viewingMessage = generateInquiryReplyMessage(inquiryBody, config.genai);

        createDraftForThread(recipient, inquirerName, viewingMessage, config);
        processedLabel.addToThread(thread);
        result.drafted += 1;
        console.log(`返信の下書きを作成しました。件名「${thread.getFirstMessageSubject()}」`);
      } catch (threadError) {
        result.errors += 1;
        console.error(
          `下書き作成中にエラーが発生しました。件名「${thread.getFirstMessageSubject()}」詳細: ${formatError(threadError)}`,
        );
      }
    });
  } catch (error) {
    result.errors += 1;
    console.error(`問い合わせ下書き自動作成を中断しました。詳細: ${formatError(error)}`);
  } finally {
    result.durationMs = Date.now() - startedAt.getTime();
    logResult(result);
  }
}

function setScriptProperties(props: Record<string, string>): void {
  PropertiesService.getScriptProperties().setProperties(props, false);
  console.log(`スクリプトプロパティを更新しました。キー: ${Object.keys(props).join(", ")}`);
}

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const body = JSON.parse(e.postData.contents);
    return respondJson(syncScriptProperties(body));
  } catch (error) {
    return respondJson({ ok: false, error: formatError(error) });
  }
}

function setupTrigger(): void {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "main") {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger("main").timeBased().everyMinutes(TRIGGER_INTERVAL_MINUTES).create();

  console.log(`トリガーを登録しました。${TRIGGER_INTERVAL_MINUTES}分ごとに main が実行されます。`);
}

export { doPost, main, setScriptProperties, setupTrigger };
