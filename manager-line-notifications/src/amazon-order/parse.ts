type OrderRequestQuery = {
  productQuery: string;
  quantity: number | undefined;
};

// 全角数字・全角スペースはNFKC正規化で半角に揃える。
function normalizeCommandText(text: string): string {
  return text.normalize("NFKC").trim();
}

const QUANTITY_UNITS = "つ|個|本|袋|箱|パック";
// 「注文 <商品> [数量]」。「注文 <商品>を1つ」「注文 <商品> 2箱」「注文 <商品>1本」のように
// 「を」や単位が混ざった書き方も受け付ける。品目名の末尾の数字（例: A4）を数量と誤読しないよう、
// 区切り（を・空白）が無い場合は単位が付いたときだけ数量とみなす。
const ORDER_PREFIX_PATTERN = new RegExp(
  `^注文\\s+(.+?)(?:(?:を|\\s+)(\\d+)(?:${QUANTITY_UNITS})?|(\\d+)(?:${QUANTITY_UNITS})|を)?$`,
);
// 「<商品>を[数量][つ|個|本|袋|箱|パック]注文[して]」
const ORDER_SUFFIX_PATTERN = new RegExp(`^(.+?)を(?:(\\d+)(?:${QUANTITY_UNITS}))?注文(?:して)?$`);
const ORDER_CANCEL_PATTERN = /^注文取消\s+(\S+)$/;

function parseOrderRequestCommand(rawText: string): OrderRequestQuery | undefined {
  const text = normalizeCommandText(rawText);
  const match = ORDER_PREFIX_PATTERN.exec(text) ?? ORDER_SUFFIX_PATTERN.exec(text);
  if (!match) return undefined;

  const productQuery = match[1].trim();
  if (productQuery === "") return undefined;
  // 接頭辞形の「単位付き・区切りなし」の数量だけ3番目のグループに入る。
  const quantity = match[2] ?? match[3];
  return { productQuery, quantity: quantity === undefined ? undefined : Number(quantity) };
}

function parseOrderCancelCommand(rawText: string): string | undefined {
  return ORDER_CANCEL_PATTERN.exec(normalizeCommandText(rawText))?.[1];
}

export type { OrderRequestQuery };
export { parseOrderCancelCommand, parseOrderRequestCommand };
