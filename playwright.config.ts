import { defineConfig } from "@playwright/test";

const baseURL = process.env.PW_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // Tests joinOrCreate the same in-process lobby room; parallel workers
  // would land in one room and corrupt each other's player counts.
  workers: 1,
  use: {
    baseURL,
    headless: true,
  },
  // With PW_BASE_URL set (prod-bundle verification) the caller owns the server.
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
