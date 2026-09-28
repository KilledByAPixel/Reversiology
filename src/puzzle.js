// Puzzles: choosing the next one, checking an answer, and the words for
// hints and feedback. Pure functions, no DOM, testable in node.
import { Board, BLACK, WHITE, EMPTY, parseSq, sqName } from './board.js';
import { PUZZLES } from './puzzles.js';
import { moveFacts, compareFacts } from './explain.js';
import { describe } from './wording.js';

export const DIFFICULTY = ['', 'Easy', 'Medium', 'Hard'];

// A puzzle as an object: { id, board (Board), answers (squares), theme, difficulty, gap, exact }.
export function puzzleAt(i) {
  const [board, side, answers, theme, difficulty, gap, exact] = PUZZLES[i];
  const b = Board.fromString(board, side === 'O' ? WHITE : BLACK);
  return { index: i, id: `${board}${side}`, board: b, answers: answers.split(' ').map(parseSq), theme, difficulty, gap, exact: !!exact };
}

export const puzzleCount = (difficulty = 0) => PUZZLES.filter(p => !difficulty || p[4] === difficulty).length;

// The next puzzle after index `from` with the chosen difficulty (0: any),
// unsolved ones first; null when there are none.
export function nextPuzzle(solved, difficulty = 0, from = -1) {
  const n = PUZZLES.length, ok = i => !difficulty || PUZZLES[i][4] === difficulty;
  const id = i => PUZZLES[i][0] + PUZZLES[i][1];
  for (const wantUnsolved of [true, false]) {
    for (let k = 1; k <= n; k++) {
      const i = (from + k + n) % n;
      if (ok(i) && (!wantUnsolved || !solved.has(id(i)))) return i;
    }
  }
  return null;
}

// What to look for, without giving the answer away.
export const THEME_HINTS = {
  corner: 'Look at the corners.',
  pass: 'Can you leave your opponent without a move?',
  defend: 'Your opponent is threatening to take a corner. Can you take that chance away?',
  parity: 'Count the empty squares in each region: try to get the last move in each one.',
  endgame: 'Every disc counts now. This one can be worked out exactly: which move keeps the most?',
  quiet: 'Grabbing the most discs isn\'t it. Look for a quiet move that flips a little and opens nothing new.',
  mobility: 'Which move leaves your opponent the fewest good replies?',
  wipeout: 'Can you flip every last disc?',
  best: 'Before you move, look at what your opponent could play after it.',
};

export const THEME_NAMES = {
  corner: 'Take the corner', pass: 'Force a pass', defend: 'Defend a corner', parity: 'Parity', endgame: 'Exact endgame',
  quiet: 'Quiet move', mobility: 'Mobility', wipeout: 'Wipeout', best: 'Find the best move',
};

// The task, in words: "Black to play and win", "White to play: find the best move."
export function prompt(p, you = null) {
  const who = p.board.toPlay === BLACK ? 'Black' : 'White';
  if (p.theme === 'wipeout') return `${who} to play and wipe out every ${p.board.toPlay === BLACK ? 'white' : 'black'} disc.`;
  return `${who} to play. Find the best move.`;
}

// Feedback on playing `move` in puzzle p: { correct, lines, reveal }: lines
// say what the move does (for a wrong one, what's wrong with it), reveal how
// the answer compares. level: the coach level.
export function judge(p, move, level = 'improving') {
  const mover = p.board.toPlay, correct = p.answers.includes(move);
  const after = p.board.clone();
  const flipped = after.play(move);
  const ctx = { level, mover, you: mover, shown: { flagged: !correct } };
  const facts = moveFacts({ before: p.board, after, move, mover, flipped }).filter(f => f.type !== 'opening');
  let lines, reveal = [];
  if (correct) {
    lines = describe(facts.filter(f => ['corner', 'forcesPass', 'blocksCorner', 'stable', 'wipeout', 'mobility', 'parity', 'flips'].includes(f.type)), { ...ctx, shown: { flagged: false } });
  } else {
    // What's wrong with the move, without naming the answer; the comparison
    // with the answer (`reveal`) waits until it's shown.
    lines = describe(facts.filter(f => ['givesCorner', 'xsquare', 'csquare', 'cornerSoon'].includes(f.type)), ctx)
      .filter(l => !/deeper than a single move/.test(l));
    reveal = describe(compareFacts(p.board, move, p.answers[0], mover), ctx).filter(l => !/deeper than a single move/.test(l));
  }
  return { correct, lines, reveal };
}

export { sqName, EMPTY };
