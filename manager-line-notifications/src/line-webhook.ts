import { findLineCommand } from "./line-commands";

type LineWebhookMessage = {
  type: string;
  text?: string;
};

type LineWebhookEvent = {
  type: string;
  replyToken?: string;
  source?: {
    groupId?: string;
    userId?: string;
    roomId?: string;
  };
  message?: LineWebhookMessage;
};

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

function handleLineWebhook(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  console.log(`Webhook受信: ${e.postData.contents}`);

  const body: LineWebhookBody = JSON.parse(e.postData.contents);

  for (const event of body.events ?? []) {
    if (event.source?.groupId) {
      console.log(`LINE_GROUP_ID: ${event.source.groupId}`);
    }

    if (event.type === "message" && event.message?.type === "text" && event.replyToken) {
      const command = event.message.text && findLineCommand(event.message.text);
      if (command) {
        command({ replyToken: event.replyToken, groupId: event.source?.groupId });
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" })).setMimeType(
    ContentService.MimeType.JSON,
  );
}

export { handleLineWebhook };
