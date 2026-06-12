import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // threads (not vmThreads): vm-context teardown segfaults on Linux CI once files
    // hold live Colyseus servers/sockets (exit 139 on every master run since stage 3).
    // Not forks: vitest 2.0.5 + tinypool 1.1.1 mangles worker stdout over child IPC.
    // Serial because rooms bind real ports.
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 20_000,
  },
});
