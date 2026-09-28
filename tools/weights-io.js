// Reads the evaluation weights file in node (the browser reads it in
// engine/weights.js; both share the format there).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { unpackWeights } from '../src/engine/weights.js';

export function loadWeights(path) {
  const buf = gunzipSync(readFileSync(path));
  return unpackWeights(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}
