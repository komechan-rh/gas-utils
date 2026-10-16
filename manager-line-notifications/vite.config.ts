import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "gas-entrypoint",
      generateBundle(_, bundle) {
        const chunk = bundle["index.js"];
        if (chunk?.type === "chunk") {
          chunk.code +=
            "\nfunction weeklyScheduleToLine() { ManagerLineNotificationsBundle.weeklyScheduleToLine(); }" +
            "\nfunction monthlyPayrollToLine() { ManagerLineNotificationsBundle.monthlyPayrollToLine(); }" +
            "\nfunction unpaidPayrollReminderToLine() { ManagerLineNotificationsBundle.unpaidPayrollReminderToLine(); }" +
            "\nfunction setupTrigger() { ManagerLineNotificationsBundle.setupTrigger(); }" +
            "\nfunction doPost(e) { return ManagerLineNotificationsBundle.doPost(e); }\n";
        }
      },
    },
  ],
  build: {
    emptyOutDir: true,
    minify: false,
    target: "es2017",
    lib: {
      entry: "src/index.ts",
      formats: ["iife"],
      name: "ManagerLineNotificationsBundle",
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
  },
});
