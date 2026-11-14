import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", ...(process.env.FIREBASE_DATABASE_EMULATOR_HOST ? ["tests/rules/**/*.test.ts"] : []), "tests/assets/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
