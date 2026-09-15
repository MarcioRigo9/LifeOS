import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // integration tests share one Postgres database
    globalSetup: ["./tests/setup/globalSetup.ts"],
    env: {
      DATABASE_URL_RUNTIME: "postgres://lifeos_runtime:lifeos_runtime_test_password@127.0.0.1:5432/lifeos_test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
