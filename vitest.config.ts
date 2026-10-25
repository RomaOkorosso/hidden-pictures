import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/rules/**/*.test.ts", "tests/assets/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
