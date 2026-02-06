import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // The "obsidian" package is a type-only dev stub — it can't be resolved
      // at runtime. Provide a lightweight shim so store.ts can be imported.
      obsidian: path.resolve(__dirname, "tests/__mocks__/obsidian.ts"),
    },
  },
});
