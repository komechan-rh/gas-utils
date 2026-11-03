import type { CatalogEntry } from "./types";

// 「品目」「Amazonリンク」は既存の実シートの列。「別名」「既定数量」「上限数量」「価格上限」は任意列。
const CATALOG_HEADERS = {
  productName: "品目",
  aliases: "別名",
  amazonLink: "Amazonリンク",
  defaultQuantity: "既定数量",
  maxQuantity: "上限数量",
  priceCapPerUnit: "価格上限",
} as const;

// Amazonの商品URL（/dp/<ASIN> または /gp/product/<ASIN>、クエリ付きも可）からASINを抽出する。
const ASIN_PATTERN = /\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:[/?]|$)/;

function buildHeaderIndex(headerRow: unknown[]): Record<string, number> {
  const index: Record<string, number> = {};
  headerRow.forEach((header, col) => {
    if (typeof header === "string" && header !== "") index[header] = col;
  });
  return index;
}

function parseAliases(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,、]/)
    .map((alias) => alias.trim())
    .filter((alias) => alias !== "");
}

// 別名照合はNFKC正規化・空白除去・小文字化した上で完全一致させる（全角/半角・大小文字の表記差を吸収する）。
function normalizeAliasQuery(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function extractAsin(link: unknown): string | undefined {
  if (typeof link !== "string") return undefined;
  return ASIN_PATTERN.exec(link)?.[1];
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// カタログシートの値（1行目=ヘッダー）からCatalogEntry[]を構築する。列順には依存しない。
// 必要在庫数・購入タイミングは人間向けの備忘列で、注文ロジックでは使わないため読み取らない。
function buildCatalogEntries(values: unknown[][]): CatalogEntry[] {
  const [headerRow, ...dataRows] = values;
  if (!headerRow) return [];
  const headerIndex = buildHeaderIndex(headerRow);
  const aliasCol = headerIndex[CATALOG_HEADERS.aliases];

  return dataRows
    .map((row) => {
      const productName = String(row[headerIndex[CATALOG_HEADERS.productName]] ?? "").trim();
      const extraAliases = aliasCol === undefined ? [] : parseAliases(row[aliasCol]);
      return {
        productName,
        aliases: [productName, ...extraAliases].filter((alias) => alias !== ""),
        asin: extractAsin(row[headerIndex[CATALOG_HEADERS.amazonLink]]),
        defaultQuantity: toOptionalNumber(row[headerIndex[CATALOG_HEADERS.defaultQuantity]]) ?? 1,
        maxQuantity: toOptionalNumber(row[headerIndex[CATALOG_HEADERS.maxQuantity]]),
        priceCapPerUnit: toOptionalNumber(row[headerIndex[CATALOG_HEADERS.priceCapPerUnit]]),
      };
    })
    .filter((entry) => entry.productName !== "");
}

// 0件なら未登録、2件以上なら別名の重複登録（曖昧）として呼び出し側で扱う。
function findCatalogMatches(query: string, catalog: CatalogEntry[]): CatalogEntry[] {
  const target = normalizeAliasQuery(query);
  return catalog.filter((entry) =>
    entry.aliases.some((alias) => normalizeAliasQuery(alias) === target),
  );
}

export { buildCatalogEntries, buildHeaderIndex, findCatalogMatches };
