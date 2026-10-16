import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./line-webhook", () => ({
  handleLineWebhook: vi.fn(() => "line-response"),
}));
vi.mock("./calendar/schedule", () => ({
  getCurrentWeekMonday: vi.fn(),
  getWeeklyEvents: vi.fn(),
}));
vi.mock("./calendar/formatter", () => ({
  formatWeeklyMessage: vi.fn(),
}));
vi.mock("./line-client", () => ({
  pushTextMessage: vi.fn(),
}));
vi.mock("./payroll/formatter", () => ({
  formatMonthlyPayrollMessage: vi.fn(),
}));
vi.mock("./payroll/sheet", () => ({
  getMonthlyPayroll: vi.fn(),
}));

import { doPost } from "./index";
import { handleLineWebhook } from "./line-webhook";

describe("doPost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubServices(syncSecret: string) {
    const setProperties = vi.fn();
    const getProperty = vi.fn((key: string) => (key === "SYNC_SECRET" ? syncSecret : ""));
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty, setProperties }),
    });

    const output: { setMimeType: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> } =
      {
        setMimeType: vi.fn(() => output),
        setContent: vi.fn(() => output),
      };
    vi.stubGlobal("ContentService", {
      createTextOutput: () => output,
      MimeType: { JSON: "JSON" },
    });

    return { setProperties, output };
  }

  function buildEvent(body: unknown) {
    return { postData: { contents: JSON.stringify(body) } } as GoogleAppsScript.Events.DoPost;
  }

  it("eventsを持つボディの場合はLINE Webhookに委譲する", () => {
    stubServices("correct-secret");
    const e = buildEvent({ events: [{ type: "message" }] });

    const result = doPost(e);

    expect(handleLineWebhook).toHaveBeenCalledWith(e);
    expect(result).toBe("line-response");
  });

  it("secret/propertiesを持つボディの場合はスクリプトプロパティ同期に委譲する", () => {
    const { setProperties, output } = stubServices("correct-secret");

    doPost(buildEvent({ secret: "correct-secret", properties: { LINE_GROUP_ID: "group-1" } }));

    expect(handleLineWebhook).not.toHaveBeenCalled();
    expect(setProperties).toHaveBeenCalledWith({ LINE_GROUP_ID: "group-1" }, false);
    expect(output.setContent).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
  });

  it("不正なJSONの場合はエラーレスポンスを返し、どちらにも委譲しない", () => {
    const { output } = stubServices("correct-secret");

    doPost({ postData: { contents: "not-json" } } as GoogleAppsScript.Events.DoPost);

    expect(handleLineWebhook).not.toHaveBeenCalled();
    const [responseJson] = output.setContent.mock.calls[0] ?? [];
    expect(JSON.parse(responseJson as string)).toMatchObject({ ok: false });
  });
});
