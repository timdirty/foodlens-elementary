import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(
        __dirname,
        "lib/__tests__/server-only-stub.ts",
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    // Avoid pre-forking one worker per logical core on presentation laptops.
    // The IndexedDB suites are I/O-bound and become less reliable when many
    // jsdom/transform workers compete with the local Supabase VM.
    maxWorkers: 4,
    coverage: { reporter: ["text", "html"] },
  },
});
