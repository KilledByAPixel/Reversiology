// The search: alpha-beta (principal variation search) over bitboards, with a
// transposition table, iterative deepening, a pattern evaluation and an exact
// endgame solver. Scores are disc differences for the side to move (−64..64);
// a finished game's empty squares go to the winner.
//
// Everything runs synchronously on preallocated typed arrays; the worker
// (engine-worker.js) slices long searches into steps so it can be cancelled.
import { R, mobility, flips, neighbours, popcount, lowBit, NEIGH_LO, NEIGH_HI } from './bits.js';
import { NF, X2F_START, X2F_FLAT, FEATURES, GROUP_OF, GROUP_OFFSET } from './patterns.js';
import { CANON_OF, CANON_OF_SWAPPED, PACKED_STAGE } from './weights.js';

const INF = 127;
const MAX_PLY = 72;
export const BLACK = 1, WHITE = 2;

// Static move-ordering priority for the endgame's empty-square list: corners
// first, X-squares last (the classic Andersson ordering).
const SQUARE_ORDER = [
  0, 7, 56, 63, 2, 5, 16, 23, 40, 47, 58, 61, 3, 4, 24, 31, 32, 39, 59, 60,
  18, 21, 42, 45, 19, 20, 26, 29, 34, 37, 43, 44, 11, 12, 25, 30, 33, 38, 51, 52,
  10, 13, 17, 22, 41, 46, 50, 53, 1, 6, 8, 15, 48, 55, 57, 62, 9, 14, 49, 54,
  27, 28, 35, 36,
];
// Quadrant of each square, for the endgame's parity ordering.
const QUADRANT = new Uint8Array(64);
for (let s = 0; s < 64; s++) QUADRANT[s] = ((s >> 5) << 1) | ((s & 7) >> 2);
// Rough value of squares for move ordering in the midgame.
const SQUARE_VALUE = new Int8Array([
  18, -6, 8, 6, 6, 8, -6, 18,
  -6, -12, -2, -2, -2, -2, -12, -6,
  8, -2, 1, 0, 0, 1, -2, 8,
  6, -2, 0, 0, 0, 0, -2, 6,
  6, -2, 0, 0, 0, 0, -2, 6,
  8, -2, 1, 0, 0, 1, -2, 8,
  -6, -12, -2, -2, -2, -2, -12, -6,
  18, -6, 8, 6, 6, 8, -6, 18,
]);

// ProbCut (Buro's multi-ProbCut as Edax does it): a shallow search predicts
// the deep one, within an error that grows with the depths and the empties.
// These error parameters are Edax's, fitted for the same evaluation.
const PC_A = -0.10026799, PC_B = 0.31027733, PC_C = -0.57772603, PC_a = 0.07585621, PC_b = 1.16492647, PC_c = 5.4171698;
function evalSigma(empties, depth, pcDepth) {
  const s = PC_A * empties + PC_B * depth + PC_C * pcDepth;
  return PC_a * s * s + PC_b * s + PC_c;
}

// Final score with empties to the winner.
function finalScore(pl, ph, ol, oh) {
  const p = popcount(pl) + popcount(ph), o = popcount(ol) + popcount(oh), e = 64 - p - o;
  return p > o ? p - o + e : p < o ? p - o - e : 0;
}

export class Search {
  // weights: { w, stageOf } from engine/weights.js (packed, in 1/128 disc,
  // from the side to move's view). null: a simple built-in evaluation
  // (mobility and square values) stands in.
  constructor(weights = null, { ttBits = 18 } = {}) {
    this.weights = weights ? weights.w : null;
    this.stageOf = weights ? weights.stageOf : null;
    this.feat = new Int32Array(MAX_PLY * NF);
    this.moves = new Int8Array(MAX_PLY * 32);
    this.order = new Int32Array(MAX_PLY * 32);
    this.ttMask = (1 << ttBits) - 1;
    this.tt = new Int32Array((1 << ttBits) * 6);
    this.nodes = 0;
    this.deadline = Infinity;
    this.aborted = false;
    this.checkEvery = 0;
    // Endgame empty-square list (doubly linked, in SQUARE_ORDER).
    this.next = new Int8Array(66);
    this.prev = new Int8Array(66);
    this.parity = 0;
    this.smallBuf = new Int8Array(8 * 8);
    this.foff = new Int32Array(NF);
    for (let f = 0; f < NF; f++) this.foff[f] = GROUP_OFFSET[GROUP_OF[f]];
  }

