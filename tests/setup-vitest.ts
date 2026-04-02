/**
 * @file tests/setup-vitest.ts
 * @summary Unit tests for setup vitest behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { vi } from "vitest";

// Node-based Vitest runs cannot import raw .wasm modules directly.
// Mock sql.js wasm asset so suites that do not execute SQLite paths can load.
vi.mock("sql.js/dist/sql-wasm.wasm", () => ({
  default: new Uint8Array(),
}));
