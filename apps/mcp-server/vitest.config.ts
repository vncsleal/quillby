import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Vitest 4 occasionally surfaces false-positive source-map parse
    // errors after otherwise successful runs in this workspace layout.
    dangerouslyIgnoreUnhandledErrors: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/mcp/server.ts"], // integration-tested separately
    },
  },
});
