import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "plugin/**",
      "node_modules/**",
      "esbuild.config.js",
      "postcss.config.cjs",
      "scripts/**",
      "src/tailwind.config.js",
    ],
  },

  // ── Base JS recommended rules ───────────────────────────────────
  eslint.configs.recommended,

  // ── TypeScript recommended (type-aware) ─────────────────────────
  ...tseslint.configs.recommendedTypeChecked,

  // ── TypeScript project settings ─────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Custom rules ────────────────────────────────────────────────
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      // ── Unused variables ──────────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // ── Flag `as any` and explicit `any` ──────────────────────
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

      // ── Consistency ───────────────────────────────────────────
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // ── Async safety ──────────────────────────────────────────
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "warn",

      // ── Relax rules that are too noisy for an existing codebase
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
);
