declare module "*.wasm" {
  const wasmBinary: Uint8Array | ArrayBuffer;
  export default wasmBinary;
}