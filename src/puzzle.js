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
// How many of the current puzzles are among the solved ids (older ones may be gone).
export const solvedCount = solved => PUZZLES.filter(p => solved.has(p[0] + p[1])).length;

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

// The idea behind each theme, shown once a puzzle is solved.
export const THEME_LESSONS = {
  corner: 'A disc in a corner can never be flipped, and it anchors the edges next to it. When a corner is on offer, take it unless something even bigger is at stake.',
  pass: 'If your opponent has no legal move, they must pass and you move again. Leaving them without moves is one of the strongest things you can do.',
  defend: 'When your opponent threatens a corner, look for a move that takes the threat away: flip the disc they need, or fill the square they would flank from.',
  parity: 'Near the end the empty squares split into regions. Whoever plays last in a region usually does best there, so play into regions with an odd number of empty squares.',
  endgame: 'In the last moves every disc counts, and the best move can be worked out exactly. Count what each move flips, and what your opponent can flip back.',
  quiet: 'Moves that flip few discs, all inside your own group, give your opponent nothing new to aim at. Flipping lots of discs early usually hands them more moves.',
  mobility: 'Mobility means having moves to choose from. Keep yours high and your opponent\'s low, and sooner or later they must play a move that gives you a corner.',
  wipeout: 'A wipeout, flipping every disc of the other colour, ends the game at once with all 64 squares yours.',
  best: 'Before each move, look at what your opponent can do after it. The best move is often the one that leaves them only bad replies.',
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
  // Puzzles are about understanding: the reasons are worded at least for improving players.
  if (level === 'beginner') level = 'improving';
  const mover = p.board.toPlay, correct = p.answers.includes(move);
  const after = p.board.clone();
  const flipped = after.play(move);
  const ctx = { level, mover, you: mover, shown: { flagged: !correct } };
  const facts = moveFacts({ before: p.board, after, move, mover, flipped }).filter(f => f.type !== 'opening');
  let lines, reveal = [];
  if (correct) {
    lines = describe(facts.filter(f => ['corner', 'forcesPass', 'blocksCorner', 'stable', 'wipeout', 'mobility', 'parity', 'flips'].includes(f.type)), { ...ctx, shown: { flagged: false } });
    // Why it beats the tempting alternative: the move that flips the most.
    const alt = tempting(p);
    if (alt != null) {
      const vs = describe(compareFacts(p.board, alt, move, mover), { ...ctx, shown: { flagged: true } }).filter(l => !/deeper than a single move/.test(l));
      if (vs.length) lines.push(`Why not <b>${sqName(alt)}</b>, which flips the most? ${vs.join(' ')}`);
    }
  } else {
    // What's wrong with the move, without naming the answer; the comparison
    // with the answer (`reveal`) waits until it's shown.
    lines = describe(facts.filter(f => ['givesCorner', 'xsquare', 'csquare', 'cornerSoon'].includes(f.type)), ctx)
      .filter(l => !/deeper than a single move/.test(l));
    reveal = describe(compareFacts(p.board, move, p.answers[0], mover), ctx).filter(l => !/deeper than a single move/.test(l));
  }
  return { correct, lines, reveal };
}

// The wrong move a learner is most likely to reach for: the one flipping the most.
export function tempting(p) {
  let best = -1, move = null;
  for (const m of p.board.legalMoves()) {
    if (p.answers.includes(m)) continue;
    const n = p.board.flips(m).length;
    if (n > best) { best = n; move = m; }
  }
  return move;
}

export { sqName, EMPTY };
