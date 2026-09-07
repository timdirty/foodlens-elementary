import { defineConfig, devices } from "@playwright/test";
import { createE2eRuntime } from "./scripts/e2e-runtime";

const runtime = createE2eRuntime();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  // A clean product gate should pass on the first run. Retrying can hide
  // IndexedDB, navigation, or focus races that matter during a live demo.
  retries: 0,
  reporter: "line",
  globalSetup: "./scripts/e2e-preflight.ts",
  use: {
    baseURL: runtime.baseURL,
    trace: "retain-on-failure",
  },
  webServer: runtime.webServer,
  projects: [
    {
      name: "mobile-390",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "projector-1920",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
