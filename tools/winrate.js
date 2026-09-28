// Fits the coach's win chance (coach.js winChance): plays games between
// mid-strength levels, reads each position like the coach does, and finds how
// the expected disc lead turns into wins at each stage of the game, as
// P(win) = 1 / (1 + exp(-score / spread)), spread = a + b * empties.
//   node tools/winrate.js [games] [level] [depth]
import { Board, BLACK, PASS } from '../src/board.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { LEVELS, chooseLevelMove } from '../src/levels.js';
import { loadWeights } from './weights-io.js';

const games = +(process.argv[2] || 200), level = LEVELS[+(process.argv[3] || 5)], depth = +(process.argv[4] || 6);
const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const player = new Engine(W, { ttBits: 18 }), reader = new Engine(W, { ttBits: 18 });
let s = 99;
const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

const samples = []; // [empties, score for side to move, 1 win / 0.5 draw / 0 loss for side to move]
for (let g = 0; g < games; g++) {
  const b = new Board(), seen = [];
  for (let k = 0; k < 4; k++) { const ms = b.legalMoves(); b.play(ms[(rand() * ms.length) | 0]); }
  while (!b.isOver) {
    const ms = b.legalMoves();
    if (!ms.length) { b.play(PASS); continue; }
    const pos = positionFromColors(b.color, b.toPlay);
    if (b.empties > 14 && rand() < 0.35) {
      const r = reader.run(pos, { depth, exact: 0, all: false });
      seen.push([b.empties, r.score, b.toPlay]);
    }
    b.play(chooseLevelMove(player, pos, level, rand));
  }
  const m = b.finalMargin();
  for (const [e, sc, c] of seen) {
    const mine = c === BLACK ? m : -m;
    samples.push([e, sc, mine > 0 ? 1 : mine < 0 ? 0 : 0.5]);
  }
}

// Maximum likelihood for (a, b) by a coarse grid search.
const nll = (a, b) => {
  let t = 0;
  for (const [e, sc, y] of samples) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-sc / (a + b * e)))));
    t -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  return t / samples.length;
};
let best = null;
for (let a = 0.5; a <= 12; a += 0.5) for (let b = 0; b <= 0.5; b += 0.02) {
  const v = nll(a, b);
  if (!best || v < best.v) best = { a, b, v };
}
console.log(`${samples.length} positions from ${games} games (${level.name}, read at depth ${depth})`);
console.log(`spread = ${best.a} + ${best.b.toFixed(2)} * empties   (log loss ${best.v.toFixed(4)}, vs ${nll(2, 0.2).toFixed(4)} for 2 + 0.2e)`);
// Calibration check by bucket.
for (const [lo, hi] of [[15, 25], [26, 40], [41, 56]]) {
  const sub = samples.filter(([e]) => e >= lo && e <= hi);
  const lead = sub.filter(([, sc]) => sc >= 4 && sc <= 8);
  const won = lead.reduce((t, [, , y]) => t + y, 0) / Math.max(1, lead.length);
  console.log(`empties ${lo}-${hi}: leads of 4 to 8 discs won ${(won * 100).toFixed(0)}% of ${lead.length}`);
}
