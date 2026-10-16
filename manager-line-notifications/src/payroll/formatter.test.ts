import { describe, expect, it } from "vitest";
import { formatMonthlyPayrollMessage, formatUnpaidPayrollReminderMessage } from "./formatter";
import type { MonthlyPayrollResult } from "./types";

describe("formatMonthlyPayrollMessage", () => {
  it("対象月が見つからない場合は案内メッセージを返す", () => {
    expect(formatMonthlyPayrollMessage(undefined)).toBe("今月の支払い予定は見つかりませんでした。");
  });

  it("支払い対象者がいる場合は氏名・金額・合計を含める", () => {
    const result: MonthlyPayrollResult = {
      workMonth: "2026/06",
      paymentDueDate: new Date(2026, 6, 30),
      paymentStatus: "未済",
      payments: [
        { personName: "スタッフA", amount: 40000 },
        { personName: "スタッフB", amount: 40000 },
      ],
    };

    const message = formatMonthlyPayrollMessage(result);

    expect(message).toContain("2026/06分");
    expect(message).toContain("支払い予定日 2026/07/30");
    expect(message).toContain("支払い状況: 未済");
    expect(message).toContain("・スタッフA: 40,000円");
    expect(message).toContain("・スタッフB: 40,000円");
    expect(message).toContain("合計: 80,000円");
  });

  it("支払い対象者がいない場合は対象者なしと表示する", () => {
    const result: MonthlyPayrollResult = {
      workMonth: "2026/06",
      paymentDueDate: new Date(2026, 6, 30),
      paymentStatus: "未済",
      payments: [],
    };

    expect(formatMonthlyPayrollMessage(result)).toContain("対象者なし");
  });
});

describe("formatUnpaidPayrollReminderMessage", () => {
  it("未払いのお知らせと、LINEでステータスを更新できる旨を含める", () => {
    const result: MonthlyPayrollResult = {
      workMonth: "2026/06",
      paymentDueDate: new Date(2026, 6, 30),
      paymentStatus: "未済",
      payments: [{ personName: "スタッフA", amount: 40000 }],
    };

    const message = formatUnpaidPayrollReminderMessage(result);

    expect(message).toContain("2026/06分");
    expect(message).toContain("支払い予定日 2026/07/30");
    expect(message).toContain("支払い状況: 未済");
    expect(message).toContain("・スタッフA: 40,000円");
    expect(message).toContain("合計: 40,000円");
    expect(message).toContain("「給与支払い済」と発言すると支払い状況を更新できます。");
  });
});
