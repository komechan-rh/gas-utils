interface SyncRequest {
  secret?: string;
  properties?: Record<string, string>;
}

interface SyncResult {
  ok: boolean;
  error?: string;
}

function syncScriptProperties(request: SyncRequest): SyncResult {
  const expectedSecret = (
    PropertiesService.getScriptProperties().getProperty("SYNC_SECRET") || ""
  ).trim();
  if (!expectedSecret || request.secret !== expectedSecret) {
    return { ok: false, error: "unauthorized" };
  }
  if (!request.properties) {
    return { ok: false, error: "properties is required" };
  }

  PropertiesService.getScriptProperties().setProperties(request.properties, false);
  return { ok: true };
}

function respondJson(result: SyncResult): GoogleAppsScript.Content.TextOutput {
  const output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify(result));
  return output;
}

export type { SyncRequest, SyncResult };
export { respondJson, syncScriptProperties };
