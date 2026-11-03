type OrderRequestQuery = {
  productQuery: string;
  quantity: number | undefined;
};

// 全角数字・全角スペースはNFKC正規化で半角に揃える。
function normalizeCommandText(text: string): string {
  return text.normalize("NFKC").trim();
}

const QUANTITY_UNITS = "つ|個|本|袋|箱|パック";
// 「注文 <商品> [数量]」
const ORDER_PREFIX_PATTERN = /^注文\s+(.+?)(?:\s+(\d+))?$/;
// 「<商品>を[数量][つ|個|本|袋|箱|パック]注文[して]」
const ORDER_SUFFIX_PATTERN = new RegExp(`^(.+?)を(?:(\\d+)(?:${QUANTITY_UNITS}))?注文(?:して)?$`);
const ORDER_CANCEL_PATTERN = /^注文取消\s+(\S+)$/;

function parseOrderRequestCommand(rawText: string): OrderRequestQuery | undefined {
  const text = normalizeCommandText(rawText);
  const match = ORDER_PREFIX_PATTERN.exec(text) ?? ORDER_SUFFIX_PATTERN.exec(text);
  if (!match) return undefined;

  const productQuery = match[1].trim();
  if (productQuery === "") return undefined;
  return { productQuery, quantity: match[2] === undefined ? undefined : Number(match[2]) };
}

function parseOrderCancelCommand(rawText: string): string | undefined {
  return ORDER_CANCEL_PATTERN.exec(normalizeCommandText(rawText))?.[1];
}

export type { OrderRequestQuery };
export { parseOrderCancelCommand, parseOrderRequestCommand };
