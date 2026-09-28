import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, BLACK, WHITE, EMPTY, PASS } from '../src/board.js';
import { R, mobility, flips, popcount } from '../src/engine/bits.js';
import { Engine, positionFromColors, positionFromString } from '../src/engine/engine.js';
import { Search } from '../src/engine/search.js';

let rs = 12345;
const rnd = n => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs % n; };

const bits = (b, c) => {
  let lo = 0, hi = 0;
  for (let s = 0; s < 64; s++) if (b.color[s] === c) { if (s < 32) lo |= 1 << s; else hi |= 1 << (s - 32); }
  return [lo, hi];
};
const list = (lo, hi) => { const o = []; for (let s = 0; s < 64; s++) if (s < 32 ? (lo >>> s) & 1 : (hi >>> (s - 32)) & 1) o.push(s); return o; };

test('bitboard moves and flips match the reference board over random games', () => {
  for (let g = 0; g < 300; g++) {
    const b = new Board();
    for (;;) {
      const c = b.toPlay, [pl, ph] = bits(b, c), [ol, oh] = bits(b, 3 - c);
      mobility(pl, ph, ol, oh);
      assert.deepEqual(list(R.lo, R.hi), b.legalMoves(), b.pretty());
      for (let s = 0; s < 64; s++) {
        if (b.color[s] !== EMPTY) continue;
        flips(s, pl, ph, ol, oh);
        assert.deepEqual(list(R.lo, R.hi), b.flips(s).sort((x, y) => x - y), `flips at ${s}\n${b.pretty()}`);
      }
      if (b.isOver) break;
      const ms = b.legalMoves();
      b.play(ms.length ? ms[rnd(ms.length)] : PASS);
    }
  }
});

function perft(b, depth, passed = false) {
  if (!depth) return 1;
  const ms = b.legalMoves();
  if (!ms.length) {
    if (passed) return 1;
    const t = b.clone(); t.play(PASS);
    return perft(t, depth - 1, true);
  }
  let n = 0;
  for (const m of ms) { const t = b.clone(); t.play(m); n += perft(t, depth - 1); }
  return n;
}

test('perft from the start matches the known counts', () => {
  const b = new Board();
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(d => perft(b, d)), [4, 12, 56, 244, 1396, 8200, 55092]);
});

// Naive exact solver on the reference board.
function naiveSolve(b, passed = false) {
  const ms = b.legalMoves();
  const me = b.toPlay;
  if (!ms.length) {
    if (passed || b.isOver) { const m = b.finalMargin(); return me === BLACK ? m : -m; }
    const t = b.clone(); t.play(PASS);
    return -naiveSolve(t, true);
  }
  let best = -999;
  for (const m of ms) { const t = b.clone(); t.play(m); best = Math.max(best, -naiveSolve(t)); }
  return best;
}

test('endgame solver agrees with a naive solver on random positions', () => {
  const e = new Engine();
  for (let g = 0; g < 60; g++) {
    const b = new Board();
    const stop = 64 - (4 + (g % 8));
    while (b.count(EMPTY) > 64 - stop && !b.isOver) {
      const ms = b.legalMoves();
      b.play(ms.length ? ms[rnd(ms.length)] : PASS);
    }
    if (b.isOver || !b.legalMoves().length) continue;
    const r = e.run(positionFromColors(b.color, b.toPlay), { exact: 20, all: true });
    assert.equal(r.exact, true);
    assert.equal(r.score, naiveSolve(b) | 0, b.pretty());
    for (const m of r.moves) {
      const t = b.clone(); t.play(m.move);
      assert.equal(m.score, -naiveSolve(t) | 0, `move ${m.move}\n${b.pretty()}`);
    }
  }
});

test('best-move search agrees with scoring every move', async () => {
  const { loadWeights } = await import('../tools/weights-io.js');
  const w = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
  for (let g = 0; g < 40; g++) {
    const b = new Board();
    const plies = 6 + (g % 30);
    for (let k = 0; k < plies && !b.isOver; k++) { const ms = b.legalMoves(); b.play(ms.length ? ms[rnd(ms.length)] : PASS); }
    if (b.isOver || !b.legalMoves().length) continue;
    const pos = positionFromColors(b.color, b.toPlay);
    const all = new Engine(w).run(pos, { depth: 3, exact: 0, all: true });
    const best = new Engine(w).run(pos, { depth: 3, exact: 0, all: false });
    assert.equal(best.score, all.score);
    // The move it picks scores as well as the best (a bound may tie, but must not be picked).
    assert.equal(all.moves.find(m => m.move === best.moves[0].move).score, all.score, b.pretty());
  }
});
