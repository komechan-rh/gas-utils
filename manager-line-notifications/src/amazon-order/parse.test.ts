import { describe, expect, it } from "vitest";
import { parseOrderCancelCommand, parseOrderRequestCommand } from "./parse";

describe("parseOrderRequestCommand", () => {
  it("「注文 <商品> <数量>」を解析する", () => {
    expect(parseOrderRequestCommand("注文 トイレットペーパー 2")).toEqual({
      productQuery: "トイレットペーパー",
      quantity: 2,
    });
  });

  it("「注文 <商品>」のみ（数量省略）を解析する", () => {
    expect(parseOrderRequestCommand("注文 トイレットペーパー")).toEqual({
      productQuery: "トイレットペーパー",
      quantity: undefined,
    });
  });

  it.each([
    ["注文 マスキングテープを1つ", "マスキングテープ", 1],
    ["注文 マスキングテープを2", "マスキングテープ", 2],
    ["注文 ティッシュ 2箱", "ティッシュ", 2],
    ["注文 マスキングテープ1本", "マスキングテープ", 1],
    ["注文　マスキングテープを３つ", "マスキングテープ", 3],
  ])("「注文 」で始まり「を」や単位が混ざった「%s」を解析する", (text, productQuery, quantity) => {
    expect(parseOrderRequestCommand(text)).toEqual({ productQuery, quantity });
  });

  it.each([
    ["注文 ゴミ袋（40L）", "ゴミ袋(40L)"],
    ["注文 A4", "A4"],
    ["注文 マスキングテープを", "マスキングテープ"],
  ])("品目名の途中・末尾の数字や末尾の「を」を数量と誤読しない（%s）", (text, productQuery) => {
    expect(parseOrderRequestCommand(text)).toEqual({ productQuery, quantity: undefined });
  });

  it("区切りのある品目名末尾の数字の後の数量は数量として読む（注文 A4 2）", () => {
    expect(parseOrderRequestCommand("注文 A4 2")).toEqual({ productQuery: "A4", quantity: 2 });
  });

  it.each([
    ["トイレットペーパーを2つ注文して", 2],
    ["トイレットペーパーを2個注文", 2],
    ["トイレットペーパーを3本注文して", 3],
  ])("「%s」から数量%iを解析する", (text, quantity) => {
    expect(parseOrderRequestCommand(text)).toEqual({
      productQuery: "トイレットペーパー",
      quantity,
    });
  });

  it("「<商品>を注文して」（数量省略）を解析する", () => {
    expect(parseOrderRequestCommand("トイレットペーパーを注文して")).toEqual({
      productQuery: "トイレットペーパー",
      quantity: undefined,
    });
  });

  it("全角数字・全角スペースを正規化する", () => {
    expect(parseOrderRequestCommand("注文　トイレットペーパー　２")).toEqual({
      productQuery: "トイレットペーパー",
      quantity: 2,
    });
    expect(parseOrderRequestCommand("トイレットペーパーを２つ注文して")).toEqual({
      productQuery: "トイレットペーパー",
      quantity: 2,
    });
  });

  it("どちらのパターンにも一致しない場合はundefined", () => {
    expect(parseOrderRequestCommand("こんにちは")).toBeUndefined();
    expect(parseOrderRequestCommand("注文リスト")).toBeUndefined();
  });
});

describe("parseOrderCancelCommand", () => {
  it("「注文取消 <ID>」を解析する", () => {
    expect(parseOrderCancelCommand("注文取消 AB3CD")).toBe("AB3CD");
  });

  it("一致しない場合はundefined", () => {
    expect(parseOrderCancelCommand("注文取消")).toBeUndefined();
    expect(parseOrderCancelCommand("取消 AB3CD")).toBeUndefined();
  });
});
