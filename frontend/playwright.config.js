import { defineConfig } from "@playwright/test";

// Browser tests against a real backend on a throwaway local database; see
// e2e/global-setup.js. Run from frontend/: npm run e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.js",
  globalTeardown: "./e2e/global-teardown.js",
  outputDir: "./e2e/.results",
  use: {
    baseURL: "http://localhost:5175",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
