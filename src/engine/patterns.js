// The evaluation's pattern features: 46 lines and shapes of squares, in 13
// groups of symmetric copies (the classic layout used by Logistello and Edax).
// Each feature is read as a base-3 number over its squares (0 empty, 1 black,
// 2 white; first square most significant) and looks up a trained weight.
// Symmetric copies list their squares in corresponding order so they share weights.

const S = name => (+name[1] - 1) * 8 + (name.charCodeAt(0) - 97);
const F = str => str.split(' ').map(S);

export const FEATURES = [
  // corner 3x3
  F('a1 b1 a2 b2 c1 a3 c2 b3 c3'), F('h1 g1 h2 g2 f1 h3 f2 g3 f3'), F('a8 a7 b8 b7 a6 c8 b6 c7 c6'), F('h8 h7 g8 g7 h6 f8 g6 f7 f6'),
  // corner 2x5 (edge and the line inside it)
  F('a5 a4 a3 a2 a1 b2 b1 c1 d1 e1'), F('h5 h4 h3 h2 h1 g2 g1 f1 e1 d1'), F('a4 a5 a6 a7 a8 b7 b8 c8 d8 e8'), F('h4 h5 h6 h7 h8 g7 g8 f8 e8 d8'),
  // edge + 2 X-squares
  F('b2 a1 b1 c1 d1 e1 f1 g1 h1 g2'), F('b7 a8 b8 c8 d8 e8 f8 g8 h8 g7'), F('b2 a1 a2 a3 a4 a5 a6 a7 a8 b7'), F('g2 h1 h2 h3 h4 h5 h6 h7 h8 g7'),
  // edge "angle": corners plus the edge's inner squares and the four inside it
  F('a1 c1 d1 c2 d2 e2 f2 e1 f1 h1'), F('a8 c8 d8 c7 d7 e7 f7 e8 f8 h8'), F('a1 a3 a4 b3 b4 b5 b6 a5 a6 a8'), F('h1 h3 h4 g3 g4 g5 g6 h5 h6 h8'),
  // second rows
  F('a2 b2 c2 d2 e2 f2 g2 h2'), F('a7 b7 c7 d7 e7 f7 g7 h7'), F('b1 b2 b3 b4 b5 b6 b7 b8'), F('g1 g2 g3 g4 g5 g6 g7 g8'),
  // third rows
  F('a3 b3 c3 d3 e3 f3 g3 h3'), F('a6 b6 c6 d6 e6 f6 g6 h6'), F('c1 c2 c3 c4 c5 c6 c7 c8'), F('f1 f2 f3 f4 f5 f6 f7 f8'),
  // fourth rows
  F('a4 b4 c4 d4 e4 f4 g4 h4'), F('a5 b5 c5 d5 e5 f5 g5 h5'), F('d1 d2 d3 d4 d5 d6 d7 d8'), F('e1 e2 e3 e4 e5 e6 e7 e8'),
  // long diagonals
  F('a1 b2 c3 d4 e5 f6 g7 h8'), F('a8 b7 c6 d5 e4 f3 g2 h1'),
  // diagonals of 7, 6, 5 and 4
  F('b1 c2 d3 e4 f5 g6 h7'), F('h2 g3 f4 e5 d6 c7 b8'), F('a2 b3 c4 d5 e6 f7 g8'), F('g1 f2 e3 d4 c5 b6 a7'),
  F('c1 d2 e3 f4 g5 h6'), F('a3 b4 c5 d6 e7 f8'), F('f1 e2 d3 c4 b5 a6'), F('h3 g4 f5 e6 d7 c8'),
  F('d1 e2 f3 g4 h5'), F('a4 b5 c6 d7 e8'), F('e1 d2 c3 b4 a5'), F('h4 g5 f6 e7 d8'),
  F('d1 c2 b3 a4'), F('a5 b6 c7 d8'), F('e1 f2 g3 h4'), F('h5 g6 f7 e8'),
];
export const NF = FEATURES.length; // 46

// Which group each feature belongs to, and each group's first feature.
export const GROUP_OF = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7,
  8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11];
export const NG = 12;
export const GROUP_SIZE = []; // squares per feature in each group
for (let f = 0; f < NF; f++) GROUP_SIZE[GROUP_OF[f]] = FEATURES[f].length;
export const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683, 59049, 177147];
export const GROUP_LEN = GROUP_SIZE.map(n => POW3[n]); // weights per group
export const GROUP_OFFSET = [];
{ let o = 0; for (let g = 0; g < NG; g++) { GROUP_OFFSET[g] = o; o += GROUP_LEN[g]; } }
export const STAGE_SIZE = GROUP_OFFSET[NG - 1] + GROUP_LEN[NG - 1]; // weights per stage, before the bias

// For every square, the features it's in and its place value there:
// X2F[sq] is a flat list of [feature, power, feature, power, ...].
export const X2F = Array.from({ length: 64 }, () => []);
FEATURES.forEach((sqs, f) => sqs.forEach((s, k) => X2F[s].push(f, POW3[sqs.length - 1 - k])));
// Flattened for the search: X2F_START[sq] .. X2F_START[sq + 1] into X2F_FLAT.
export const X2F_START = new Int32Array(65);
export const X2F_FLAT = new Int32Array(X2F.reduce((n, l) => n + l.length, 0));
{ let o = 0; for (let s = 0; s < 64; s++) { X2F_START[s] = o; X2F_FLAT.set(X2F[s], o); o += X2F[s].length; } X2F_START[64] = o; }

// A feature's index with black and white swapped (for the side to move's view).
export const SWAP = GROUP_SIZE.map(n => {
  const t = new Int32Array(POW3[n]);
  for (let i = 0; i < POW3[n]; i++) {
    let v = i, r = 0;
    for (let k = 0; k < n; k++) { const d = v % 3; v = (v / 3) | 0; r += (d ? 3 - d : 0) * POW3[k]; }
    t[i] = r;
  }
  return t;
});

// Feature indices of a position given as colours (0/1/2) per square.
export function featureIndices(color, out = new Int32Array(NF)) {
  for (let f = 0; f < NF; f++) {
    let v = 0;
    for (const s of FEATURES[f]) v = v * 3 + color[s];
    out[f] = v;
  }
  return out;
}
