import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markMonthlyPayrollAsPaid } from "./sheet";

let values: unknown[][];
let properties: Map<string, string>;
const setValue = vi.fn();
const releaseLock = vi.fn();
const waitLock = vi.fn();
const setProperty = vi.fn();
const targetDate = new Date(2026, 7, 5);

beforeEach(() => {
  properties = new Map([["PAYROLL_SPREADSHEET_ID", "test-sheet"]]);
  values = [
    ["", "", "支払い状況"],
    ["稼働月", "支払い予定日", ""],
    ["2026/06", new Date(2026, 6, 30), "未済"],
    ["2026/07", new Date(2026, 7, 30), "未済"],
  ];
  setProperty.mockImplementation((k: string, v: string) => properties.set(k, v));
  setValue.mockImplementation((row: number, col: number, value: string) => {
    values[row - 1][col - 1] = value;
  });
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({ getProperty: (k: string) => properties.get(k), setProperty }),
  });
  vi.stubGlobal("LockService", { getScriptLock: () => ({ waitLock, releaseLock }) });
  vi.stubGlobal("SpreadsheetApp", {
    openById: () => ({
      getSheets: () => [
        {
          getDataRange: () => ({ getValues: () => values }),
          getRange: (row: number, col: number) => ({
            setValue: (value: string) => setValue(row, col, value),
          }),
        },
      ],
    }),
    flush: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("給与更新の再配信", () => {
  it("更新後に同じIDを再配信しても当月は未済のままになる", () => {
    expect(markMonthlyPayrollAsPaid("event-1", targetDate)).toBe(true);
    expect(markMonthlyPayrollAsPaid("event-1", targetDate)).toBeUndefined();
    expect(values[2][2]).toBe("済");
    expect(values[3][2]).toBe("未済");
    expect(setValue).toHaveBeenCalledOnce();
    expect(waitLock).toHaveBeenCalledTimes(2);
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });
  it("書き込み後・完了記録前の障害でも対象月を変えず再試行する", () => {
    setProperty
      .mockImplementationOnce((k: string, v: string) => properties.set(k, v))
      .mockImplementationOnce(() => {
        throw new Error("storage failed");
      });
    expect(() => markMonthlyPayrollAsPaid("event-1", targetDate)).toThrow("storage failed");
    expect(markMonthlyPayrollAsPaid("event-1", new Date(2026, 8, 1))).toBe(true);
    expect(values[2][2]).toBe("済");
    expect(values[3][2]).toBe("未済");
    expect(setValue.mock.calls.map(([row]) => row)).toEqual([3, 3]);
    expect(releaseLock).toHaveBeenCalledTimes(2);
  });
  it("対象月の保存に失敗した場合はシートに書き込まない", () => {
    setProperty.mockImplementationOnce(() => {
      throw new Error("storage full");
    });
    expect(() => markMonthlyPayrollAsPaid("event-1", targetDate)).toThrow("storage full");
    expect(setValue).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
  it("書き込み失敗後も同じ対象月を再試行する", () => {
    setValue.mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    expect(() => markMonthlyPayrollAsPaid("event-1", targetDate)).toThrow("write failed");
    expect(markMonthlyPayrollAsPaid("event-1", targetDate)).toBe(true);
    expect(values[3][2]).toBe("未済");
  });
  it("対象なしのイベントも記録し、翌月に再配信されても更新しない", () => {
    expect(markMonthlyPayrollAsPaid("event-1", new Date(2026, 5, 1))).toBe(false);
    expect(markMonthlyPayrollAsPaid("event-1", targetDate)).toBeUndefined();
    expect(setValue).not.toHaveBeenCalled();
  });
  it("保存済み対象の行が消えても別月へフォールバックしない", () => {
    setValue.mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    expect(() => markMonthlyPayrollAsPaid("event-1", targetDate)).toThrow("write failed");
    values.splice(2, 1);
    expect(markMonthlyPayrollAsPaid("event-1", targetDate)).toBe(false);
    expect(values[2][2]).toBe("未済");
    expect(setValue).toHaveBeenCalledOnce();
  });
  it("同時実行ロックを取得できない場合は読み書きしない", () => {
    waitLock.mockImplementationOnce(() => {
      throw new Error("locked");
    });
    expect(() => markMonthlyPayrollAsPaid("event-1", targetDate)).toThrow("locked");
    expect(setProperty).not.toHaveBeenCalled();
    expect(setValue).not.toHaveBeenCalled();
  });
  it("別イベントなら次の対象月を更新できる", () => {
    markMonthlyPayrollAsPaid("event-1", targetDate);
    markMonthlyPayrollAsPaid("event-2", targetDate);
    expect(values[2][2]).toBe("済");
    expect(values[3][2]).toBe("済");
  });
});
