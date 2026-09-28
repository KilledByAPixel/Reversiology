// Bitboard primitives for the search. A board is two 64-bit sets (the side to
// move's discs P and the opponent's O), each held as two 32-bit halves because
// JavaScript has no fast 64-bit integers: lo holds squares 0–31 (rows 1–4),
// hi squares 32–63 (rows 5–8). Square = row * 8 + col, a1 = 0, h8 = 63.
// Functions that produce a 64-bit set leave it in the exported scratch pair
// (R.lo, R.hi) instead of allocating, so the search never makes garbage.

export const R = { lo: 0, hi: 0 };

export function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// Index of the lowest set bit of a non-zero 32-bit value.
export const lowBit = x => 31 - Math.clz32(x & -x);

export const bitLo = sq => sq < 32 ? 1 << sq : 0;
export const bitHi = sq => sq >= 32 ? 1 << (sq - 32) : 0;
export const has = (lo, hi, sq) => sq < 32 ? (lo >>> sq) & 1 : (hi >>> (sq - 32)) & 1;

const NOT_A = 0xfefefefe | 0, NOT_H = 0x7f7f7f7f;

// Legal moves for P against O, into R. Kogge–Stone style fills in the eight
// directions, done on the two halves with the carries between them.
export function mobility(pl, ph, ol, oh) {
  const el = ~(pl | ol), eh = ~(ph | oh);
  let ml = 0, mh = 0, tl, th, xl, xh;
  // Horizontal neighbours: only discs not on the edge columns can be flanked.
  const hl = ol & 0x7e7e7e7e, hh = oh & 0x7e7e7e7e;

  // East (+1)
  tl = (pl << 1) & hl; th = ((ph << 1) | (pl >>> 31)) & hh;
  for (let i = 0; i < 5; i++) { xl = (tl << 1) & hl; xh = ((th << 1) | (tl >>> 31)) & hh; tl |= xl; th |= xh; }
  ml |= (tl << 1) & el & NOT_A; mh |= ((th << 1) | (tl >>> 31)) & eh & NOT_A;
  // West (-1)
  tl = ((pl >>> 1) | (ph << 31)) & hl; th = (ph >>> 1) & hh;
  for (let i = 0; i < 5; i++) { xl = ((tl >>> 1) | (th << 31)) & hl; xh = (th >>> 1) & hh; tl |= xl; th |= xh; }
  ml |= ((tl >>> 1) | (th << 31)) & el & NOT_H; mh |= (th >>> 1) & eh & NOT_H;
  // South (+8)
  tl = (pl << 8) & ol; th = ((ph << 8) | (pl >>> 24)) & oh;
  for (let i = 0; i < 5; i++) { xl = (tl << 8) & ol; xh = ((th << 8) | (tl >>> 24)) & oh; tl |= xl; th |= xh; }
  ml |= (tl << 8) & el; mh |= ((th << 8) | (tl >>> 24)) & eh;
  // North (-8)
  tl = ((pl >>> 8) | (ph << 24)) & ol; th = (ph >>> 8) & oh;
  for (let i = 0; i < 5; i++) { xl = ((tl >>> 8) | (th << 24)) & ol; xh = (th >>> 8) & oh; tl |= xl; th |= xh; }
  ml |= ((tl >>> 8) | (th << 24)) & el; mh |= (th >>> 8) & eh;
  // South-east (+9)
  tl = (pl << 9) & hl; th = ((ph << 9) | (pl >>> 23)) & hh;
  for (let i = 0; i < 5; i++) { xl = (tl << 9) & hl; xh = ((th << 9) | (tl >>> 23)) & hh; tl |= xl; th |= xh; }
  ml |= (tl << 9) & el & NOT_A; mh |= ((th << 9) | (tl >>> 23)) & eh & NOT_A;
  // North-west (-9)
  tl = ((pl >>> 9) | (ph << 23)) & hl; th = (ph >>> 9) & hh;
  for (let i = 0; i < 5; i++) { xl = ((tl >>> 9) | (th << 23)) & hl; xh = (th >>> 9) & hh; tl |= xl; th |= xh; }
  ml |= ((tl >>> 9) | (th << 23)) & el & NOT_H; mh |= (th >>> 9) & eh & NOT_H;
  // South-west (+7)
  tl = (pl << 7) & hl; th = ((ph << 7) | (pl >>> 25)) & hh;
  for (let i = 0; i < 5; i++) { xl = (tl << 7) & hl; xh = ((th << 7) | (tl >>> 25)) & hh; tl |= xl; th |= xh; }
  ml |= (tl << 7) & el & NOT_H; mh |= ((th << 7) | (tl >>> 25)) & eh & NOT_H;
  // North-east (-7)
  tl = ((pl >>> 7) | (ph << 25)) & hl; th = (ph >>> 7) & hh;
  for (let i = 0; i < 5; i++) { xl = ((tl >>> 7) | (th << 25)) & hl; xh = (th >>> 7) & hh; tl |= xl; th |= xh; }
  ml |= ((tl >>> 7) | (th << 25)) & el & NOT_A; mh |= (th >>> 7) & eh & NOT_A;

  R.lo = ml; R.hi = mh;
}

