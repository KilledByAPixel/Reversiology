// Teaching logic that sits on top of the engine's reads: win chances, move
// grades, hints and the opening name. Pure functions, no DOM, testable in node.
import { Board, BLACK, WHITE, PASS, SYMMETRIES, sqName } from './board.js';
import { OPENINGS } from './openings.js';

const sign = c => c === BLACK ? 1 : -1;

// Chance that the side with an expected lead of `score` discs wins, given how
// much of the game is left. Exact reads are certain. In the midgame a lead
// counts for less the more squares are empty. tools/winrate.js fitted the
// spread to games between River-level players, noisy the way real games are.
export function winChance(score, empties, exact) {
  if (exact) return score > 0 ? 1 : score < 0 ? 0 : 0.5;
  // In the first moves (over 40 empty squares) a small lead means even less:
  // the bar stays near even until something real happens.
  const spread = 3 + empties * 0.32 + Math.max(0, empties - 40) * 0.4;
  return 1 / (1 + Math.exp(-score / spread));
}

// Adds whole-board views to an engine read: the best score from Black's side,
// the win chances, and each move's win chance.
export function annotate(an) {
  if (!an) return an;
  const s = sign(an.toPlay);
  if (an.over) {
    an.blackScore = an.score * s;
    an.winrate = winChance(an.score, 0, true);
  } else {
    an.blackScore = an.score * s;
    an.winrate = winChance(an.score, an.empties, an.exact);
    for (const m of an.moves) m.winrate = winChance(m.score, an.empties - 1, m.exact);
  }
  an.blackWinrate = an.toPlay === BLACK ? an.winrate : 1 - an.winrate;
  return an;
}

export const GRADES = {
  best: { label: 'Best move', color: '#2f9e61' },
  good: { label: 'Good', color: '#4f9fd6' },
  inaccuracy: { label: 'Inaccuracy', color: '#d9b43a' },
  mistake: { label: 'Mistake', color: '#e07b2c' },
  blunder: { label: 'Blunder', color: '#d2413a' },
};

// Losses in discs for each grade. A disc or two is within what a midgame
// read can tell apart; in an exact endgame every disc is real.
function classify(ptLoss, wrLoss, exact) {
  if (ptLoss <= 0) return 'best';
  let grade;
  if (exact) grade = ptLoss <= 2 ? 'good' : ptLoss <= 4 ? 'inaccuracy' : ptLoss <= 10 ? 'mistake' : 'blunder';
  else grade = ptLoss <= 2 ? 'good' : ptLoss <= 5 ? 'inaccuracy' : ptLoss <= 11 ? 'mistake' : 'blunder';
  // Throwing away a win (or a draw) is never small.
  if (wrLoss >= 0.45 && (grade === 'good' || grade === 'inaccuracy')) grade = 'mistake';
  else if (wrLoss >= 0.2 && grade === 'good') grade = 'inaccuracy';
  return grade;
}

// Grades `move` from the read of the position before it (`before`, the mover
// to play, every move scored). Returns null until the read has the move.
export function gradeMove(before, move) {
  if (!before || !before.moves || !before.moves.length) return null;
  const mover = before.toPlay;
  if (move === PASS) return null;
  const best = before.moves[0], entry = before.moves.find(m => m.move === move);
  if (!entry || entry.bound) return null;
  const ptLoss = Math.max(0, best.score - entry.score);
  const exact = !!(best.exact && entry.exact);
  const wrLoss = Math.max(0, best.winrate - entry.winrate);
  const grade = classify(ptLoss, wrLoss, exact);
  const alternatives = before.moves.filter(m => m !== entry && m.score >= best.score - 1).slice(0, 3);
  return {
    grade, ptLoss, wrLoss, exact, mover,
    bestMove: best.move, bestScore: best.score, score: entry.score,
    bestWinrate: best.winrate, winrate: entry.winrate,
    // Exact results: what the move and the best move lead to with perfect play.
    result: exact ? entry.score : null, bestResult: exact ? best.score : null,
    alternatives, depth: before.depth,
  };
}

// Which moves the coach grades: the player's, the AI's only when asked, and
// both sides in study mode (human === 0).
export const gradesMove = (node, human, gradeAI) => !!node.parent && node.move !== PASS && (!human || node.color === human || gradeAI);

// "Black +6", "White +2", "Even".
export function describeScore(blackScore) {
  const s = Math.round(blackScore);
  if (!s) return 'Even';
  return `${s > 0 ? 'Black' : 'White'} +${Math.abs(s)}`;
}

// Hints for the board: the best few moves, coloured by how much they lose.
export function hintList(an, max = 6) {
  const ms = (an.moves || []).filter(m => m.move !== PASS && !m.bound);
  if (!ms.length) return [];
  const top = ms[0];
  return ms.slice(0, max).filter(m => m.score >= top.score - 12).map((m, rank) => {
    const loss = top.score - m.score;
    const color = rank === 0 || loss <= 0 ? '#2f9e61' : loss <= 2 ? '#3b82c4' : loss <= 5 ? '#b8901c' : '#cf6a1d';
    return { move: m.move, rank, color, label: `${m.score > 0 ? '+' : ''}${m.score}`, sub: an.exact ? 'exact' : `${Math.round(m.winrate * 100)}%` };
  });
}

// ------------------------------------------------------------------ openings

// The start position is symmetric under 4 of the board's 8 symmetries; an
// opening played from another first move is one of those images.
const START_SYMS = SYMMETRIES.filter(m => { const b = new Board(); return b.color.every((c, p) => b.color[m[p]] === c); });

// Each named opening's position (in every orientation) → its name and line,
// and every position along a named line → the openings it leads towards.
const BOOK = new Map(), TOWARDS = new Map();
const keyOf = board => board.color.join('');
for (const [moves, name] of OPENINGS) {
  const seq = moves.match(/../g).map(m => (+m[1] - 1) * 8 + m.charCodeAt(0) - 97);
  for (const sym of START_SYMS) {
    const b = new Board();
    for (const m of seq) {
      b.play(sym[m]);
      const key = keyOf(b);
      if (!TOWARDS.has(key)) TOWARDS.set(key, []);
      if (!TOWARDS.get(key).includes(name)) TOWARDS.get(key).push(name);
    }
    if (!BOOK.has(keyOf(b))) BOOK.set(keyOf(b), { name, moves: seq.map(s => sym[s]) });
  }
}

// The named opening a position is, or null.
export const openingAt = board => BOOK.get(keyOf(board)) || null;

// The most recent named opening on the way to `node` (a game-tree node), and
// whether the game is still in the book (its position is on a named line).
export function openingOf(node) {
  for (let n = node; n; n = n.parent) {
    const o = openingAt(n.board);
    if (o) return { ...o, current: n === node, inBook: TOWARDS.has(keyOf(node.board)), at: n };
  }
  return null;
}

// Moves from `node` that stay on a named line, with the openings each leads towards.
export function bookMoves(node) {
  const b = node.board, out = [];
  for (const m of b.legalMoves()) {
    const t = b.clone(); t.play(m);
    const names = TOWARDS.get(keyOf(t));
    if (names) out.push({ move: m, names, name: (openingAt(t) || {}).name || null });
  }
  return out;
}

export { sqName };
