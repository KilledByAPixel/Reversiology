// Converts Edax's evaluation weights (eval.dat, GPL-3.0, from
// https://github.com/abulmo/edax-reversi) into Reversiology's weights file.
// Edax uses the same 46 pattern features; this maps its square colours
// (0 player, 1 opponent, 2 empty) and packing onto ours.
//   node tools/convert-edax.js eval.dat weights/eval.bin.gz [pliesPerStage]
// Plies are grouped keeping their parity (who moves next matters): with 2
// per stage, plies p and p + 2 share one.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { NG, GROUP_SIZE, POW3 } from '../src/engine/patterns.js';
import { CANON, CANON_COUNT, PACKED_STAGE, packWeights } from '../src/engine/weights.js';

const [src, dst, perArg] = process.argv.slice(2);
const per = +(perArg || 1);
const buf = readFileSync(src);
const HEADER = 28, PLIES = 61;
const EDAX_PACKED = [10206, 29889, 29646, 29646, 3321, 3321, 3321, 3321, 1134, 378, 135, 45, 1];
const nW = EDAX_PACKED.reduce((a, b) => a + b, 0);
if (buf.length !== HEADER + PLIES * nW * 2) throw new Error(`unexpected eval.dat size ${buf.length}`);

// Edax's symmetry tables and packing (eval.c: player_feature, unpack).
const S10 = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], C10 = [9, 8, 7, 6, 4, 5, 3, 2, 1, 0], C9 = [0, 2, 1, 4, 3, 5, 7, 6, 8];
const SYM = [C9, C10, S10, S10, S10.slice(2), S10.slice(2), S10.slice(2), S10.slice(2), S10.slice(3), S10.slice(4), S10.slice(5), S10.slice(6)];
function edaxPack(n, sym) {
  const size = POW3[n], pack = new Int32Array(size);
  let k = 0;
  for (let i = 0; i < size; i++) {
    let j = 0;
    for (let t = 0; t < n; t++) j += (((i / POW3[sym[t]]) | 0) % 3) * POW3[t];
    pack[i] = j < i ? pack[j] : k++;
  }
  return pack;
}
const PACK = SYM.map((sym, g) => edaxPack(GROUP_SIZE[g], sym));

// Our index (digits 0 empty, 1 player, 2 opponent; first square most
// significant, as in Edax) → Edax's index (2 empty, 0 player, 1 opponent).
const OURS_TO_EDAX = [2, 0, 1];
function toEdax(i, n) {
  let e = 0;
  for (let k = n - 1; k >= 0; k--) { e += OURS_TO_EDAX[i % 3] * POW3[n - 1 - k]; i = (i / 3) | 0; }
  return e;
}

const plies = [];
for (let ply = 0; ply < PLIES; ply++) {
  const w = new Int16Array(nW);
  for (let k = 0; k < nW; k++) w[k] = buf.readInt16LE(HEADER + (ply * nW + k) * 2);
  const out = new Float64Array(PACKED_STAGE);
  const filled = new Int8Array(PACKED_STAGE);
  let off = 1, eoff = 0;
  for (let g = 0; g < NG; g++) {
    const n = GROUP_SIZE[g];
    for (let i = 0; i < POW3[n]; i++) {
      const slot = off + CANON[g][i], v = w[eoff + PACK[g][toEdax(i, n)]];
      if (filled[slot] && out[slot] !== v) throw new Error(`symmetry mismatch in group ${g} index ${i}`);
      out[slot] = v; filled[slot] = 1;
    }
    off += CANON_COUNT[g]; eoff += EDAX_PACKED[g];
  }
  out[0] = w[eoff]; // bias
  plies.push(out);
}

// Several plies per stage (same parity): average them.
const stageOfPly = [];
for (let p = 0; p < PLIES; p++) stageOfPly.push(Math.floor(p / (2 * per)) * 2 + (p & 1));
const nStages = Math.max(...stageOfPly) + 1;
const stages = [];
for (let s = 0; s < nStages; s++) {
  const group = plies.filter((_, p) => stageOfPly[p] === s);
  const avg = new Float64Array(PACKED_STAGE);
  for (const p of group) for (let k = 0; k < PACKED_STAGE; k++) avg[k] += p[k] / group.length;
  stages.push(avg);
}
const bytes = packWeights(stages, stageOfPly, 8);
const gz = gzipSync(bytes, { level: 9 });
writeFileSync(dst, gz);
console.log(`${stages.length} stages, ${bytes.length} bytes, gzipped ${gz.length}`);
