// The evaluation weights. Each pattern group is symmetric in itself (a line
// read backwards, a corner shape mirrored on its diagonal), so one weight
// serves each mirror pair: weights are kept packed, one per canonical index,
// and the search looks them up through CANON_OF (full index → packed slot).
//
// File format (little-endian, then gzipped):
//   'RVW2', uint16 stages, uint16 groups, uint16 quantum, uint16 reserved,
//   64 bytes: the stage of each ply (discs − 4, 0..60),
//   then stages × PACKED_STAGE int16 values, as two byte planes (all low
//   bytes, then all high bytes). Each value is the weight divided by quantum,
//   minus the same slot two stages earlier (the previous stage with the same
//   side to move), which makes the file compress well.
// Weights are in 1/128 disc, from the side to move's view (digit 1 = side to
// move's disc, 2 = opponent's). Slot 0 of each stage is its bias.
import { FEATURES, GROUP_OF, NG, GROUP_SIZE, GROUP_OFFSET, STAGE_SIZE, POW3, SWAP } from './patterns.js';
import { SYMMETRIES } from '../board.js';

// Permutations of each group's squares that map the group onto itself.
function selfPerms(g) {
  const a = FEATURES[GROUP_OF.indexOf(g)];
  return SYMMETRIES.map(m => a.map(s => a.indexOf(m[s]))).filter(p => p.every(x => x >= 0) && p.some((x, k) => x !== k));
}

// CANON[g][index] = the index's slot among the group's canonical indices.
// CANON_COUNT[g] = how many canonical indices.
export const CANON = [], CANON_COUNT = [];
for (let g = 0; g < NG; g++) {
  const n = GROUP_SIZE[g], perms = selfPerms(g), size = POW3[n];
  const digits = new Uint8Array(n), t = new Uint8Array(n);
  const canon = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    let v = i;
    for (let k = n - 1; k >= 0; k--) { digits[k] = v % 3; v = (v / 3) | 0; }
    let min = i;
    for (const p of perms) {
      for (let k = 0; k < n; k++) t[p[k]] = digits[k]; // square k's disc moves to square p[k]
      let j = 0;
      for (let k = 0; k < n; k++) j = j * 3 + t[k];
      if (j < min) min = j;
    }
    canon[i] = min;
  }
  const slot = new Int32Array(size).fill(-1);
  let c = 0;
  for (let i = 0; i < size; i++) if (canon[i] === i) slot[i] = c++;
  for (let i = 0; i < size; i++) canon[i] = slot[canon[i]];
  CANON.push(canon); CANON_COUNT.push(c);
}
export const PACKED_STAGE = 1 + CANON_COUNT.reduce((a, b) => a + b, 0);
export const PACKED_OFFSET = [];
{ let o = 1; for (let g = 0; g < NG; g++) { PACKED_OFFSET[g] = o; o += CANON_COUNT[g]; } }

// Full feature index (GROUP_OFFSET[g] + index) → packed slot, and the same
// for the index with the colours swapped (white to move).
export const CANON_OF = new Int32Array(STAGE_SIZE);
export const CANON_OF_SWAPPED = new Int32Array(STAGE_SIZE);
for (let g = 0; g < NG; g++) {
  for (let i = 0; i < POW3[GROUP_SIZE[g]]; i++) {
    CANON_OF[GROUP_OFFSET[g] + i] = PACKED_OFFSET[g] + CANON[g][i];
    CANON_OF_SWAPPED[GROUP_OFFSET[g] + i] = PACKED_OFFSET[g] + CANON[g][SWAP[g][i]];
  }
}

// Decompressed file bytes → { w: Int16Array of stages × PACKED_STAGE, stageOf: stage by disc count, stages }.
export function unpackWeights(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'RVW2') throw new Error('not a Reversiology weights file');
  const stages = dv.getUint16(4, true), groups = dv.getUint16(6, true), q = dv.getUint16(8, true);
  if (groups !== NG) throw new Error('weights file has the wrong pattern groups');
  const n = stages * PACKED_STAGE;
  if (bytes.length !== 76 + 2 * n) throw new Error('weights file is the wrong size');
  const stageOf = new Uint8Array(65);
  for (let d = 0; d <= 64; d++) stageOf[d] = Math.min(stages - 1, bytes[12 + Math.min(60, Math.max(0, d - 4))]);
  const w = new Int16Array(n), lo = 76, hi = 76 + n;
  for (let i = 0; i < n; i++) {
    const v = ((bytes[lo + i] | (bytes[hi + i] << 8)) << 16) >> 16;
    w[i] = i >= 2 * PACKED_STAGE ? v + w[i - 2 * PACKED_STAGE] : v;
  }
  for (let i = 0; i < n; i++) w[i] *= q;
  return { w, stageOf, stages };
}

// Packs per-stage canonical weights (arrays of PACKED_STAGE numbers, in 1/128
// disc) with the stage of each ply 0..60. Returns the uncompressed bytes.
export function packWeights(stages, stageOfPly, q = 8) {
  const n = stages.length * PACKED_STAGE;
  const bytes = new Uint8Array(76 + 2 * n);
  const dv = new DataView(bytes.buffer);
  bytes.set([82, 86, 87, 50]);
  dv.setUint16(4, stages.length, true);
  dv.setUint16(6, NG, true);
  dv.setUint16(8, q, true);
  for (let p = 0; p <= 60; p++) bytes[12 + p] = stageOfPly[p];
  const qv = new Int16Array(n);
  stages.forEach((st, s) => { for (let k = 0; k < PACKED_STAGE; k++) qv[s * PACKED_STAGE + k] = Math.max(-4095, Math.min(4095, Math.round(st[k] / q))); });
  for (let i = 0; i < n; i++) {
    const v = i >= 2 * PACKED_STAGE ? qv[i] - qv[i - 2 * PACKED_STAGE] : qv[i];
    bytes[76 + i] = v & 255; bytes[76 + n + i] = (v >> 8) & 255;
  }
  return bytes;
}

// Browser: fetches and unpacks a gzipped weights file.
export async function fetchWeights(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load the evaluation (${res.status})`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return unpackWeights(new Uint8Array(buf));
}
