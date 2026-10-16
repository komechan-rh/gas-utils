import { afterEach, expect, it, vi } from "vitest";

vi.mock("./line-client", () => ({ replyTextMessage: vi.fn() }));
vi.mock("./payroll/sheet", () => ({ markMonthlyPayrollAsPaid: vi.fn() }));

import { replyTextMessage } from "./line-client";
import { findLineCommand } from "./line-commands";
import { markMonthlyPayrollAsPaid } from "./payroll/sheet";

afterEach(() => vi.resetAllMocks());
it("返信に失敗した後の再配信でも給与の更新を繰り返さない", () => {
  vi.mocked(markMonthlyPayrollAsPaid).mockReturnValueOnce(true).mockReturnValueOnce(undefined);
  vi.mocked(replyTextMessage).mockImplementationOnce(() => {
    throw new Error("reply failed");
  });
  const command = findLineCommand("給与支払い済");
  const context = { replyToken: "reply-1", webhookEventId: "event-1" };
  expect(() => command?.(context)).toThrow("reply failed");
  command?.(context);
  expect(markMonthlyPayrollAsPaid).toHaveBeenNthCalledWith(1, "event-1");
  expect(markMonthlyPayrollAsPaid).toHaveBeenNthCalledWith(2, "event-1");
  expect(replyTextMessage).toHaveBeenCalledOnce();
});
