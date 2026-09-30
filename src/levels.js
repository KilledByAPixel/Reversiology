// AI strength levels. Every level plays with the same engine; weaker ones read
// fewer moves ahead, choose among their options more loosely (`temp`, in
// discs: moves that many discs worse are e times less likely), and now and
// then (`miss`) make a typical beginner's move instead: grabbing the most
// discs, or any move at all. Calibrated in self-play and against Edax
// (tools/levels.js, tools/edax-match.js).
import { Board, BLACK, WHITE, PASS } from './board.js';

export const LEVELS = [
  { name: 'Pebble', blurb: 'Just learned the rules. Grabs discs wherever it can.', depth: 1, exact: 0, temp: 8, miss: 0.6 },
  { name: 'Seedling', blurb: 'Plays sensible-looking moves, but misses a lot.', depth: 1, exact: 4, temp: 5, miss: 0.35 },
  { name: 'Sprout', blurb: 'Knows corners matter. Still gives some away.', depth: 2, exact: 6, temp: 3, miss: 0.18 },
  { name: 'Reed', blurb: 'Plays mostly safe moves, but loosely.', depth: 2, exact: 8, temp: 2.5, miss: 0.12 },
  { name: 'Stream', blurb: 'Good instincts. Punishes obvious mistakes.', depth: 2, exact: 8, temp: 1.6, miss: 0.06 },
  { name: 'River', blurb: 'Reads a few moves ahead and plays the endgame well.', depth: 3, exact: 10, temp: 1, miss: 0.03 },
  { name: 'Mountain', blurb: 'Strong. Plays the last 12 moves perfectly.', depth: 4, exact: 12, temp: 0.5, miss: 0 },
  { name: 'Dragon', blurb: 'Very strong, and still quick. Plays the last 14 moves perfectly.', depth: 6, exact: 14, temp: 0, miss: 0, probcut: 1.5 },
  { name: 'Phoenix', blurb: 'Extra hard: reads 22 moves ahead and plays the last 22 perfectly.', depth: 22, exact: 22, temp: 0, miss: 0, probcut: 1.5, maxTime: 10000 },
];

// The level ladder: after a game against the AI, one level up for a win
// (outcome 1), one down for a loss (-1), none for a draw (0). step says what
// happened: 'up', 'down', 'same', or 'top' / 'bottom' when the ladder has no
// further to go.
export function nextLevel(level, outcome) {
  if (outcome > 0) return level < LEVELS.length - 1 ? { level: level + 1, step: 'up' } : { level, step: 'top' };
  if (outcome < 0) return level > 0 ? { level: level - 1, step: 'down' } : { level, step: 'bottom' };
  return { level, step: 'same' };
}

// The engine options for a level's move.
export const levelSearch = level => ({
  depth: level.depth, exact: level.exact, all: level.temp > 0, probcut: level.probcut || 0,
  maxTime: level.maxTime || 15000, minDepth: Math.min(level.depth, 4),
});

// A beginner's move: the one flipping the most discs (ties at random), or
// half the time any legal move.
export function beginnerMove(board, rand = Math.random) {
  const ms = board.legalMoves();
  if (!ms.length) return PASS;
  if (rand() < 0.5) return ms[(rand() * ms.length) | 0];
  let best = -1, pool = [];
  for (const m of ms) {
    const n = board.flips(m).length;
    if (n > best) { best = n; pool = [m]; } else if (n === best) pool.push(m);
  }
  return pool[(rand() * pool.length) | 0];
}

// Picks a level's move from the engine's results (or a beginner's move).
// `board` is the position (a Board), results from Engine.analyze with levelSearch(level).
export function pickLevelMove(results, level, board, rand = Math.random) {
  if (level.miss && rand() < level.miss) return beginnerMove(board, rand);
  const ms = results.moves || [];
  if (!ms.length) return PASS;
  if (!level.temp) return ms[0].move;
  const best = ms[0].score;
  const pool = ms.filter(m => m.score >= best - level.temp * 6);
  const w = pool.map(m => Math.exp((m.score - best) / level.temp));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i].move;
  return pool[0].move;
}

// Node tools: search and pick in one go. pos from positionFromColors.
export function chooseLevelMove(engine, pos, level, rand = Math.random) {
  const board = new Board();
  for (let s = 0; s < 64; s++) {
    const b = s < 32 ? (pos.bl >>> s) & 1 : (pos.bh >>> (s - 32)) & 1;
    const w = s < 32 ? (pos.wl >>> s) & 1 : (pos.wh >>> (s - 32)) & 1;
    board.color[s] = b ? BLACK : w ? WHITE : 0;
  }
  board.toPlay = pos.toPlay;
  if (level.miss && rand() < level.miss) return beginnerMove(board, rand);
  const r = engine.run(pos, levelSearch(level));
  return pickLevelMove(r, { ...level, miss: 0 }, board, rand);
}
