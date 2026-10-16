import { afterEach, describe, expect, it, vi } from "vitest";

import { respondJson, syncScriptProperties } from "./script-properties-sync";

describe("syncScriptProperties", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubProperties(syncSecret: string) {
    const setProperties = vi.fn();
    const getProperty = vi.fn((key: string) => (key === "SYNC_SECRET" ? syncSecret : ""));
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({ getProperty, setProperties }),
    });

    return { setProperties };
  }

  it("シークレットが一致する場合はスクリプトプロパティを更新する", () => {
    const { setProperties } = stubProperties("correct-secret");

    const result = syncScriptProperties({
      secret: "correct-secret",
      properties: { ORGANIZATION_NAME: "example" },
    });

    expect(setProperties).toHaveBeenCalledWith({ ORGANIZATION_NAME: "example" }, false);
    expect(result).toEqual({ ok: true });
  });

  it("シークレットが一致しない場合はスクリプトプロパティを更新しない", () => {
    const { setProperties } = stubProperties("correct-secret");

    const result = syncScriptProperties({
      secret: "wrong-secret",
      properties: { ORGANIZATION_NAME: "example" },
    });

    expect(setProperties).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "unauthorized" });
  });

  it("propertiesが未指定の場合はスクリプトプロパティを更新しない", () => {
    const { setProperties } = stubProperties("correct-secret");

    const result = syncScriptProperties({ secret: "correct-secret" });

    expect(setProperties).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "properties is required" });
  });
});

describe("respondJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("結果をJSON文字列にしてContentServiceへ渡す", () => {
    const output: { setMimeType: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> } =
      {
        setMimeType: vi.fn(() => output),
        setContent: vi.fn(() => output),
      };
    vi.stubGlobal("ContentService", {
      createTextOutput: () => output,
      MimeType: { JSON: "JSON" },
    });

    respondJson({ ok: true });

    expect(output.setMimeType).toHaveBeenCalledWith("JSON");
    expect(output.setContent).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
  });
});
