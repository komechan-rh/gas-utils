export type GenAiConfig = {
  apiKey: string;
  model: string;
};

const GENAI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function buildInquiryReplyPrompt(inquiryBody: string): string {
  return (
    "あなたは賃貸シェアハウスの内見案内を担当するスタッフです。\n" +
    "以下の問い合わせメール本文を読み、返信メールの本文中に挿入する段落のみを日本語で作成してください。\n\n" +
    "ルール:\n" +
    "- 宛名、挨拶、署名は含めない。本文の中心部分のみを出力する。\n" +
    "- 見学希望日時が明記されている場合は、その日時で内見の予約を確定する旨を伝える。\n" +
    "- 見学希望日時が明記されていない、または「希望なし」となっている場合は、候補となる日時を3つ程度提案し、都合の良い日時を選んでもらうよう依頼する。\n" +
    "- 敬語（です/ます体）を使う。\n" +
    "- 出力は本文のみとし、前置きや説明、Markdown記法を含めない。\n\n" +
    `問い合わせメール本文:\n${inquiryBody}`
  );
}

export function parseGenAiResponseText(responseBody: string): string {
  const parsed = JSON.parse(responseBody);
  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || typeof text !== "string") {
    throw new Error(
      `GenAI APIのレスポンスからメッセージを取得できませんでした。詳細: ${responseBody}`,
    );
  }

  return text.trim();
}

export function generateInquiryReplyMessage(inquiryBody: string, config: GenAiConfig): string {
  const url = `${GENAI_API_BASE_URL}/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const payload = {
    contents: [
      {
        parts: [{ text: buildInquiryReplyPrompt(inquiryBody) }],
      },
    ],
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `GenAI APIの呼び出しに失敗しました。ステータス: ${statusCode}、詳細: ${responseBody}`,
    );
  }

  return parseGenAiResponseText(responseBody);
}
