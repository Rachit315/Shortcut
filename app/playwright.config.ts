import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Use a preinstalled Chromium when available (CI images / sandboxes), else Playwright's own.
const local = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1200, height: 780 },
    launchOptions: existsSync(local) ? { executablePath: local } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 780 } } }],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
