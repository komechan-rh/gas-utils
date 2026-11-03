import { describe, expect, it } from "vitest";
import { buildCatalogEntries, findCatalogMatches } from "./catalog";

const HEADER = [
  "品目",
  "必要在庫数",
  "購入タイミング",
  "Amazonリンク",
  "別名",
  "既定数量",
  "上限数量",
  "価格上限",
];

function row(values: Record<string, unknown>): unknown[] {
  return HEADER.map((header) => values[header] ?? "");
}

describe("buildCatalogEntries", () => {
  it("列順に依存せずヘッダー名でカタログ行を読み取る", () => {
    const values = [
      HEADER,
      row({
        品目: "トイレットペーパー",
        Amazonリンク: "https://www.amazon.co.jp/gp/product/B000AAAAAA?psc=1",
        別名: "トイペ、TP",
        既定数量: 1,
        上限数量: 5,
        価格上限: 500,
      }),
    ];

    const [entry] = buildCatalogEntries(values);
    expect(entry).toMatchObject({
      productName: "トイレットペーパー",
      aliases: ["トイレットペーパー", "トイペ", "TP"],
      asin: "B000AAAAAA",
      defaultQuantity: 1,
      maxQuantity: 5,
      priceCapPerUnit: 500,
    });
  });

  it("任意列が空・無い場合は既定数量1・上限なし・価格上限なしにする", () => {
    const values = [
      HEADER,
      row({ 品目: "ティッシュ", Amazonリンク: "https://www.amazon.co.jp/dp/B000BBBBBB" }),
    ];

    const [entry] = buildCatalogEntries(values);
    expect(entry.defaultQuantity).toBe(1);
    expect(entry.maxQuantity).toBeUndefined();
    expect(entry.priceCapPerUnit).toBeUndefined();
  });

  it("Amazonリンクが空・ASIN抽出不可の場合はasinがundefinedになる", () => {
    const values = [
      HEADER,
      row({ 品目: "商品A", Amazonリンク: "" }),
      row({ 品目: "商品B", Amazonリンク: "https://www.amazon.co.jp/s?k=foo" }),
    ];

    const entries = buildCatalogEntries(values);
    expect(entries.map((e) => e.asin)).toEqual([undefined, undefined]);
  });

  it("品目が空の行は除外する", () => {
    const values = [HEADER, row({ 品目: "" })];
    expect(buildCatalogEntries(values)).toEqual([]);
  });
});

describe("findCatalogMatches", () => {
  const catalog = buildCatalogEntries([
    HEADER,
    row({
      品目: "トイレットペーパー",
      Amazonリンク: "https://www.amazon.co.jp/dp/B000AAAAAA",
      別名: "トイペ",
    }),
    row({ 品目: "ハンドソープ", Amazonリンク: "https://www.amazon.co.jp/dp/B000CCCCCC" }),
  ]);

  it("NFKC正規化・空白除去・小文字化した上で完全一致させる", () => {
    expect(findCatalogMatches("トイペ", catalog)).toHaveLength(1);
    expect(findCatalogMatches(" トイペ ", catalog)).toHaveLength(1);
    expect(findCatalogMatches("トイレットペーパー", catalog)).toHaveLength(1);
  });

  it("一致しない場合は0件", () => {
    expect(findCatalogMatches("存在しない商品", catalog)).toHaveLength(0);
  });
});
