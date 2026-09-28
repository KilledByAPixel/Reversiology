// Reads the evaluation weights file in node (the browser reads it in
// engine/weights.js; both share the format there).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { unpackWeights } from '../src/engine/weights.js';
import { useWasm } from '../src/engine/wasm.js';

// The WebAssembly search core, for every Engine made after this (unless
// NO_WASM is set in the environment; CORE_WASM=file tries another build).
if (!process.env.NO_WASM) useWasm(new WebAssembly.Module(readFileSync(process.env.CORE_WASM || new URL('../src/engine/core.wasm', import.meta.url))));

export function loadWeights(path) {
  const buf = gunzipSync(readFileSync(path));
  return unpackWeights(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}
