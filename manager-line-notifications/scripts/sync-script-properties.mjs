import { syncScriptProperties } from "shared/sync-script-properties-cli";

await syncScriptProperties({
  webAppUrlKey: "MANAGER_LINE_WEBAPP_URL",
  requiredKeys: ["LINE_GROUP_ID", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "PAYROLL_SPREADSHEET_ID"],
});
