// Generates puzzles: positions from games between mixed-strength levels where
// one move (or a few equal ones) is clearly best, checked by a deep read or an
// exact solve. Each gets a theme from the coach's facts about the answer, and
// a difficulty from how deep the engine must read to find it.
//   node tools/gen-puzzles.js <games> <seed> [min level] [min difficulty] > puzzles-part.json
// then node tools/gen-puzzles.js --merge part1.json part2.json ... > src/puzzles.js
import { readFileSync } from 'node:fs';
import { Board, BLACK, WHITE, PASS, CORNERS, SYMMETRIES, sqName } from '../src/board.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { LEVELS, chooseLevelMove, beginnerMove } from '../src/levels.js';
import { moveFacts, compareFacts } from '../src/explain.js';
import { loadWeights } from './weights-io.js';

if (process.argv[2] === '--merge') {
  const all = process.argv.slice(3).flatMap(f => JSON.parse(readFileSync(f, 'utf8')));
  // One per position, up to symmetry.
  const seen = new Set(), out = [];
  for (const p of all) {
    const b = Board.fromString(p.board);
    const keys = SYMMETRIES.map(m => { let k = ''; for (let i = 0; i < 64; i++) k += b.color[m.indexOf(i)]; return k; });
    if (keys.some(k => seen.has(k + p.side))) continue;
    keys.forEach(k => seen.add(k + p.side));
    out.push(p);
  }
  // A balanced set: per difficulty, spread over themes.
  const pick = [];
  for (const d of [1, 2, 3]) {
    const pool = out.filter(p => p.difficulty === d);
    const byTheme = new Map();
    for (const p of pool) { if (!byTheme.has(p.theme)) byTheme.set(p.theme, []); byTheme.get(p.theme).push(p); }
    const lists = [...byTheme.values()];
    let k = 0;
    while (pick.filter(p => p.difficulty === d).length < 60 && lists.some(l => l.length)) {
      const l = lists[k++ % lists.length];
      if (l.length) pick.push(l.shift());
    }
  }
  pick.sort((a, b) => a.difficulty - b.difficulty || b.empties - a.empties);
  console.log(`// Puzzles: positions where one move is clearly best, found by
// tools/gen-puzzles.js in games between the AI levels and checked by a deep
// read or an exact solve. [board, side to move, answers, theme, difficulty
// (1 easy, 2 medium, 3 hard), how much the answer gains over the next best
// move (discs), exact].
export const PUZZLES = [
${pick.map(p => `  ['${p.board}', '${p.side}', '${p.answers.join(' ')}', '${p.theme}', ${p.difficulty}, ${p.gap}, ${p.exact ? 1 : 0}],`).join('\n')}
];`);
  process.exit(0);
}

// Optional: the weakest level to play (0-8) and the least difficulty to keep.
const games = +(process.argv[2] || 20), seed0 = +(process.argv[3] || 1);
const minLevel = +(process.argv[4] || 1), minDifficulty = +(process.argv[5] || 1);
const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const player = new Engine(W, { ttBits: 18 }), judge = new Engine(W, { ttBits: 20 });
let s = seed0 * 2654435761 >>> 0 || 1;
const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

const out = [];
for (let g = 0; g < games; g++) {
  const b = new Board();
  const pickLevel = () => LEVELS[minLevel + ((rand() * (7 - minLevel)) | 0)];
  const lvA = pickLevel(), lvB = pickLevel();
  for (let k = 0; k < 2; k++) { const ms = b.legalMoves(); b.play(ms[(rand() * ms.length) | 0]); }
  while (!b.isOver) {
    const ms = b.legalMoves();
    if (!ms.length) { b.play(PASS); continue; }
    const pos = positionFromColors(b.color, b.toPlay);
    if (ms.length >= 3 && b.empties <= 50 && b.empties >= 6 && rand() < 0.3) {
      const p = judgePosition(b, pos);
      if (p && p.difficulty >= minDifficulty) out.push(p);
    }
    b.play(chooseLevelMove(player, pos, b.toPlay === BLACK ? lvA : lvB, rand));
  }
}
console.log(JSON.stringify(out));

function judgePosition(b, pos) {
  const exact = b.empties <= 16;
  const r = judge.run(pos, exact ? { depth: 10, exact: 16, all: true, probcut: 2 } : { depth: 12, exact: 0, all: true, probcut: 2, maxTime: 20000 });
  const ms = r.moves;
  if (ms.length < 3 || ms[0].bound) return null;
  const best = ms[0].score;
  const answers = ms.filter(m => m.score === best).map(m => m.move);
  const rest = ms.filter(m => m.score < best);
  if (!rest.length || answers.length > 2) return null;
  const gap = best - rest[0].score;
  // Exact: the answer wins (or draws) and nothing else does, or it gains a lot.
  // Midgame: a big gap, confirmed by a deeper read.
  let ok;
  if (exact) ok = (best >= 0 && rest[0].score < 0 && rest[0].score < best) || gap >= 8;
  else {
    ok = gap >= 10;
    if (ok) {
      const deep = judge.run(pos, { depth: 14, exact: 0, all: true, probcut: 2, maxTime: 30000 });
      const top = deep.moves[0].score, a2 = deep.moves.filter(m => m.score === top).map(m => m.move);
      const second = deep.moves.find(m => m.score < top);
      ok = a2.every(m => answers.includes(m)) && second && top - second.score >= 8;
    }
  }
  if (!ok) return null;
  // Difficulty: can a shallow read find it?
  const found = depth => {
    const q = judge.run(pos, { depth, exact: 0, all: true });
    return answers.includes(q.moves[0].move);
  };
  const difficulty = found(1) ? 1 : found(4) ? 2 : 3;
  // Theme, from what the answer does.
  const m = answers[0];
  const after = b.clone();
  const flipped = after.play(m);
  const facts = moveFacts({ before: b, after, move: m, mover: b.toPlay, flipped });
  const vs = compareFacts(b, rest[0].move, m, b.toPlay);
  const greedy = beginnerLike(b);
  let theme;
  if (facts.some(f => f.type === 'wipeout')) theme = 'wipeout';
  else if (facts.some(f => f.type === 'corner')) theme = 'corner';
  else if (facts.some(f => f.type === 'forcesPass')) theme = 'pass';
  else if (facts.some(f => f.type === 'blocksCorner')) theme = 'defend';
  else if (exact && facts.some(f => f.type === 'parity' && f.odd)) theme = 'parity';
  else if (exact) theme = 'endgame';
  else if (!answers.includes(greedy) && greedy != null) theme = 'quiet';
  else if (vs.some(f => f.why === 'mobility')) theme = 'mobility';
  else theme = 'best';
  return { board: b.toString(), side: b.toPlay === BLACK ? 'X' : 'O', answers: answers.map(sqName), theme, difficulty, gap, exact, empties: b.empties };
}

// The move flipping the most discs (what a beginner reaches for).
function beginnerLike(b) {
  let best = -1, move = null;
  for (const m of b.legalMoves()) { const n = b.flips(m).length; if (n > best) { best = n; move = m; } }
  return move;
}
