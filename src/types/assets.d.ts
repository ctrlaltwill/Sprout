/**
 * @file src/types/assets.d.ts
 * @summary Ambient type declarations for binary asset imports (e.g. .wasm files).
 */

declare module "*.wasm" {
  const wasmBinary: Uint8Array | ArrayBuffer;
  export default wasmBinary;
}