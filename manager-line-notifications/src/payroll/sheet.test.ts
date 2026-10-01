import { describe, expect, it } from "vitest";
import {
  buildMonthlyPayrollResult,
  findPaymentStatusCell,
  getMonthsAgoDate,
  resolveMarkTargetCell,
} from "./sheet";

// 実際のスプレッドシートの氏名は含めず、ダミーの氏名で構成を再現する。
// スタッフCは「氏名行に名前はあるが合計列のラベルが空欄」という
// 実データで起きている入力漏れを再現し、それでも合計を検出できることを確認する。
function buildSheetValues(dueDate: Date): unknown[][] {
  const nameRow = [
    "",
    "",
    "",
    "スタッフA",
    "",
    "",
    "",
    "",
    "スタッフB",
    "",
    "",
    "",
    "",
    "スタッフC",
    "",
    "",
    "",
    "",
    "空き部屋数",
    "支払い状況",
  ];
  const labelRow = [
    "稼働月",
    "稼働月末日",
    "支払い予定日",
    "合計",
    "基本",
    "稼働率",
    "内見報酬",
    "積み残し分",
    "合計",
    "基本",
    "稼働率",
    "内見報酬",
    "積み残し分",
    "",
    "基本",
    "稼働率",
    "内見報酬",
    "積み残し分",
    "",
    "",
  ];
  const dataRow = [
    "2026/06",
    new Date(2026, 5, 30),
    dueDate,
    40000,
    30000,
    10000,
    0,
    0,
    40000,
    30000,
    0,
    0,
    10000,
    20000,
    15000,
    5000,
    0,
    0,
    4,
    "未済",
  ];

  return [nameRow, labelRow, dataRow];
}

describe("buildMonthlyPayrollResult", () => {
  it("支払い予定日が対象月の行から給与情報を抽出する", () => {
    const dueDate = new Date(2026, 6, 30);
    const values = buildSheetValues(dueDate);

    const result = buildMonthlyPayrollResult(values, new Date(2026, 6, 9));

    expect(result).toEqual({
      workMonth: "2026/06",
      paymentDueDate: dueDate,
      paymentStatus: "未済",
      payments: [
        { personName: "スタッフA", amount: 40000 },
        { personName: "スタッフB", amount: 40000 },
        { personName: "スタッフC", amount: 20000 },
      ],
    });
  });

  it("対象月に一致する支払い予定日がなければundefinedを返す", () => {
    const dueDate = new Date(2026, 6, 30);
    const values = buildSheetValues(dueDate);

    const result = buildMonthlyPayrollResult(values, new Date(2026, 7, 1));

    expect(result).toBeUndefined();
  });

  it("金額が0または空欄の人は対象から除外する", () => {
    const dueDate = new Date(2026, 6, 30);
    const values = buildSheetValues(dueDate);
    values[2][8] = 0;
    values[2][13] = "";

    const result = buildMonthlyPayrollResult(values, new Date(2026, 6, 9));

    expect(result?.payments).toEqual([{ personName: "スタッフA", amount: 40000 }]);
  });
});

describe("findPaymentStatusCell", () => {
  it("対象月の行にある支払い状況セルの位置（1始まりの行・列）を返す", () => {
    const dueDate = new Date(2026, 6, 30);
    const values = buildSheetValues(dueDate);

    const cell = findPaymentStatusCell(values, new Date(2026, 6, 9));

    expect(cell).toMatchObject({ row: 3, col: 20 });
  });

  it("対象月に一致する支払い予定日がなければundefinedを返す", () => {
    const dueDate = new Date(2026, 6, 30);
    const values = buildSheetValues(dueDate);

    const cell = findPaymentStatusCell(values, new Date(2026, 7, 1));

    expect(cell).toBeUndefined();
  });
});

describe("getMonthsAgoDate", () => {
  it("基準日からmonthsAgoヶ月前の1日を返す", () => {
    expect(getMonthsAgoDate(2, new Date(2026, 7, 15))).toEqual(new Date(2026, 5, 1));
  });

  it("年をまたぐ場合も正しく計算する", () => {
    expect(getMonthsAgoDate(2, new Date(2026, 0, 15))).toEqual(new Date(2025, 10, 1));
  });
});

describe("resolveMarkTargetCell", () => {
  // 10月1日時点で、8月支払い分（7月稼働）・9月支払い分（8月稼働）が未済のまま残っているケース。
  function buildSheetValuesWithStatuses(statuses: {
    jul: string;
    aug: string;
    sep: string;
    oct: string;
  }): unknown[][] {
    const nameRow = ["", "", "", "スタッフA", "支払い状況"];
    const labelRow = ["稼働月", "稼働月末日", "支払い予定日", "合計", ""];
    return [
      nameRow,
      labelRow,
      ["2026/06", new Date(2026, 5, 30), new Date(2026, 6, 30), 40000, statuses.jul],
      ["2026/07", new Date(2026, 6, 31), new Date(2026, 7, 31), 40000, statuses.aug],
      ["2026/08", new Date(2026, 7, 31), new Date(2026, 8, 30), 40000, statuses.sep],
      ["2026/09", new Date(2026, 8, 30), new Date(2026, 9, 31), 40000, statuses.oct],
    ];
  }

  const today = new Date(2026, 9, 1);

  it("未済の過去月分のうち最も古いもののセル位置を返す", () => {
    const values = buildSheetValuesWithStatuses({
      jul: "済",
      aug: "未済",
      sep: "未済",
      oct: "未済",
    });

    expect(resolveMarkTargetCell(values, today)).toEqual({ row: 4, col: 5, workMonth: "2026/07" });
  });

  it("古い過去月分が済になった後は、次に古い未済の過去月分を返す（当月分には進まない）", () => {
    const values = buildSheetValuesWithStatuses({ jul: "済", aug: "済", sep: "未済", oct: "未済" });

    expect(resolveMarkTargetCell(values, today)).toEqual({ row: 5, col: 5, workMonth: "2026/08" });
  });

  it("過去月分がすべて済であれば、当月分のセル位置を返す", () => {
    const values = buildSheetValuesWithStatuses({ jul: "済", aug: "済", sep: "済", oct: "未済" });

    expect(resolveMarkTargetCell(values, today)).toEqual({ row: 6, col: 5, workMonth: "2026/09" });
  });

  it("支払い状況が空欄の過去月分は対象外とする", () => {
    const values = buildSheetValuesWithStatuses({ jul: "", aug: "済", sep: "未済", oct: "未済" });

    expect(resolveMarkTargetCell(values, today)).toEqual({ row: 5, col: 5, workMonth: "2026/08" });
  });
});