  clearTT() { this.tt.fill(0); }

  // ------------------------------------------------------------ evaluation

  // Feature indices for the root position (absolute colours: 1 black, 2 white).
  setRoot(bl, bh, wl, wh) {
    const f = this.feat;
    for (let i = 0; i < NF; i++) {
      let v = 0;
      for (const s of FEATURES[i]) {
        const b = s < 32 ? (bl >>> s) & 1 : (bh >>> (s - 32)) & 1;
        const w = s < 32 ? (wl >>> s) & 1 : (wh >>> (s - 32)) & 1;
        v = v * 3 + (b ? 1 : w ? 2 : 0);
      }
      f[i] = v;
    }
  }

  // Child features at ply + 1: `color` played sq and flipped (fl, fh).
  updateFeatures(ply, color, sq, fl, fh) {
    const f = this.feat, src = ply * NF, dst = src + NF;
    for (let i = 0; i < NF; i++) f[dst + i] = f[src + i];
    const place = color, flip = color === BLACK ? -1 : 1; // white (2) → black (1) is −1 per place value
    for (let k = X2F_START[sq], e = X2F_START[sq + 1]; k < e; k += 2) f[dst + X2F_FLAT[k]] += place * X2F_FLAT[k + 1];
    while (fl) {
      const s = lowBit(fl); fl &= fl - 1;
      for (let k = X2F_START[s], e = X2F_START[s + 1]; k < e; k += 2) f[dst + X2F_FLAT[k]] += flip * X2F_FLAT[k + 1];
    }
    while (fh) {
      const s = lowBit(fh) + 32; fh &= fh - 1;
      for (let k = X2F_START[s], e = X2F_START[s + 1]; k < e; k += 2) f[dst + X2F_FLAT[k]] += flip * X2F_FLAT[k + 1];
    }
  }

  // Evaluation for the side to move (`color`), in discs (fractional).
  evaluate(ply, color, pl, ph, ol, oh) {
    const w = this.weights;
    if (!w) return this.simpleEval(pl, ph, ol, oh);
    const discs = popcount(pl) + popcount(ph) + popcount(ol) + popcount(oh);
    const base = this.stageOf[discs] * PACKED_STAGE;
    let sum = w[base];
    const f = this.feat, fb = ply * NF, foff = this.foff;
    const canon = color === BLACK ? CANON_OF : CANON_OF_SWAPPED;
    for (let i = 0; i < NF; i++) sum += w[base + canon[foff[i] + f[fb + i]]];
    return sum / 128;
  }

  // Stand-in evaluation before trained weights exist: mobility, corners and
  // square values. Roughly in discs.
  simpleEval(pl, ph, ol, oh) {
    mobility(pl, ph, ol, oh);
    const mp = popcount(R.lo) + popcount(R.hi);
    mobility(ol, oh, pl, ph);
    const mo = popcount(R.lo) + popcount(R.hi);
    let sq = 0;
    for (let s = 0; s < 64; s++) {
      const b = s < 32 ? 1 << s : 1 << (s - 32);
      if (s < 32) { if (pl & b) sq += SQUARE_VALUE[s]; else if (ol & b) sq -= SQUARE_VALUE[s]; }
      else { if (ph & b) sq += SQUARE_VALUE[s]; else if (oh & b) sq -= SQUARE_VALUE[s]; }
    }
    return (mp - mo) * 1.5 + sq * 0.5;
  }

  // Integer evaluation in discs, clamped inside the win/loss range.
  evalInt(ply, color, pl, ph, ol, oh) {
    const v = Math.round(this.evaluate(ply, color, pl, ph, ol, oh));
    return v > 64 ? 64 : v < -64 ? -64 : v;
  }

