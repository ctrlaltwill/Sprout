import tsparser from "@typescript-eslint/parser";
import path from "path";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

const rootDir = path.resolve(import.meta.dirname, "..");

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "plugin/**",
      "node_modules/**",
      "scripts/**",
      "tooling/**",
      "src/tailwind.config.js",
    ],
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: path.join(rootDir, "tsconfig.json"),
        tsconfigRootDir: rootDir,
      },
    },
  },
]);
