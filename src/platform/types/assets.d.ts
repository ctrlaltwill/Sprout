/**
 * @file src/platform/types/assets.d.ts
 * @summary Module for assets.d.
 *
 * @exports
 *  - (no named exports in this module)
 */

declare module "*.wasm" {
  const wasmBinary: Uint8Array | ArrayBuffer;
  export default wasmBinary;
}