  // ------------------------------------------------------------ transposition table
  // Entry (6 ints): pl, ph, ol, oh, packed (lower+64 | upper+64 << 8 | depth << 16 | move+1 << 24), unused.

  ttIndex(pl, ph, ol, oh) {
    let h = Math.imul(pl ^ Math.imul(ph, 0x2545f491), 0x9e3779b1) ^ Math.imul(ol ^ Math.imul(oh, 0x6c8e9cf5), 0x85ebca77);
    h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae3d); h ^= h >>> 13;
    return (h & this.ttMask) * 6;
  }

  ttProbe(pl, ph, ol, oh) {
    const t = this.tt, i = this.ttIndex(pl, ph, ol, oh);
    if (t[i] === pl && t[i + 1] === ph && t[i + 2] === ol && t[i + 3] === oh && t[i + 4] !== 0) return t[i + 4];
    return 0;
  }

  // depth 99 = exact (solved) value.
  ttStore(pl, ph, ol, oh, depth, alpha, beta, score, move) {
    const t = this.tt, i = this.ttIndex(pl, ph, ol, oh);
    const same = t[i] === pl && t[i + 1] === ph && t[i + 2] === ol && t[i + 3] === oh && t[i + 4] !== 0;
    let lo = -64, hi = 64;
    if (same) {
      const old = t[i + 4], od = (old >>> 16) & 0xff;
      if (od > depth) return;
      if (od === depth) { lo = (old & 0xff) - 64; hi = ((old >>> 8) & 0xff) - 64; }
      if (move < 0) move = ((old >>> 24) & 0xff) - 1;
    } else if (t[i + 4] !== 0 && ((t[i + 4] >>> 16) & 0xff) > depth + 2 && t[i + 5] === this.age) return;
    if (score < beta && score < hi) hi = score;
    if (score > alpha && score > lo) lo = score;
    if (lo > hi) { lo = score; hi = score; }
    t[i] = pl; t[i + 1] = ph; t[i + 2] = ol; t[i + 3] = oh;
    t[i + 4] = (lo + 64) | ((hi + 64) << 8) | (depth << 16) | ((move + 1) << 24);
    t[i + 5] = this.age;
  }

  // ------------------------------------------------------------ time

  tick() {
    if (++this.checkEvery >= 2048) {
      this.checkEvery = 0;
      if (Date.now() > this.deadline) this.aborted = true;
    }
  }

  // ------------------------------------------------------------ midgame search

  // Principal variation search to `depth` plies; switches to the exact solver
  // once the depth reaches the end of the game.
  pvs(pl, ph, ol, oh, color, depth, alpha, beta, ply, passed) {
    this.nodes++;
    this.tick();
    if (this.aborted) return 0;
    const empties = 64 - popcount(pl) - popcount(ph) - popcount(ol) - popcount(oh);
    // Reading to the end of the game: solve it exactly instead.
    if (depth >= empties) return this.solveRoot(pl, ph, ol, oh, alpha, beta, empties, ply);
    // A side with no discs left: the game is over, whatever the depth.
    if (!((pl | ph) && (ol | oh))) return finalScore(pl, ph, ol, oh);
    if (depth <= 0) return this.evalInt(ply, color, pl, ph, ol, oh);
    if (depth === 1) return this.search1(pl, ph, ol, oh, color, alpha, beta, ply, passed);

    mobility(pl, ph, ol, oh);
    let ml = R.lo, mh = R.hi;
    if (!(ml | mh)) {
      if (passed) return finalScore(pl, ph, ol, oh);
      return -this.pvs(ol, oh, pl, ph, 3 - color, depth, -beta, -alpha, ply, true);
    }

    // Transposition table.
    let ttMove = -1;
    const e = this.ttProbe(pl, ph, ol, oh);
    if (e) {
      const d = (e >>> 16) & 0xff;
      ttMove = ((e >>> 24) & 0xff) - 1;
      if (d >= depth) {
        const lo = (e & 0xff) - 64, hi = ((e >>> 8) & 0xff) - 64;
        if (lo >= beta) return lo;
        if (hi <= alpha) return hi;
        if (lo === hi) return lo;
        if (lo > alpha) alpha = lo;
        if (hi < beta) beta = hi;
      }
    }

    // ProbCut, at null-window nodes: a shallow search far outside the window
    // decides without the deep one.
    if (this.pcT && beta === alpha + 1 && depth >= 4 && this.pcLevel < 2 && this.weights) {
      const t = this.pcT, pd = 2 * Math.floor(depth / 4) + (depth & 1);
      const err = Math.floor(t * evalSigma(empties, depth, pd) + 0.5);
      const ev = this.evalInt(ply, color, pl, ph, ol, oh);
      const evErr = Math.floor(t * 0.5 * (evalSigma(empties, depth, 0) + evalSigma(empties, depth, pd)) + 0.5);
      if (ev >= beta - evErr && beta + err < 64) {
        this.pcLevel++;
        const v = this.pvs(pl, ph, ol, oh, color, pd, beta + err - 1, beta + err, ply, passed);
        this.pcLevel--;
        if (this.aborted) return 0;
        if (v >= beta + err) return beta;
      }
      if (ev < alpha + evErr && alpha - err > -64) {
        this.pcLevel++;
        const v = this.pvs(pl, ph, ol, oh, color, pd, alpha - err, alpha - err + 1, ply, passed);
        this.pcLevel--;
        if (this.aborted) return 0;
        if (v <= alpha - err) return alpha;
      }
    }

    const n = this.orderMoves(pl, ph, ol, oh, ml, mh, color, depth, ply, ttMove);
    const base = ply * 32;
    let best = -INF, bestMove = -1;
    const a0 = alpha;
    for (let i = 0; i < n; i++) {
      const sq = this.moves[base + i];
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      const nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      const xl = ol & ~fl, xh = oh & ~fh;
      if (this.weights) this.updateFeatures(ply, color, sq, fl, fh);
      let v;
      if (i === 0) v = -this.pvs(xl, xh, nl, nh, 3 - color, depth - 1, -beta, -alpha, ply + 1, false);
      else {
        v = -this.pvs(xl, xh, nl, nh, 3 - color, depth - 1, -alpha - 1, -alpha, ply + 1, false);
        if (v > alpha && v < beta) v = -this.pvs(xl, xh, nl, nh, 3 - color, depth - 1, -beta, -alpha, ply + 1, false);
      }
      if (this.aborted) return 0;
      if (v > best) {
        best = v; bestMove = sq;
        if (v > alpha) { alpha = v; if (v >= beta) break; }
      }
    }
    this.ttStore(pl, ph, ol, oh, depth, a0, beta, best, bestMove);
    return best;
  }

  // One ply: every move's evaluation, best first to beat beta. No table and
  // no ordering, which cost more than they save this close to the leaves.
  search1(pl, ph, ol, oh, color, alpha, beta, ply, passed) {
    mobility(pl, ph, ol, oh);
    let ml = R.lo, mh = R.hi;
    if (!(ml | mh)) {
      if (passed) return finalScore(pl, ph, ol, oh);
      this.nodes++;
      return -this.search1(ol, oh, pl, ph, 3 - color, -beta, -alpha, ply, true);
    }
    let best = -INF;
    while (ml | mh) {
      let sq;
      if (ml) { sq = lowBit(ml); ml &= ml - 1; } else { sq = lowBit(mh) + 32; mh &= mh - 1; }
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      if (this.weights) this.updateFeatures(ply, color, sq, fl, fh);
      this.nodes++;
      const xl = ol & ~fl, xh = oh & ~fh, nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      // Wiping out the opponent ends the game: the final score, not an evaluation.
      const v = xl | xh ? -this.evalInt(ply + 1, 3 - color, xl, xh, nl, nh) : finalScore(nl, nh, 0, 0);
      if (v > best) { best = v; if (v >= beta) break; }
    }
    return best;
  }

  // Fills this.moves[ply * 32 ...] with the legal moves (ml, mh), best-looking
  // first. Returns how many.
  orderMoves(pl, ph, ol, oh, ml, mh, color, depth, ply, ttMove) {
    const base = ply * 32, mv = this.moves, sc = this.order;
    let n = 0;
    while (ml) { const s = lowBit(ml); ml &= ml - 1; mv[base + n++] = s; }
    while (mh) { const s = lowBit(mh) + 32; mh &= mh - 1; mv[base + n++] = s; }
    if (n === 1) return 1;
    for (let i = 0; i < n; i++) {
      const sq = mv[base + i];
      if (sq === ttMove) { sc[base + i] = 1 << 30; continue; }
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      const nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      const xl = ol & ~fl, xh = oh & ~fh;
      // Opponent's mobility after the move (fewer is better), plus square value.
      mobility(xl, xh, nl, nh);
      const om = popcount(R.lo) + popcount(R.hi);
      let s = SQUARE_VALUE[sq] * 16 - om * 64;
      if (depth >= 3 && this.weights) {
        this.updateFeatures(ply, color, sq, fl, fh);
        const v = depth >= 6
          ? -this.pvs(xl, xh, nl, nh, 3 - color, depth >= 10 ? 2 : 1, -INF, INF, ply + 1, false)
          : -this.evaluate(ply + 1, 3 - color, xl, xh, nl, nh);
        s += v * 256;
      }
      sc[base + i] = s;
    }
    // Insertion sort, descending.
    for (let i = 1; i < n; i++) {
      const m = mv[base + i], s = sc[base + i];
      let j = i - 1;
      while (j >= 0 && sc[base + j] < s) { mv[base + j + 1] = mv[base + j]; sc[base + j + 1] = sc[base + j]; j--; }
      mv[base + j + 1] = m; sc[base + j + 1] = s;
    }
    return n;
  }

  // ------------------------------------------------------------ endgame solver

  // Exact score. Sets up the empty-square list, then solves.
  solveRoot(pl, ph, ol, oh, alpha, beta, empties, ply) {
    const occ_l = pl | ol, occ_h = ph | oh;
    let prev = 64;
    this.parity = 0;
    for (const s of SQUARE_ORDER) {
      const occupied = s < 32 ? (occ_l >>> s) & 1 : (occ_h >>> (s - 32)) & 1;
      if (occupied) continue;
      this.next[prev] = s; this.prev[s] = prev; prev = s;
      this.parity ^= 1 << QUADRANT[s];
    }
    this.next[prev] = 65; this.prev[65] = prev;
    return this.solve(pl, ph, ol, oh, alpha, beta, empties, false);
  }

  solve(pl, ph, ol, oh, alpha, beta, empties, passed) {
    if (empties <= 6) return this.solveSmall(pl, ph, ol, oh, alpha, beta, empties, passed);
    this.nodes++;
    this.tick();
    if (this.aborted) return 0;
    mobility(pl, ph, ol, oh);
    let ml = R.lo, mh = R.hi;
    if (!(ml | mh)) {
      if (passed) return finalScore(pl, ph, ol, oh);
      return -this.solve(ol, oh, pl, ph, -beta, -alpha, empties, true);
    }
    let ttMove = -1;
    const useTT = empties >= 8;
    if (useTT) {
      const e = this.ttProbe(pl, ph, ol, oh);
      if (e) {
        ttMove = ((e >>> 24) & 0xff) - 1;
        if (((e >>> 16) & 0xff) === 99) {
          const lo = (e & 0xff) - 64, hi = ((e >>> 8) & 0xff) - 64;
          if (lo >= beta) return lo;
          if (hi <= alpha) return hi;
          if (lo === hi) return lo;
          if (lo > alpha) alpha = lo;
          if (hi < beta) beta = hi;
        }
      }
    }
    // Fastest first: moves that leave the opponent fewest replies (and fewest
    // places to get replies soon).
    const ply = 64 - empties, base = ply * 32, mv = this.moves, sc = this.order;
    let n = 0;
    while (ml) { const s = lowBit(ml); ml &= ml - 1; mv[base + n++] = s; }
    while (mh) { const s = lowBit(mh) + 32; mh &= mh - 1; mv[base + n++] = s; }
    for (let i = 0; i < n; i++) {
      const sq = mv[base + i];
      if (sq === ttMove) { sc[base + i] = 1 << 30; continue; }
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      const nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      mobility(ol & ~fl, oh & ~fh, nl, nh);
      let om = popcount(R.lo) + popcount(R.hi);
      // Opponent corners count double.
      om += popcount(R.lo & 0x81) + popcount(R.hi & 0x81000000);
      // Empty squares next to the mover's discs: where the opponent may soon play.
      neighbours(nl, nh);
      const pm = popcount(R.lo & ~(nl | ol)) + popcount(R.hi & ~(nh | oh));
      sc[base + i] = -om * 32 - pm * 2 + SQUARE_VALUE[sq] + ((this.parity >> QUADRANT[sq]) & 1) * 8;
    }
    for (let i = 1; i < n; i++) {
      const m = mv[base + i], s = sc[base + i];
      let j = i - 1;
      while (j >= 0 && sc[base + j] < s) { mv[base + j + 1] = mv[base + j]; sc[base + j + 1] = sc[base + j]; j--; }
      mv[base + j + 1] = m; sc[base + j + 1] = s;
    }
    const a0 = alpha;
    let best = -INF, bestMove = -1;
    for (let i = 0; i < n; i++) {
      const sq = mv[base + i];
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      const nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      const xl = ol & ~fl, xh = oh & ~fh;
      this.unlink(sq);
      let v;
      if (i === 0) v = -this.solve(xl, xh, nl, nh, -beta, -alpha, empties - 1, false);
      else {
        v = -this.solve(xl, xh, nl, nh, -alpha - 1, -alpha, empties - 1, false);
        if (v > alpha && v < beta) v = -this.solve(xl, xh, nl, nh, -beta, -alpha, empties - 1, false);
      }
      this.relink(sq);
      if (this.aborted) return 0;
      if (v > best) {
        best = v; bestMove = sq;
        if (v > alpha) { alpha = v; if (v >= beta) break; }
      }
    }
    if (useTT) this.ttStore(pl, ph, ol, oh, 99, a0, beta, best, bestMove);
    return best;
  }

  unlink(sq) {
    const p = this.prev[sq], n = this.next[sq];
    this.next[p] = n; this.prev[n] = p;
    this.parity ^= 1 << QUADRANT[sq];
  }
  relink(sq) {
    const p = this.prev[sq], n = this.next[sq];
    this.next[p] = sq; this.prev[n] = sq;
    this.parity ^= 1 << QUADRANT[sq];
  }

  // Few empties: try the empty squares directly (odd quadrants first), no
  // move generation or table. The last two are handled on their own.
  solveSmall(pl, ph, ol, oh, alpha, beta, empties, passed) {
    this.nodes++;
    if (empties === 2) { const a = this.next[64]; return this.solve2(pl, ph, ol, oh, alpha, beta, a, this.next[a], passed); }
    if (empties === 1) return this.solveLast(pl, ph, ol, oh, this.next[64]);
    if (empties === 0) return finalScore(pl, ph, ol, oh);
    // Move order, once: squares in odd quadrants first.
    const buf = this.smallBuf, base = empties * 8, par = this.parity;
    let n = 0;
    for (let sq = this.next[64]; sq !== 65; sq = this.next[sq]) if ((par >> QUADRANT[sq]) & 1) buf[base + n++] = sq;
    for (let sq = this.next[64]; sq !== 65; sq = this.next[sq]) if (!((par >> QUADRANT[sq]) & 1)) buf[base + n++] = sq;
    let best = -INF, moved = false;
    for (let i = 0; i < n; i++) {
      const sq = buf[base + i];
      // Must touch an opponent disc to flip anything.
      if (!((NEIGH_LO[sq] & ol) | (NEIGH_HI[sq] & oh))) continue;
      flips(sq, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      if (!(fl | fh)) continue;
      moved = true;
      const nl = pl | fl | (sq < 32 ? 1 << sq : 0), nh = ph | fh | (sq >= 32 ? 1 << (sq - 32) : 0);
      this.unlink(sq);
      const v = -this.solveSmall(ol & ~fl, oh & ~fh, nl, nh, -beta, -alpha, empties - 1, false);
      this.relink(sq);
      if (v > best) {
        best = v;
        if (v > alpha) { alpha = v; if (v >= beta) return v; }
      }
    }
    if (moved) return best;
    if (passed) return finalScore(pl, ph, ol, oh);
    return -this.solveSmall(ol, oh, pl, ph, -beta, -alpha, empties, true);
  }

  // Two empty squares, a and b.
  solve2(pl, ph, ol, oh, alpha, beta, a, b, passed) {
    this.nodes++;
    let best = -INF, moved = false;
    if ((NEIGH_LO[a] & ol) | (NEIGH_HI[a] & oh)) {
      flips(a, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      if (fl | fh) {
        moved = true;
        best = -this.solveLast(ol & ~fl, oh & ~fh, pl | fl | (a < 32 ? 1 << a : 0), ph | fh | (a >= 32 ? 1 << (a - 32) : 0), b);
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }
    }
    if ((NEIGH_LO[b] & ol) | (NEIGH_HI[b] & oh)) {
      flips(b, pl, ph, ol, oh);
      const fl = R.lo, fh = R.hi;
      if (fl | fh) {
        moved = true;
        const v = -this.solveLast(ol & ~fl, oh & ~fh, pl | fl | (b < 32 ? 1 << b : 0), ph | fh | (b >= 32 ? 1 << (b - 32) : 0), a);
        if (v > best) best = v;
      }
    }
    if (moved) return best;
    if (passed) return finalScore(pl, ph, ol, oh);
    return -this.solve2(ol, oh, pl, ph, -beta, -alpha, a, b, true);
  }

  // One empty square left, sq.
  solveLast(pl, ph, ol, oh, sq) {
    const p = popcount(pl) + popcount(ph), o = popcount(ol) + popcount(oh);
    flips(sq, pl, ph, ol, oh);
    let f = popcount(R.lo) + popcount(R.hi);
    if (f) return p - o + 1 + 2 * f;
    flips(sq, ol, oh, pl, ph);
    f = popcount(R.lo) + popcount(R.hi);
    if (f) return p - o - 1 - 2 * f;
    return p > o ? p - o + 1 : p - o - 1;
  }

  // ------------------------------------------------------------ principal variation

  // The expected continuation, following best moves stored in the table.
  pv(pl, ph, ol, oh, max = 12) {
    const out = [];
    for (let k = 0; k < max; k++) {
      mobility(pl, ph, ol, oh);
      if (!(R.lo | R.hi)) {
        mobility(ol, oh, pl, ph);
        if (!(R.lo | R.hi)) break;
        out.push(-1);
        [pl, ph, ol, oh] = [ol, oh, pl, ph];
        continue;
      }
      const e = this.ttProbe(pl, ph, ol, oh);
      const m = e ? ((e >>> 24) & 0xff) - 1 : -1;
      if (m < 0) break;
      flips(m, pl, ph, ol, oh);
      if (!(R.lo | R.hi)) break;
      out.push(m);
      const nl = pl | R.lo | (m < 32 ? 1 << m : 0), nh = ph | R.hi | (m >= 32 ? 1 << (m - 32) : 0);
      [pl, ph, ol, oh] = [ol & ~R.lo, oh & ~R.hi, nl, nh];
    }
    return out;
  }
}

Search.prototype.age = 1;
Search.prototype.pcT = 0;      // ProbCut confidence (0: off): 1.1 prunes most, 2.6 rarely errs
Search.prototype.pcLevel = 0;
export { finalScore, INF };