// Squares along each of the eight rays from every square, nearest first:
// RAY[(sq * 8 + d) * 8 + k] for k < RAYLEN[sq * 8 + d].
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]];
export const RAY = new Int8Array(64 * 8 * 8);
export const RAYLEN = new Uint8Array(64 * 8);
for (let sq = 0; sq < 64; sq++) {
  for (let d = 0; d < 8; d++) {
    let x = sq & 7, y = sq >> 3, n = 0;
    for (;;) {
      x += DIRS[d][0]; y += DIRS[d][1];
      if (x < 0 || x > 7 || y < 0 || y > 7) break;
      RAY[(sq * 8 + d) * 8 + n++] = y * 8 + x;
    }
    RAYLEN[sq * 8 + d] = n;
  }
}

// Discs flipped when P plays sq, into R (both zero: not a legal move).
export function flips(sq, pl, ph, ol, oh) {
  let fl = 0, fh = 0;
  const base = sq * 8;
  for (let d = 0; d < 8; d++) {
    const n = RAYLEN[base + d];
    if (n < 2) continue;
    const r = (base + d) * 8;
    let tl = 0, th = 0;
    for (let k = 0; k < n; k++) {
      const s = RAY[r + k];
      if (s < 32) {
        const b = 1 << s;
        if (ol & b) { tl |= b; continue; }
        if ((pl & b) && k) { fl |= tl; fh |= th; }
      } else {
        const b = 1 << (s - 32);
        if (oh & b) { th |= b; continue; }
        if ((ph & b) && k) { fl |= tl; fh |= th; }
      }
      break;
    }
  }
  R.lo = fl; R.hi = fh;
}

// Squares next to each square (for frontier and potential mobility).
export const NEIGH_LO = new Int32Array(64), NEIGH_HI = new Int32Array(64);
for (let sq = 0; sq < 64; sq++) {
  for (const [dx, dy] of DIRS) {
    const x = (sq & 7) + dx, y = (sq >> 3) + dy;
    if (x < 0 || x > 7 || y < 0 || y > 7) continue;
    const s = y * 8 + x;
    if (s < 32) NEIGH_LO[sq] |= 1 << s; else NEIGH_HI[sq] |= 1 << (s - 32);
  }
}

// Squares by name: 'a1' .. 'h8' (and back).
export const sqName = sq => sq < 0 ? 'pass' : 'abcdefgh'[sq & 7] + ((sq >> 3) + 1);
export function parseSq(s) {
  const m = /^([a-h])([1-8])$/i.exec(String(s).trim());
  return m ? (+m[2] - 1) * 8 + (m[1].toLowerCase().charCodeAt(0) - 97) : -1;
}
