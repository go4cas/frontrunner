import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // "list" always includes the "html" reporter's data so a failure produces a
  // downloadable, fully-detailed report (CI's Annotations panel truncates).
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
});
