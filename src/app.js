// Reversiology controller: wires the game record, the opponent engine, the
// coach engines and the board view together.
import { BLACK, WHITE, EMPTY, PASS, CORNERS, sqName, parseSq } from './board.js';
import { Game, reasonText, colorName } from './game.js';
import { Engine, EnginePool } from './engine-client.js';
import { LEVELS, levelSearch, pickLevelMove, nextLevel } from './levels.js';
import { annotate, gradeMove, gradesMove, GRADES, describeScore, hintList, openingOf, bookMoves, keyMoments } from './coach.js';
import { nodeFacts, moveFacts } from './explain.js';
import { COACH_FOR, resolveLevel, gradeLabel, levelGrade, verdict, verdictSaysResult, describe, describeNote, positionNotes, hideAnswer, mistakeLines, missedLine } from './wording.js';
import { stableDiscs, frontierDiscs, dangerSquares, emptyRegions } from './concepts.js';
import { BoardView } from './view.js';
import { linkPoints, pointReadout, movePhrase, plainText, positionPhrase, resultPhrase } from './access.js';
import { initAnnouncer, announce, speak, hush, setSpeech, repeatLast, speechAvailable } from './announce.js';
import { renderGraph } from './graph.js';
import { safeStorage } from './storage.js';
import { discSound, playSound, setSoundEnabled, SOUNDS, ZZFXSound } from './sound.js';
import { puzzleAt, nextPuzzle, puzzleCount, solvedCount, judge, prompt, THEME_HINTS, THEME_NAMES, THEME_LESSONS, DIFFICULTY } from './puzzle.js';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STORE = 'reversiology.v1';
const PUZZLE_STORE = 'reversiology.puzzles.v1';

const TOGGLES = [
  ['moves', 'Legal moves', 'A dot on every square where the side to move can play.', 'M'],
  ['preview', 'Flip preview', 'Hover a square: rings mark the discs your move would flip, and the number says how many.', 'V'],
  ['danger', 'Danger squares', 'Squares next to an empty corner. Playing there often lets the opponent take the corner: red for X-squares (diagonal), orange for C-squares (along the edge).', 'D'],
  ['stable', 'Stable discs', 'A gold mark on discs that can never be flipped again.', 'T'],
  ['frontier', 'Frontier', 'Dashed rings on discs next to an empty square. Fewer frontier discs usually means fewer moves for your opponent.', 'F'],
  ['parity', 'Regions', 'In the endgame, the empty regions and how many squares each has. Getting the last move in a region is an advantage, so odd regions (blue) are the ones to play in.', 'P'],
  ['book', 'Opening book', 'In the opening, mark the moves that follow a named opening line.', 'K'],
  ['feedback', 'Grade moves', 'After every move the coach says how good it was and what it would have played.', 'G'],
  ['hints', 'Best moves', 'Always show the coach\'s favourite moves with the disc result it expects. Press H for a one-off hint instead.', 'B'],
  ['numbers', 'Move numbers', 'Show the order the discs were played in.', 'N'],
];

// Coach depth: plies read in the midgame (with ProbCut at a confidence that
// rarely changes a score), empties solved exactly, time cap.
const COACH_DEPTHS = {
  quick: { depth: 10, exact: 16, probcut: 2, maxTime: 4000 },
  normal: { depth: 12, exact: 18, probcut: 2, maxTime: 8000 },
  deep: { depth: 14, exact: 20, probcut: 2, maxTime: 20000 },
};

const DEFAULTS = {
  human: BLACK,              // BLACK or WHITE vs the AI; 0 = study mode (you play both)
  level: 2,
  handicap: 0,               // corners given to the human (Black in study mode)
  coach: true,
  coachDepth: 'normal',
  gradeAI: false,
  findYourself: false,        // after a mistake, the coach keeps its move to itself until asked
  ladder: true,               // after each game against the AI, move its level up for a win, down for a loss
  coachFor: 'auto',
  speak: false,
  sound: true,
  show: { moves: true, preview: true, danger: true, stable: false, frontier: false, parity: false, book: false, feedback: true, hints: false, numbers: false },
};

let settings = structuredClone(DEFAULTS);
let game = null;
let resigned = 0;            // colour that resigned
let hoverPt = null;
let hoverByKey = false;      // hoverPt is the keyboard cursor, whose readout already says why a square can't be played
let hintOn = false;
let warningsSaid = null;     // the position and notes last read out
let better = null;           // { node, move, pv } — a puzzle's answer shown on node's board
let peek = null;             // { node, move, pv } — the coach's move previewed from a Try button (hover or focus)
let armed = null;            // the graded move whose Try was tapped once: its preview stays, the button says Play
let swallowClick = false;    // a board click that only ended an armed preview
let lastPointer = '';        // the last pointer used (mouse, touch, pen), or '' after a key
let ending = false;          // ending a preview: the redraw's focus restore mustn't start it again
let flashMsg = null, flashTimer = 0;
let aiNode = null, aiToken = 0;
let aiBest = false;          // the current AI search is the "AI move" button's full-strength move
let coachJobs = [];          // per coach engine: the node it is reading
let locatePt = null;         // a square the player is hovering in the coach's text
let threat = null;           // { node, pending | none | move, pv, facts, cost } — the opponent's idea
let overShown = null;        // the finished position whose result was announced
// Puzzle mode: { p (puzzle.js), status 'solving' | 'correct' | 'wrong', lines,
// hint, saved: the game and colour to return to }. Solved puzzle ids persist.
let puzzle = null;
let puzzleProgress = { solved: new Set(), difficulty: 0, last: -1 };

const COACHES = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
const PUZZLE_TOTAL = puzzleCount();
const opponent = new Engine('opponent', { ttBits: 20 }); // a bigger table for the deepest levels
const coach = new EnginePool('coach', COACHES);
// Answers "what would the opponent play if it were their move?" Started on
// first use: each worker holds its own copy of the evaluation.
let scoutEngine = null;
const scout = { search: (...a) => (scoutEngine ||= new Engine('scout')).search(...a), cancel: () => scoutEngine && scoutEngine.cancel() };
Engine.onError = (name, msg) => flash(`The ${name} engine stopped working (${msg}). It restarts by itself on the next move (press AI move to try again); if it keeps happening, reload the page or try a current Chrome, Firefox or Safari.`, 'bad');
Engine.onWarning = (name, msg) => { if (name === 'opponent') flash(`The evaluation couldn't load (${msg}), so the AI and coach are much weaker. Reload to try again.`, 'bad'); };
const view = new BoardView($('#board'), { onClick, onHover, onCursor });

// The keyboard cursor moved: say what's there.
function onCursor(p) {
  announce(pointReadout(game.current.board, p, q => game.check(q)), { cursor: true });
}

// ------------------------------------------------------------------ helpers

const aiColor = () => puzzle ? 0 : settings.human ? 3 - settings.human : 0;
const level = () => LEVELS[settings.level];
const aiLabel = () => `AI (${level().name})`;
const who = c => !settings.human ? colorName(c) : c === settings.human ? 'You' : 'AI';
const whose = c => !settings.human ? `${colorName(c)}'s` : c === settings.human ? 'Your' : 'AI\'s';
const plural = (n, w) => `${n} ${n === 1 ? w : w + 's'}`;
const capital = s => s[0].toUpperCase() + s.slice(1);
const coachLevel = () => resolveLevel(settings.coachFor, settings.level);
const coachOpts = () => ({ ...COACH_DEPTHS[settings.coachDepth] || COACH_DEPTHS.normal, all: true, minDepth: 4 });

function isAITurn(node = game.current) {
  const ai = aiColor();
  return !resigned && ai && node.board.toPlay === ai && !game.isOver(node) && node.children.length === 0 && !node.board.mustPass;
}

function flash(text, kind = '') {
  flashMsg = { text, kind };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMsg = null; renderStatus(); }, 5000);
  renderStatus();
  speak(text);
}

function pvDiscs(color, moves) {
  // A continuation alternates colours, except across passes.
  let c = color;
  return moves.map(move => { const d = { move, color: c }; c = 3 - c; return d; });
}

// ------------------------------------------------------------------ game flow

function newGame() {
  resetCoachHeight();
  cancelAI();
  stopCoach();
  game = new Game({ handicap: settings.handicap, handicapColor: settings.human || BLACK });
  resigned = 0; better = null; peek = null; armed = null; hintOn = false; threat = null; overShown = null;
  flashMsg = null;
  afterChange();
}

function afterChange() {
  if (aiNode && game.current !== aiNode) cancelAI();
  save();
  render();
  scheduleCoach();
  autoPass();
  aiMove();
}

// A player without a legal move passes: played for them, with a note.
function autoPass() {
  const node = game.current;
  if (resigned || aiNode || !node.board.mustPass || node.children.length) return;
  const c = node.board.toPlay;
  setTimeout(() => {
    if (game.current !== node || node.children.length) return;
    playMove(PASS, { news: `${who(c)} ${c === settings.human ? 'have' : 'has'} no legal move${c === settings.human ? ', so you pass' : ' and passes'}. ${who(3 - c)} ${3 - c === settings.human ? 'move' : 'moves'} again.` });
  }, 350);
}

// human: the player's own move, which cuts off anything still being spoken.
// news: shown and said in place of the usual move announcement (passes).
function playMove(move, { human = false, news = '' } = {}) {
  const r = game.check(move);
  if (!r.ok) { flash(reasonText(r.reason), 'bad'); playSound('illegal'); return false; }
  if (human) hush(); // a new move: they're done listening
  // Playing on from a tried coach move keeps that line: no more "Back to my move".
  if (human) for (let n = game.current, k = 0; n && k < 2; n = n.parent, k++) delete n.backTo;
  const regrade = !!(game.current.children.find(c => c.move === move) || {}).grade;
  const node = game.play(move);
  if (news) flash(news);
  else {
    // Say the move; for ungraded (AI) moves add what the player must react to.
    const note = isGraded(node) ? [] : describeNote(factsFor(node), { mover: node.color, you: settings.human });
    announce([movePhrase(who(node.color), move, node.flipped.length), ...note].join(' '));
  }
  hintOn = false; better = null; peek = null; armed = null; threat = null;
  if (move === PASS) playSound('pass');
  else discSound(node.flipped.length, !!aiColor() && node.color === aiColor(), CORNERS.includes(move));
  if (game.isOver()) finalRead(node);
  tryGrade(node);
  if (regrade) { node.announced = false; announceGrade(node); } // the same move again after Try again
  if (puzzle && human && puzzle.status === 'solving' && node.parent === game.root) puzzleAnswered(move);
  afterChange();
  if (game.isOver()) gameOver();
  // Replaying a move that already has a (taken-back) AI reply below it: the
  // node isn't a leaf, but the AI should still answer.
  else if (aiColor() && !resigned && game.toPlay === aiColor() && !game.current.board.mustPass) aiMove(true);
  return true;
}

function onClick(p) {
  if (swallowClick) { swallowClick = false; return; }
  if (armed) { disarm(); return; } // (keyboard) the board only ends the preview
  if (resigned) { flash('You resigned. Take back to keep playing, or start a new game.'); return; }
  if (aiNode) { flash('Hold on, the AI is thinking…'); return; }
  const node = game.current;
  if (game.isOver(node)) { flash('Neither player can move. The game is over.'); return; }
  const ai = aiColor();
  if (ai && node.board.toPlay === ai) {
    flash('It\'s the AI\'s turn in this position. Press "AI move" to let it play, or step forward.');
    return;
  }
  playMove(p, { human: true });
}

function onHover(p, byKey = false) {
  hoverPt = p; hoverByKey = byKey;
  renderBoard();
  renderStatus();
}

function takeBack() {
  if (puzzle) { retryPuzzle(); return; }
  // Nothing to take back at the start: leave the AI's first move alone.
  if (!game.current.parent && !resigned) return;
  cancelAI();
  better = null; peek = null; armed = null; hintOn = false; threat = null;
  // The first take back after resigning withdraws the resignation.
  if (resigned) { resigned = 0; flash('Resignation withdrawn. Play on!'); afterChange(); return; }
  playSound('undo');
  game.undo();
  const ai = aiColor();
  // Back to a position where you choose: past the AI's moves and forced passes.
  while (game.current.parent && ((ai && game.toPlay === ai) || game.current.board.mustPass || game.current.move === PASS)) game.undo();
  overShown = null;
  render();
  announce(positionPhrase(game.current.depth, game.current.color, game.current.move));
  save();
  scheduleCoach();
  // Back at the very start with the AI to move (you play White): let it move again.
  if (ai && !game.current.parent && game.toPlay === ai) aiMove(true);
}

function resign() {
  if (game.isOver()) return;
  if (!settings.human) { flash('In study mode there is no opponent to resign to.'); return; }
  if (resigned) return;
  cancelAI();
  resigned = settings.human;
  // The coach's moves show once you've resigned: taking it back doesn't hide them again.
  for (const n of game.line()) if (n.grade && n.color === settings.human) { n.revealed = true; n.parent.helped = true; }
  playSound('lose');
  flash('You resigned. No shame in that: step back through the game to see where it turned.');
  const next = ladderSentence();
  if (next) announce(next);
  afterChange();
}

// Shows what the opponent wants to play: the position read with them to move.
async function toggleThreat() {
  const node = game.current;
  if (threat && threat.node === node) { threat = null; scout.cancel(); render(); return; }
  if (game.isOver(node)) return;
  const me = node.board.toPlay, opp = 3 - me;
  const b = node.board.clone();
  b.toPlay = opp;
  if (!b.legalMoves().length) { threat = { node, none: true, opp, me }; render(); return; }
  const mine = threat = { node, pending: true, opp, me };
  render();
  const res = annotate(await scout.search(b, { ...coachOpts(), maxTime: 5000, reportMs: 0 }));
  if (threat !== mine) return; // cleared with Esc, or superseded by a newer request
  const m = res && res.moves[0];
  if (!m) { threat = null; render(); return; }
  const after = b.clone();
  const flipped = after.play(m.move);
  const cost = node.analysisDone ? node.analysis.score + res.score : null;
  threat = { node, opp, me, move: m.move, pv: pvDiscs(opp, [m.move, ...(m.pv || [])]), cost,
    facts: moveFacts({ before: b, after, move: m.move, mover: opp, flipped }) };
  render();
}

// ------------------------------------------------------------------ AI opponent

function cancelAI() {
  aiToken++;
  if (aiNode) { opponent.cancel(); aiNode = null; }
}

// force: play even when it isn't the AI's turn (the "AI move" button, replays).
// best: play the coach's best move instead of the level's move, reusing the
// coach's read of this position when it has one.
async function aiMove(force = false, best = false) {
  const node = game.current;
  if (aiNode || game.isOver(node) || resigned) return;
  if (node.board.mustPass) { if (force) autoPass(); return; }
  if (!force && !isAITurn(node)) return;
  const token = ++aiToken;
  const lv = level();
  aiNode = node; aiBest = best;
  if (best) node.helped = true; // the "AI move" button plays the coach's move: not found by the player
  render();
  const t0 = performance.now();
  let move;
  if (best && node.analysisDone && node.analysis.moves.length) move = node.analysis.moves[0].move;
  else {
    const results = await opponent.search(node.board, best ? { ...coachOpts(), all: false, reportMs: 0 } : { ...levelSearch(lv), reportMs: 0 });
    if (token !== aiToken) return;
    if (!results) { aiNode = null; render(); return; }
    move = best ? results.moves[0].move : pickLevelMove(results, lv, node.board);
  }
  // A short pause, so the move doesn't appear before your own has landed.
  const wait = 450 - (performance.now() - t0);
  if (wait > 0) await sleep(wait);
  if (token !== aiToken) return;
  aiNode = null;
  if (game.current !== node) { render(); return; }
  if (!game.check(move).ok) move = node.board.legalMoves()[0];
  playMove(move);
}

// ------------------------------------------------------------------ coach

const isGraded = node => gradesMove(node, settings.human, settings.gradeAI);

// The coach's to-do list: the positions whose reads grade the moves on
// screen, the position on the board, then outwards along the game.
function coachQueue(max) {
  const cur = game.current, out = [];
  const want = n => {
    if (!n || n.analysisDone || out.includes(n)) return;
    if (game.isOver(n)) { finalRead(n); return; }
    out.push(n);
  };
  // First the reads that grade the last two moves (the positions before
  // them), then the position on the board.
  for (const n of [cur, cur.parent]) if (n && n.parent && isGraded(n)) want(n.parent);
  want(cur);
  const line = game.line(), idx = line.indexOf(cur);
  // Reviewing: the next move's grade.
  if (line[idx + 1] && isGraded(line[idx + 1])) want(cur);
  want(line[idx + 1]);
  for (let d = 1; d < line.length && out.length < max * 2; d++) {
    want(line[idx - d]);
    want(line[idx + d]);
  }
  return out.slice(0, max);
}

// Keeps each coach engine on one of the most urgent positions, pre-empting
// background reads when something more urgent comes up.
function scheduleCoach() {
  if (!settings.coach) return;
  const engines = coach.engines;
  const want = coachQueue(engines.length);
  const running = new Set(coachJobs.filter(Boolean));
  for (const n of want) {
    if (running.has(n)) continue;
    let i = engines.findIndex((_, k) => !coachJobs[k]);
    if (i < 0) i = coachJobs.findIndex(j => !want.includes(j));
    if (i < 0) break;
    startCoachJob(i, n);
  }
}

function startCoachJob(i, node) {
  coachJobs[i] = node;
  // A position where the side to move must pass is read from the other side.
  coach.engines[i].search(node.board, {
    ...coachOpts(),
    reportMs: 300,
    onProgress: (res, done) => {
      if (coachJobs[i] !== node || !res) return;
      if (!res.depth && !done) return;
      node.analysis = annotate(res);
      if (done) node.analysisDone = true;
      onAnalysis(node);
    },
  }).then(res => {
    if (coachJobs[i] === node) coachJobs[i] = null;
    if (res) scheduleCoach();
  });
}

// A finished position needs no read: its result is the count.
function finalRead(node) {
  const b = node.board, s = b.toPlay === BLACK ? 1 : -1;
  node.analysis = annotate({ toPlay: b.toPlay, over: true, exact: true, score: b.finalMargin() * s, moves: [], depth: 0, empties: b.empties });
  node.analysisDone = true;
  for (const ch of node.children) tryGrade(ch);
}

function stopCoach() {
  coach.cancel();
  coachJobs = [];
}

// Forgets the coach's reads so every position is read again.
function rereadAll() {
  const reset = n => { n.analysisDone = false; n.analysis = null; n.grade = null; n.announced = false; n.children.forEach(reset); };
  reset(game.root);
}

// Grades node's move once the position before it has been read.
function tryGrade(node) {
  const parent = node.parent;
  if (!parent || node.grade || !isGraded(node) || !parent.analysisDone) return;
  const g = gradeMove(parent.analysis, node.move);
  if (!g) return;
  node.grade = g;
  announceGrade(node);
}

// The coach's verdict on a move on screen, spoken once (after the read of
// the position after it too, so the explanation is complete).
function announceGrade(node) {
  const cur = game.current;
  if (node.announced || !node.grade || !settings.show.feedback || (node !== cur && node !== cur.parent)) return;
  if (!node.analysisDone && !game.isOver(node)) return;
  if (!puzzleSpoilersOk()) return; // the grade would name the puzzle's answer
  node.announced = true;
  announce(gradeSpeech(node));
}

// What the coach says about a graded move, as plain text ("Coach: Mistake. …").
function gradeSpeech(node) {
  const level = coachLevel(), facts = factsFor(node).filter(f => f.type !== 'opening'), shown = levelGrade(node.grade, level, facts);
  const all = describe(facts, { level, mover: node.color, you: settings.human, shown, resultSaid: verdictSaysResult(node.grade, level, shown) });
  const hide = findIt(node, shown), lines = hide ? hideAnswer(all, answerSquares(node)) : all;
  const said = hide ? 'There was something better here. Can you find it?' : `${found(node, shown) ? 'You found it! ' : ''}${verdict(node.grade, level, shown)}`;
  return plainText(`Coach: ${shown.label}. ${said} ${lines.join(' ')}`);
}

// What the coach knows about node's move so far (explain.js).
function factsFor(node) {
  return nodeFacts(node, { before: node.parent.analysisDone ? node.parent.analysis : null, after: node.analysisDone ? node.analysis : null });
}

let analysisRenderPending = false;
function onAnalysis(node) {
  for (const ch of node.children) tryGrade(ch);
  if (node.grade) announceGrade(node);
  if (analysisRenderPending) return;
  analysisRenderPending = true;
  // setTimeout rather than requestAnimationFrame: rAF stalls in hidden tabs/panes.
  setTimeout(() => { analysisRenderPending = false; render(); }, 30);
}

// ------------------------------------------------------------------ game over

function gameOver() {
  const node = game.current;
  if (overShown === node) return;
  overShown = node;
  const s = game.score(node);
  announce(`Game over. ${resultPhrase(s)} ${ladderSentence()}`.trim());
  playSound(settings.human && s.winner !== settings.human ? 'lose' : 'win');
  render();
  $('#scorePanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // stacked below the board on phones
}

// ------------------------------------------------------------------ navigation

function goTo(node, { verdict: sayVerdict = true } = {}) {
  cancelAI();
  better = null; peek = null; armed = null; hintOn = false; threat = null;
  locatePt = null; // the button it came from may be rebuilt without a focusout
  game.goTo(node);
  save(); render(); scheduleCoach();
  // Stepping through a game: the move, and the coach's verdict on it when there is one.
  const graded = sayVerdict && node.move !== PASS && node.grade && isGraded(node) && node.analysisDone && settings.show.feedback && puzzleSpoilersOk();
  announce(positionPhrase(node.depth, node.color, node.move) + (graded ? ` ${gradeSpeech(node)}` : ''));
  aiMove(); // back at the newest position with the AI to move (only fires on a leaf)
}

function nav(where) {
  const cur = game.current;
  if (where === 'first') goTo(game.root);
  else if (where === 'prev' && cur.parent) goTo(cur.parent);
  else if (where === 'next') { const n = cur.lastChild || cur.children[0]; if (n) goTo(n); }
  else if (where === 'last') { const line = game.line(); goTo(line[line.length - 1]); }
}

// Ends a Try preview kept on by a first tap.
function disarm() {
  armed = null;
  peek = null;
  ending = true;
  try { render(); } finally { ending = false; }
}

// Try's preview: the position before the graded move, with the coach's move and
// how it expects play to go on. Board and status line only: the game stays put.
function peekAt(node) {
  const g = node && node.grade, parent = node && node.parent;
  if (!g || !parent || g.bestMove === PASS) {
    if (peek) { peek = null; renderBoard(); renderStatus(); }
    return;
  }
  parent.helped = true; // seeing the coach's move: a good move here isn't "found" alone
  const m = parent.analysis && parent.analysis.moves.find(x => x.move === g.bestMove);
  peek = { node: parent, move: g.bestMove, pv: pvDiscs(parent.board.toPlay, [g.bestMove, ...((m && m.pv) || [])]) };
  renderBoard(); renderStatus();
}

const nodeById = id => {
  for (const stack = [game.root]; stack.length;) {
    const n = stack.pop();
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
};

function tryInstead(node) {
  const g = node.grade;
  if (!g || !node.parent) return;
  if (resigned) { flash('You resigned. Take back to keep playing, or start a new game.'); return; }
  const back = game.current; // where the player was: "Back to my move" returns here
  node.parent.helped = true;
  peek = null;
  goTo(node.parent, { verdict: false });
  if (playMove(g.bestMove, { human: true })) {
    const tried = node.parent.children.find(c => c.move === g.bestMove);
    if (tried && tried !== node) tried.backTo = { node: back, move: node.move };
  }
}

// From a tried coach move back to exactly where the player was.
function backToMine(node) {
  if (node.backTo && nodeById(node.backTo.node.id)) goTo(node.backTo.node, { verdict: false });
}

// ------------------------------------------------------------------ rendering

// Graph dot for a move flagged at the current coach level.
function graphMark(node) {
  if (!node.grade || !isGraded(node)) return null;
  const shown = levelGrade(node.grade, coachLevel(), factsFor(node));
  return shown.flagged ? { color: shown.color, small: shown.key === 'inaccuracy' } : null;
}

// Replaces an element's HTML only when it changed, so a coach tick doesn't
// rebuild buttons under the pointer (and take their focus). A focused button
// that is rebuilt (same id, or same data-act and data-id) keeps the focus.
function setHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  const f = document.activeElement;
  const sel = f && f !== el && el.contains(f) && (f.id ? `#${CSS.escape(f.id)}`
    : ['act', 'id'].filter(k => f.dataset && f.dataset[k]).map(k => `[data-${k}="${CSS.escape(f.dataset[k])}"]`).join(''));
  el.innerHTML = html;
  const again = sel && el.querySelector(sel);
  if (again) again.focus({ preventScroll: true });
}

function render() {
  renderBoard();
  renderPlayers();
  renderCoach();
  renderScorePanel();
  renderPuzzle();
  renderNav();
  renderStatus();
  renderGraph($('#graph'), game.line(), game.current, goTo, graphMark, { dotsOnScore: game.handicap > 0 });
  renderReview();
}

function moveNumbers(node) {
  const map = new Map();
  let k = 0;
  const path = [];
  for (let n = node; n.parent; n = n.parent) path.unshift(n);
  for (const n of path) if (n.move !== PASS) map.set(n.move, ++k);
  return map;
}

function hoverInfo() {
  const p = hoverPt, node = game.current, b = node.board;
  if (p === null || aiNode || game.isOver(node) || b.color[p] !== EMPTY) return null;
  if (resigned || (aiColor() && b.toPlay === aiColor())) return null;
  const c = b.toPlay, r = game.check(p);
  if (!r.ok) return { p, color: c, ok: false, reason: r.reason };
  return { p, color: c, ok: true, flips: settings.show.preview ? b.flips(p) : null };
}

function renderBoard() {
  if (peek) {
    const n = peek.node;
    view.render({ board: n.board, nodeId: n.id, lastMove: n.parent ? n.move : PASS, flipped: n.flipped, better: peek.move, pv: peek.pv });
    return;
  }
  const node = game.current, b = node.board, an = node.analysis, sh = settings.show;
  const over = game.isOver(node);
  const s = { board: b, nodeId: node.id, lastMove: node.parent ? node.move : PASS, flipped: node.flipped };
  const aiToMove = aiColor() && !resigned && b.toPlay === aiColor() && node.children.length === 0;
  if (sh.moves && !over && !aiToMove) s.moves = b.legalMoves();
  if (sh.stable) s.stable = stableDiscs(b);
  if (sh.frontier) s.frontier = frontierDiscs(b);
  if (sh.danger && !over) s.danger = dangerSquares(b);
  if (sh.parity && !over && b.empties <= 24) s.regions = emptyRegions(b);
  if (sh.numbers) s.numbers = moveNumbers(node);
  const hintsVisible = an && (hintOn || sh.hints) && !over && !aiToMove && puzzleSpoilersOk();
  if (hintsVisible) node.helped = true; // the best moves were on show here: a good move isn't "found" alone
  if (hintsVisible) {
    s.hints = hintList(an);
    const m = hoverPt !== null && an.moves.find(x => x.move === hoverPt);
    if (m && m.pv) s.pv = pvDiscs(b.toPlay, [m.move, ...m.pv]);
  } else if (sh.book && !over && !aiToMove && node.depth < 30 && !puzzle) {
    const book = bookMoves(node);
    if (book.length) s.hints = book.map(x => ({ move: x.move, rank: 1, color: '#7b5ea7', label: '📖', sub: '' }));
  }
  if (better && better.node === node) { s.better = better.move; s.pv = better.pv; }
  if (threat && threat.node === node && threat.move != null) { s.threat = threat.move; s.pv = threat.pv; s.pvAccent = '#ff8787'; }
  if (sh.feedback && node.grade && isGraded(node)) {
    const shown = levelGrade(node.grade, coachLevel(), factsFor(node));
    if (shown.key === 'mistake' || shown.key === 'blunder') s.grade = shown.color;
  }
  if (!s.pv) s.hover = hoverInfo();
  s.coord = hoverPt; // the square under the pointer or keyboard cursor, disc or not
  if (locatePt !== null) s.locate = locatePt;
  view.render(s);
}

function renderPlayers() {
  const b = game.board;
  for (const c of [BLACK, WHITE]) {
    const el = $(c === BLACK ? '#pBlack' : '#pWhite');
    el.querySelector('.pname').textContent = !settings.human ? colorName(c) : c === settings.human ? 'You' : puzzle ? colorName(c) : aiLabel();
    el.querySelector('.count').textContent = b.count(c);
    // With legal moves shown, each side's number of moves (mobility) too.
    const mob = el.querySelector('.mob');
    mob.hidden = !settings.show.moves || game.isOver();
    if (!mob.hidden) { const n = b.legalMoves(c).length; mob.textContent = `${n} ${n === 1 ? 'move' : 'moves'}`; }
    el.classList.toggle('turn', !game.isOver() && b.toPlay === c && !resigned);
    el.classList.toggle('thinking', !!aiNode && aiNode.board.toPlay === c);
  }
}

function openingTip() {
  if (!settings.human) return 'Study mode: you place discs for both colours. Turn on <b>Best moves</b> to compare your ideas with the coach.';
  const hc = game.handicap ? ` You start with ${plural(game.handicap, 'corner')} as a handicap: corners can never be flipped, so use them.` : '';
  if (settings.human === BLACK) return `Welcome! You are Black and move first. Click a square with a dot to place a disc: every move must trap a line of White's discs between your new disc and another of yours, and those discs flip to black. Take back any move with <kbd>U</kbd>.${hc}`;
  return `You are White. The AI (Black) moves first. Every move must trap a line of your opponent's discs, which then flip to your colour.${hc}`;
}

function scoreLine(an) {
  if (!an) return '&nbsp;';
  const lv = coachLevel();
  if (an.over) return '&nbsp;';
  if (an.exact) {
    const m = an.blackScore;
    return m === 0 ? 'Perfect play from here: <b>a draw</b>.' : `Perfect play from here: <b>${m > 0 ? 'Black' : 'White'} wins by ${Math.abs(m)}</b>.`;
  }
  if (lv === 'beginner') return '&nbsp;';
  const lead = Math.abs(Math.round(an.blackScore));
  return `Expected result: <b>${describeScore(an.blackScore)}</b>${lead ? ` <span class="muted">${lead === 1 ? 'disc' : 'discs'}</span>` : ''}`;
}

// On narrow screens the coach card is below the board: a badge beside the
// logo shows the grade of the player's latest move (study mode: the latest
// move's), and tapping it scrolls to the card. Hidden by CSS where the card
// is beside the board, and during puzzles (they have their own panel).
function renderBadge() {
  const el = $('#coachBadge'), cur = game.current;
  const node = !settings.human ? cur : [cur, cur.parent].find(n => n && n.parent && n.color === settings.human);
  const shows = settings.coach && settings.show.feedback && !puzzle && node && node.parent && node.move !== PASS && isGraded(node);
  if (!shows) { el.hidden = true; return; }
  const sq = sqName(node.move);
  const shown = node.grade && levelGrade(node.grade, coachLevel(), factsFor(node));
  const text = shown ? `${shown.label} · ${sq}` : 'grading…';
  const key = `${text}|${shown ? shown.color : ''}`;
  el.hidden = false;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.textContent = `${text} ↓`;
  el.classList.toggle('pending', !shown);
  el.style.setProperty('--pill', shown ? shown.color : '');
  el.setAttribute('aria-label', shown ? `Coach: ${shown.label} on ${sq}. Show the coach's comments.` : 'Coach: still grading your move. Show the coach.');
}

function renderCoach() {
  renderBadge();
  const node = game.current, an = node.analysis;
  $('#coachStatus').textContent = !settings.coach ? 'off' : game.isOver(node) ? '' :
    an ? `${an.exact ? 'solved' : `depth ${an.depth}`}${node.analysisDone ? '' : '…'}` : 'reading…';
  const bw = an ? an.blackWinrate : 0.5;
  $('#winB').style.width = `${(bw * 100).toFixed(1)}%`;
  $('#winLabelB').textContent = an ? `Black ${Math.round(bw * 100)}%` : 'Black';
  $('#winLabelW').textContent = an ? `${Math.round((1 - bw) * 100)}% White` : 'White';
  setHTML($('#scoreEst'), scoreLine(an));

  // The opening, while the game is in (or just left) the book.
  const op = openingOf(node);
  const showOp = op && (op.current || op.inBook || node.depth <= op.at.depth + 6);
  const opEl = $('#opening');
  setHTML(opEl, showOp ? `Opening: <b>${op.name}</b>${op.current || op.inBook ? '' : ' <span class="muted">(now out of book)</span>'}` : '');
  opEl.hidden = !showOp;

  // Feedback on the last two moves, so against the AI you see your own
  // move's grade as well as the reply.
  const fb = $('#feedback');
  const entries = [];
  if (node.parent && node.parent.parent && node.parent.move !== PASS) entries.push(node.parent);
  if (node.parent) entries.push(node);
  if (!puzzleSpoilersOk()) setHTML(fb, entries.length ? '<p class="muted">The coach keeps quiet until you solve the puzzle or ask for the answer.</p>' : '');
  else setHTML(fb, linkPoints(entries.length ? entries.map(moveEntry).join('') : puzzle ? '' : `<p class="tip">${openingTip()}</p>`));
  fb.onclick = e => {
    const btn = e.target.closest && e.target.closest('[data-act]');
    if (!btn) return;
    const target = entries.find(n => n.id === +btn.dataset.id);
    if (!target) return;
    if (btn.dataset.act === 'back') backToMine(target);
    if (btn.dataset.act === 'try') {
      // A mouse has already previewed it by pointing, and a keyboard by focusing: one
      // click plays. A tap (touch has no hover) first keeps the preview on and asks for a second.
      const touch = (e.pointerType || lastPointer) === 'touch';
      if (!touch || armed === target) { armed = null; tryInstead(target); return; }
      armed = target;
      peekAt(target);
      renderCoach();
      announce(`Coach's choice: ${sqName(peek.move)}${peek.pv.length > 1 ? ', then ' + peek.pv.slice(1, 4).map(m => sqName(m.move)).join(', ') : ''}. Press Play to play it.`);
    }
    if (btn.dataset.act === 'retry') retry(target);
    if (btn.dataset.act === 'reveal') reveal(target);
  };

  // Live notes about the position on the board.
  // (Not while a puzzle is unsolved: "You can take the a1 corner" gives it away.)
  const notes = !game.isOver(node) && !resigned && puzzleSpoilersOk() ? positionNotes(node.board, { who: c => who(c) }) : [];
  const warn = notes.map(w => `<li class="${w.kind}">${w.text}</li>`).join('');
  setHTML($('#warnings'), linkPoints(warn));
  // Screen readers and speech hear the notes too: once when they appear for a
  // position (redraws don't repeat them), and again on coming back to it.
  const warnKey = warn && `${node.id}|${warn}`;
  if (warnKey !== warningsSaid) {
    warningsSaid = warnKey;
    if (warn) announce(plainText(notes.map(w => w.text).join(' ')));
  }

  const tb = $('#threatBox');
  tb.hidden = !(threat && threat.node === node);
  if (!tb.hidden) {
    const oppName = !settings.human ? colorName(threat.opp) : threat.opp === settings.human ? 'you' : 'the AI';
    const meName = !settings.human ? colorName(threat.me) : threat.me === settings.human ? 'you' : 'the AI';
    if (threat.pending) setHTML(tb, 'Looking at the board from the opponent\'s side…');
    else if (threat.none) setHTML(tb, `If it were ${oppName === 'you' ? 'your' : `${oppName}'s`} move, ${oppName} would have no legal move here.`);
    else {
      const lines = describe(threat.facts.filter(f => ['corner', 'givesCorner', 'forcesPass', 'stable', 'wipeout', 'xsquare', 'blocksCorner'].includes(f.type)),
        { level: coachLevel(), mover: threat.opp, you: settings.human, intent: true });
      setHTML(tb, linkPoints(`<p><b>Their idea:</b> if it were ${oppName === 'you' ? 'your' : `${oppName}'s`} move, ${oppName} would play <b>${sqName(threat.move)}</b>.` +
        (threat.cost >= 2 && coachLevel() !== 'beginner' ? ` Letting ${oppName} play there first would cost ${meName} about <b>${plural(Math.round(threat.cost), 'disc')}</b>.` : '') + '</p>' +
        (lines.length ? `<ul class="explain">${lines.map(t => `<li>${t}</li>`).join('')}</ul>` : '') +
        '<p class="muted small">Numbered discs show how they expect it to continue. Press <kbd>O</kbd> again to hide.</p>'));
    }
  }
  holdCoachHeight();
}

// The Coach card only grows during a game: its text changes with every move,
// and a card that shrank and grew back would make everything below it jump.
// A new game or puzzle, or a change of window width, starts it afresh.
let coachHeight = 0;
function holdCoachHeight() {
  const card = $('.coach');
  coachHeight = Math.max(coachHeight, card.offsetHeight);
  card.style.minHeight = `${coachHeight}px`;
}
addEventListener('resize', () => { if (coachHeight) { resetCoachHeight(); renderCoach(); } });
function resetCoachHeight() {
  coachHeight = 0;
  $('.coach').style.minHeight = '';
}

function renderReview() {
  const el = $('#review'), level = coachLevel();
  const stats = {};
  for (const c of [BLACK, WHITE]) stats[c] = { n: 0, loss: 0, counts: {}, worst: [] };
  for (const n of game.line()) {
    const g = n.grade;
    if (!g || !isGraded(n)) continue;
    const s = stats[n.color], shown = levelGrade(g, level, factsFor(n));
    s.n++;
    s.loss += Math.min(g.ptLoss, 30);
    if (!shown.flagged) continue;
    s.counts[shown.key] = (s.counts[shown.key] || 0) + 1;
    if (shown.key !== 'inaccuracy') s.worst.push(n);
  }
  if (!stats[BLACK].n && !stats[WHITE].n) { setHTML(el, ''); return; }
  const row = c => {
    const s = stats[c];
    if (!s.n) return '';
    const pills = ['blunder', 'mistake', 'inaccuracy'].filter(k => s.counts[k])
      .map(k => `<span class="pill" style="--pill:${GRADES[k].color}">${plural(s.counts[k], gradeLabel(k, level).toLowerCase())}</span>`).join(' ');
    const loss = s.loss / s.n;
    const avg = level === 'beginner' ? '' : `<span class="muted">${loss < 0.05 ? 'no discs lost' : `loses ${loss.toFixed(1)} discs/move`}</span>`;
    return `<div class="rv-row"><span class="disc-icon ${c === BLACK ? 'black' : 'white'}"></span><b>${who(c)}</b>` +
      `${avg}${pills || '<span class="muted">no mistakes yet</span>'}</div>`;
  };
  const worst = [...stats[BLACK].worst, ...stats[WHITE].worst].sort((a, b) => b.grade.ptLoss - a.grade.ptLoss).slice(0, 5);
  const chip = n => `<button class="chip" data-id="${n.id}" data-pt="${n.move}" title="Jump to this move">#${n.depth} ${sqName(n.move)}${level === 'beginner' ? '' : ` −${Math.round(n.grade.ptLoss)}`}</button>`;
  setHTML(el, linkPoints(row(BLACK) + row(WHITE) + (worst.length ? `<div class="rv-worst"><span class="muted">Biggest:</span>${worst.map(chip).join('')}</div>` : '')) + keyMomentsHtml());
  el.onclick = e => {
    const c = e.target.closest && e.target.closest('[data-id]');
    const node = c && game.line().find(n => n.id === +c.dataset.id);
    if (node) goTo(node);
  };
}

function moveEntry(node) {
  const latest = node === game.current;
  const head = pill => `<div class="fb-head">${pill}<span><b>${who(node.color)}</b> ${node.move === PASS ? 'passed' : `played <b>${sqName(node.move)}</b>`}</span></div>`;
  const wrap = html => `<div class="fb-entry${latest ? ' latest' : ''}">${html}</div>`;
  const list = lines => lines.length ? `<ul class="explain">${lines.map(t => `<li>${t}</li>`).join('')}</ul>` : '';
  if (node.move === PASS) return wrap(head('') + `<p class="muted">No legal move, so a pass.</p>`);
  const level = coachLevel();
  // The opening has its own line above.
  const facts = factsFor(node).filter(f => f.type !== 'opening');
  const ctx = { level, mover: node.color, you: settings.human };
  // Ungraded (AI) moves: just what the player has to react to.
  if (!isGraded(node)) return wrap(head('') + list(describeNote(facts, ctx)));
  const g = node.grade;
  let html;
  if (!settings.show.feedback) html = head('');
  else if (!g) html = head('<span class="pill pending">grading…</span>');
  else {
    ctx.shown = levelGrade(g, level, facts);
    ctx.resultSaid = verdictSaysResult(g, level, ctx.shown);
    const pill = `<span class="pill" style="--pill:${ctx.shown.color}">${ctx.shown.label}</span>`;
    if (findIt(node, ctx.shown)) {
      html = head(pill) + '<p>There was something better here. Can you find it?</p>' +
        `<div class="fb-actions"><button data-act="retry" data-id="${node.id}">Try again</button><button data-act="reveal" data-id="${node.id}">Show answer</button></div>`;
      return wrap(html + list(hideAnswer(describe(facts, ctx), answerSquares(node))));
    }
    html = head(pill) + `<p>${found(node, ctx.shown) ? '<b>You found it!</b> ' : ''}${verdict(g, level, ctx.shown)}</p>`;
    if (g.grade !== 'best' && g.bestMove !== PASS && g.ptLoss > 0) {
      html += `<div class="fb-actions"><button data-act="try" data-id="${node.id}">${armed === node ? `Play ${sqName(g.bestMove)}` : `Try ${sqName(g.bestMove)} instead`}</button></div>`;
    }
  }
  if (node.backTo && !resigned) html += `<div class="fb-actions"><button data-act="back" data-id="${node.id}">Back to my move (${sqName(node.backTo.move)})</button></div>`;
  const lines = describe(facts, ctx);
  const missed = g && ctx.shown && ctx.shown.flagged ? tookNext(node) : null;
  if (missed != null) lines.unshift(missedLine(missed, ctx));
  return wrap(html + list(lines));
}

// Find it yourself: the player's Mistake or Blunder against the AI, with the
// coach's move hidden until they ask (Show answer) or find a good move.
const findIt = (node, shown) => settings.findYourself && !!settings.human && node.color === settings.human
  && !node.revealed && !resigned && !puzzle && (shown.key === 'mistake' || shown.key === 'blunder');
// The coach's move, and any move just as good: what the coach mustn't name.
function answerSquares(node) {
  const g = node.grade, an = node.parent.analysis;
  const top = an && an.moves.find(m => m.move === g.bestMove);
  const equal = top && !top.bound ? an.moves.filter(m => m.score === top.score && !m.bound).map(m => m.move) : [];
  return [...new Set([g.bestMove, ...equal])].filter(q => q !== PASS);
}
// A Good or Best move played from a position the player went back to with Try
// again, without being shown the answer (Show answer, Try instead, a hint or
// the "AI move" button all mark the position as helped).
const found = (node, shown) => !!(node.parent && node.parent.retry && !node.parent.helped) && (shown.key === 'best' || shown.key === 'good');

function retry(node) {
  node.parent.retry = true;
  goTo(node.parent, { verdict: false });
  flash('Find a better move here.');
}

function reveal(node) {
  node.revealed = true;
  node.parent.helped = true;
  render();
  const level = coachLevel(), shown = levelGrade(node.grade, level, factsFor(node));
  announce(plainText(`Coach: ${verdict(node.grade, level, shown)}`));
}

// After a finished game against the AI, the few of the player's mistakes most
// worth a look (coach.js keyMoments), as a list of moves to jump to. Each says
// how big it was and why, without naming the coach's move: that's left to find
// on the move's own card. '' while there's no finished game.
function keyMomentsHtml() {
  if (!settings.coach || gameOutcome() === null) return '';
  const level = coachLevel();
  const mine = game.line().filter(n => n.parent && n.move !== PASS && n.color === settings.human && isGraded(n));
  if (!mine.length) return '';
  const waiting = mine.filter(n => !n.grade).length;
  const bad = mine.filter(n => n.grade && ['mistake', 'blunder'].includes(levelGrade(n.grade, level, factsFor(n)).key));
  const picks = keyMoments(bad.map(n => ({ depth: n.depth, ptLoss: n.grade.ptLoss, node: n })));
  const item = ({ node: n, turning }) => {
    const shown = levelGrade(n.grade, level, factsFor(n));
    const discs = Math.max(1, Math.round(n.grade.ptLoss));
    const size = level === 'beginner' ? shown.label : `lost about ${plural(discs, 'disc')}`;
    const why = hideAnswer(mistakeLines(factsFor(n), { level, mover: n.color, you: settings.human, shown }), answerSquares(n))[0];
    return `<li><button class="chip" data-id="${n.id}" data-pt="${n.move}" title="Jump to this move">Move ${n.depth} · ${sqName(n.move)}</button>` +
      `${turning ? ' <b>Turning point.</b>' : ''} ${capital(size)}.${why ? ` <span class="muted">${why}</span>` : ''}</li>`;
  };
  const body = picks.length ? `<ul>${picks.map(item).join('')}</ul>`
    : !waiting ? '<p>No big mistakes this game. Nicely played.</p>' : '';
  const more = waiting ? `<p class="muted">The coach is still grading ${plural(waiting, 'move')}…</p>` : '';
  return linkPoints(`<div class="key-moments"><h3>Key moments</h3>${body}${more}</div>`);
}

// The finished game's result for the player: 1 won, -1 lost, 0 drawn, null
// when there's no finished game against the AI (still playing, study mode, a puzzle).
function gameOutcome() {
  if (!settings.human || puzzle) return null;
  if (resigned) return resigned === settings.human ? -1 : 1;
  const end = game.line().at(-1);
  if (!game.isOver(end)) return null;
  const s = game.score(end);
  return !s.winner ? 0 : s.winner === settings.human ? 1 : -1;
}

// The level the next game starts at: one step along the ladder from a finished game.
function ladderLevel() {
  const o = settings.ladder ? gameOutcome() : null;
  return o === null ? settings.level : nextLevel(settings.level, o).level;
}

// What the ladder does after this game, as a sentence ('' with it off or no finished game).
function ladderSentence() {
  const o = settings.ladder ? gameOutcome() : null;
  if (o === null) return '';
  const { level: n, step } = nextLevel(settings.level, o);
  const name = `level ${n + 1} · ${LEVELS[n].name}`;
  return {
    up: `Next game: ${name}, one step up.`,
    down: `Next game: ${name}, one step down.`,
    same: `Next game: ${name} again.`,
    top: `You beat ${LEVELS[n].name}, the strongest level!`,
    bottom: `Next game: ${name} again. Handicap corners (in New game) make it easier still.`,
  }[step];
}

// Below the result: where the ladder goes next, or with the ladder off, a
// better-matched opponent after a lopsided game. margin is black-minus-white.
function nextGameNote(margin) {
  if (!settings.ladder) return levelAdvice(margin);
  const next = ladderSentence();
  return next ? `<p class="advice">${next}</p>` : '';
}

// The square node's move missed, when the opponent played it next on the line.
// Null otherwise.
function tookNext(node) {
  const next = node.lastChild || node.children[0], g = node.grade;
  if (!next || !g || g.bestMove === PASS || next.color === node.color) return null;
  return next.move === g.bestMove ? next.move : null;
}

// Suggests a better-matched opponent after a lopsided game. margin is black-minus-white.
function levelAdvice(margin) {
  if (!settings.human) return '';
  const mine = margin * (settings.human === BLACK ? 1 : -1), lv = settings.level;
  if (mine >= 20 && lv < LEVELS.length - 1) {
    return `<p class="advice">Comfortable win! Try level ${lv + 2} · ${LEVELS[lv + 1].name} next (Settings → AI strength).</p>`;
  }
  if (mine <= -30 && lv > 0) {
    return `<p class="advice">A tough one. Level ${lv} · ${LEVELS[lv - 1].name}, or a corner or two as a handicap, may be more fun for learning.</p>`;
  }
  return '';
}

function renderScorePanel() {
  const el = $('#scorePanel');
  const node = game.current, over = game.isOver(node);
  if (!over && !resigned) { el.hidden = true; return; }
  el.hidden = false;
  if (resigned) {
    setHTML(el, `<h2>${colorName(resigned)} resigned</h2><p class="big">${resigned === settings.human ? 'The AI wins this one.' : 'You win!'}</p>${nextGameNote(resigned === BLACK ? -99 : 99)}${keyMomentsHtml()}
      <div class="fb-actions"><button data-act="new" class="primary">New game</button></div>`);
  } else {
    const s = game.score(node);
    const winText = !s.winner ? 'A draw!' : !settings.human ? `${colorName(s.winner)} wins.` :
      s.winner === settings.human ? 'You win! 🎉' : 'The AI wins this one.';
    setHTML(el, `<h2>Game over · ${s.final[0]}–${s.final[1]}</h2>
      <p class="big">${winText}</p>${nextGameNote(s.margin)}${keyMomentsHtml()}
      <table class="score-table">
        <tr><th></th><th>Black</th><th>White</th></tr>
        <tr><td>Discs</td><td>${s.black}</td><td>${s.white}</td></tr>${s.empty ? `
        <tr><td>Empty squares (to the winner)</td><td>${s.winner === BLACK ? s.empty : s.winner ? '' : s.empty / 2}</td><td>${s.winner === WHITE ? s.empty : s.winner ? '' : s.empty / 2}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td>${s.final[0]}</td><td>${s.final[1]}</td></tr>
      </table>
      <div class="fb-actions"><button data-act="review">Review the game</button><button data-act="new" class="primary">New game</button></div>`);
  }
  el.onclick = e => {
    const act = e.target.dataset && e.target.dataset.act;
    const moment = !act && e.target.closest && e.target.closest('[data-id]');
    const node = moment && game.line().find(n => n.id === +moment.dataset.id);
    if (node) { goTo(node); return; }
    if (act === 'review') { goTo(game.root); flash('Review: step through with ◀ ▶ or click the graph. Dots mark mistakes.'); }
    if (act === 'new') openNewGame();
  };
}

function renderNav() {
  const node = game.current;
  $('#moveLabel').textContent = node.parent ? `Move ${node.depth} · ${colorName(node.color)} ${sqName(node.move)}` : 'Start';
  $('[data-nav=first]').disabled = $('[data-nav=prev]').disabled = !node.parent;
  $('[data-nav=next]').disabled = $('[data-nav=last]').disabled = !node.children.length;
  $('#btnAI').disabled = !!aiNode || game.isOver() || !!resigned || !!puzzle;
  $('#btnResign').disabled = game.isOver() || !settings.human || !!resigned || !!puzzle;
  $('#btnHint').disabled = !!puzzle && !puzzleSpoilersOk();
  $('#btnPuzzle').classList.toggle('on', !!puzzle);
  $('#btnUndo').disabled = puzzle ? !game.current.parent : !node.parent && !resigned;
  $('#btnHint').classList.toggle('on', hintOn);
  $('#btnThreat').classList.toggle('on', !!threat && threat.node === node);
  $('#btnThreat').disabled = game.isOver();

  let html = '';
  const sibs = node.parent ? node.parent.children : [];
  if (sibs.length > 1) {
    html += `<span class="muted">Variations:</span>` + sibs.map((s, i) =>
      `<button class="chip${s === node ? ' on' : ''}" data-id="${s.id}">${i === 0 ? '★ ' : ''}${sqName(s.move)}</button>`).join('');
  }
  if (node.children.length > 1) {
    html += `<span class="muted">Continue with:</span>` + node.children.map(s =>
      `<button class="chip" data-id="${s.id}">${sqName(s.move)}</button>`).join('');
  }
  const v = $('#variations');
  setHTML(v, html);
  v.onclick = e => {
    const id = +(e.target.dataset && e.target.dataset.id);
    const target = [...sibs, ...node.children].find(n => n.id === id);
    if (target) goTo(target);
  };
}

function renderStatus() {
  const el = $('#message');
  let text = '', kind = '';
  const node = game.current;
  const h = hoverPt !== null ? hoverInfo() : null;
  if (peek) text = `Coach's choice: ${sqName(peek.move)}. Numbered discs show how play would go on.`;
  else if (h && !h.ok && !hoverByKey) { text = reasonText(h.reason); kind = 'bad'; }
  else if (flashMsg) { text = flashMsg.text; kind = flashMsg.kind; }
  else if (puzzle && puzzle.status === 'solving' && game.current === game.root) text = prompt(puzzle.p);
  else if (puzzle && puzzle.status !== 'solving') text = puzzle.status === 'correct' ? 'Solved! Press "Next puzzle" for another, or keep exploring.' : 'Not quite. Try again, or ask for a hint.';
  else if (puzzle) text = `${colorName(node.board.toPlay)} to play.`;
  else if (aiNode) text = aiBest ? 'Finding the best move…' : `${aiLabel()} is thinking…`;
  else if (resigned) text = `${colorName(resigned)} resigned.`;
  else if (game.isOver(node)) text = 'Neither player can move. The game is over.';
  else if (node.board.mustPass) text = `${colorName(node.board.toPlay)} has no legal move and must pass.`;
  else {
    // Short, so the line never wraps further and moves the controls below it.
    const earlier = node.children.length ? 'Earlier position · ' : '';
    const c = node.board.toPlay;
    text = earlier + (!settings.human ? `${colorName(c)} to play.` : c === settings.human ? `Your move (${colorName(c)}).` : `AI's move (${colorName(c)}).`);
  }
  if (el.textContent !== text) el.textContent = text; // aria-live: don't re-announce on every hover
  el.className = `message ${kind}`;
}

// ------------------------------------------------------------------ puzzles

function enterPuzzles() {
  resetCoachHeight();
  let i = nextPuzzle(puzzleProgress.solved, puzzleProgress.difficulty, puzzleProgress.last);
  if (i == null) { puzzleProgress.difficulty = 0; i = nextPuzzle(puzzleProgress.solved, 0, -1); }
  if (i == null) { flash('No puzzles here yet.'); return; }
  cancelAI();
  stopCoach();
  puzzle = { saved: { game, human: settings.human, resigned } };
  resigned = 0;
  startPuzzle(i);
}

function startPuzzle(i) {
  resetCoachHeight();
  if (i == null) { flash('No puzzles at that difficulty.'); return; }
  cancelAI();
  stopCoach();
  const p = puzzleAt(i);
  puzzleProgress.last = i;
  puzzle = { ...puzzle, p, status: 'solving', lines: [], reveal: [], hint: false, shown: false };
  const b = p.board;
  game = new Game({ setup: [...b.color].flatMap((c, q) => c ? [[q, c]] : []), toPlay: b.toPlay });
  settings.human = b.toPlay;
  better = null; peek = null; armed = null; hintOn = false; threat = null; overShown = null;
  afterChange();
  announce(`Puzzle. ${prompt(p)}`);
}

function puzzleAnswered(move) {
  const r = judge(puzzle.p, move, coachLevel());
  puzzle.status = r.correct ? 'correct' : 'wrong';
  puzzle.lines = r.lines;
  puzzle.reveal = r.reveal;
  if (r.correct && !puzzle.shown) puzzleProgress.solved.add(puzzle.p.id);
  playSound(r.correct ? 'win' : 'lose');
  announce(r.correct ? `Correct! ${plainText(r.lines.join(' '))}` : `Not the best move. ${plainText(r.lines.join(' '))}`);
}

function retryPuzzle() {
  cancelAI();
  game.goTo(game.root);
  puzzle.status = 'solving';
  puzzle.lines = [];
  better = null; peek = null; armed = null; threat = null;
  save(); render(); scheduleCoach();
}

function showPuzzleAnswer() {
  retryPuzzle();
  puzzle.shown = true;
  const m = puzzle.p.answers[0];
  better = { node: game.root, move: m, pv: [] };
  flash(`The answer: ${sqName(m)}. Play it to see why.`);
  render();
}

// Carries on from the puzzle's position as a game against the AI. It takes
// the place of the game that was in progress.
function playOutPuzzle() {
  if (!puzzle) return;
  const side = puzzle.p.board.toPlay;
  cancelAI();
  stopCoach();
  puzzle = null;
  settings.human = side;
  resigned = 0; better = null; peek = null; armed = null; hintOn = false; threat = null; overShown = null;
  syncOptions();
  flash(`Playing it out against ${aiLabel()}. Take back or start a new game any time.`);
  afterChange();
}

function leavePuzzles() {
  resetCoachHeight();
  if (!puzzle) return;
  cancelAI();
  stopCoach();
  game = puzzle.saved.game;
  settings.human = puzzle.saved.human;
  resigned = puzzle.saved.resigned;
  puzzle = null;
  better = null; peek = null; armed = null; hintOn = false; threat = null;
  syncOptions();
  afterChange();
}

// In a puzzle, the coach keeps the answer to itself until it's solved or shown.
const puzzleSpoilersOk = () => !puzzle || puzzle.status === 'correct' || puzzle.shown;

function renderPuzzle() {
  const el = $('#puzzlePanel');
  el.hidden = !puzzle;
  if (!puzzle) return;
  const p = puzzle.p, pr = puzzleProgress;
  const solved = solvedCount(pr.solved);
  const diffs = [0, 1, 2, 3].map(d => `<option value="${d}"${d === pr.difficulty ? ' selected' : ''}>${d ? DIFFICULTY[d] : 'All levels'}</option>`).join('');
  let body = '';
  if (puzzle.status === 'solving') {
    body = `<p class="big">${prompt(p)}</p>` +
      (puzzle.hint ? `<p class="hint-line">💡 ${THEME_HINTS[p.theme] || THEME_HINTS.best}</p>` : '') +
      `<div class="fb-actions"><button data-act="hint"${puzzle.hint ? ' disabled' : ''}>Hint</button><button data-act="answer">Show answer</button><button data-act="next">Skip</button></div>`;
  } else {
    const ok = puzzle.status === 'correct';
    const answers = p.answers.map(m => `<b>${sqName(m)}</b>`).join(' or ');
    body = `<p class="big ${ok ? 'good' : 'bad'}">${ok ? '✓ Correct!' : '✗ Not the best move.'}</p>` +
      (ok ? `<p>${THEME_NAMES[p.theme] || ''}${p.exact ? ' · worked out exactly' : ''}.</p>` : puzzle.shown ? `<p>The answer is ${answers}.</p>` : '') +
      (puzzle.lines.length ? `<ul class="explain">${puzzle.lines.map(t => `<li>${t}</li>`).join('')}</ul>` : '') +
      (ok || puzzle.shown ? `<p class="lesson">${THEME_LESSONS[p.theme] || THEME_LESSONS.best}</p>` : '') +
      (!ok && puzzle.shown && puzzle.reveal.length ? `<ul class="explain">${puzzle.reveal.map(t => `<li>${t}</li>`).join('')}</ul>` : '') +
      (!ok && !puzzle.shown && !puzzle.lines.length ? '<p class="muted">There\'s a better move here. Try again, or ask for a hint.</p>' : '') +
      `<div class="fb-actions">${ok ? '' : `<button data-act="retry">Try again</button>${puzzle.hint ? '' : '<button data-act="hint">Hint</button>'}${puzzle.shown ? '' : '<button data-act="answer">Show answer</button>'}`}<button data-act="next" class="primary">Next puzzle</button>` +
      (ok || puzzle.shown ? `<button data-act="playout" title="Continue from here against the AI (${LEVELS[settings.level].name}). This replaces your game in progress.">Play it out vs AI</button>` : '') + '</div>' +
      (!ok && puzzle.hint ? `<p class="hint-line">💡 ${THEME_HINTS[p.theme] || THEME_HINTS.best}</p>` : '');
  }
  setHTML(el, linkPoints(`<h2>Puzzle · ${DIFFICULTY[p.difficulty]} <span class="muted small">${solved} solved of ${PUZZLE_TOTAL}</span></h2>` + body +
    `<div class="pz-foot"><label>Show <select data-act="difficulty">${diffs}</select></label><button data-act="leave">Back to my game</button></div>`));
  el.onclick = e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'hint') { puzzle.hint = true; announce(THEME_HINTS[p.theme] || THEME_HINTS.best); render(); }
    if (act === 'answer') { if (puzzle.status === 'wrong') { puzzle.shown = true; render(); } else showPuzzleAnswer(); }
    if (act === 'retry') retryPuzzle();
    if (act === 'next') startPuzzle(nextPuzzle(puzzleProgress.solved, puzzleProgress.difficulty, p.index));
    if (act === 'leave') leavePuzzles();
    if (act === 'playout') playOutPuzzle();
  };
  el.onchange = e => {
    if (e.target.dataset.act !== 'difficulty') return;
    puzzleProgress.difficulty = +e.target.value;
    save();
    startPuzzle(nextPuzzle(puzzleProgress.solved, puzzleProgress.difficulty, -1));
  };
}

// ------------------------------------------------------------------ persistence

// Child-index path from the root to node.
const pathOf = node => { const p = []; for (let n = node; n.parent; n = n.parent) p.unshift(n.parent.children.indexOf(n)); return p; };

// The browser's storage, reached only through this (storage.js): a stand-in
// in memory when it's blocked, and whether writes are being kept.
const storage = safeStorage(() => localStorage);

function save() {
  let written = true;
  try {
    // In puzzle mode the game to come back to is saved, not the puzzle.
    const g = puzzle ? puzzle.saved.game : game, st = puzzle ? { ...settings, human: puzzle.saved.human } : settings;
    storage.setItem(STORE, JSON.stringify({ settings: st, text: g.toText(), path: pathOf(g.current), resigned: puzzle ? puzzle.saved.resigned : resigned }));
    storage.setItem(PUZZLE_STORE, JSON.stringify({ solved: [...puzzleProgress.solved], difficulty: puzzleProgress.difficulty, last: puzzleProgress.last }));
    written = storage.durable;
  } catch { written = false; }
  kept(written);
}

// Autosave that isn't happening is said: a line under Save game / Load game
// while writes fail (and once in the status line when it starts); it goes
// away when a later write works.
let notSaved = false;
function kept(written) {
  if (written === !notSaved) return;
  notSaved = !written;
  $('#saveNote').hidden = written;
  if (notSaved) flash('Your game is not being saved in this browser. Use Save game to keep it.', 'bad');
}

function loadPuzzleProgress() {
  try {
    const d = JSON.parse(storage.getItem(PUZZLE_STORE));
    if (d) puzzleProgress = { solved: new Set(d.solved || []), difficulty: [0, 1, 2, 3].includes(d.difficulty) ? d.difficulty : 0, last: d.last ?? -1 };
  } catch { /* none saved */ }
}

function load() {
  try {
    const d = JSON.parse(storage.getItem(STORE));
    if (!d) return false;
    settings = { ...structuredClone(DEFAULTS), ...d.settings, show: { ...DEFAULTS.show, ...(d.settings && d.settings.show) } };
    settings.level = Math.min(LEVELS.length - 1, Math.max(0, settings.level | 0));
    if (!COACH_DEPTHS[settings.coachDepth]) settings.coachDepth = DEFAULTS.coachDepth;
    settings.gradeAI = !!settings.gradeAI;
    settings.findYourself = !!settings.findYourself;
    settings.ladder = !!settings.ladder;
    settings.speak = !!settings.speak;
    if (!COACH_FOR.some(o => o.key === settings.coachFor)) settings.coachFor = DEFAULTS.coachFor;
    if (![0, BLACK, WHITE].includes(settings.human)) settings.human = DEFAULTS.human;
    if (![0, 1, 2, 3, 4].includes(settings.handicap)) settings.handicap = DEFAULTS.handicap;
    game = Game.fromText(d.text || '');
    let n = game.root;
    for (const i of d.path || []) { if (!n.children[i]) break; n = n.children[i]; }
    game.goTo(n);
    resigned = d.resigned || 0;
    overShown = game.isOver() ? game.current : null; // don't cheer again on reload
    return true;
  } catch (e) {
    console.warn('Could not restore saved game', e);
    return false;
  }
}

function exportGame() {
  const name = c => !settings.human ? colorName(c) : c === settings.human ? 'Human' : `Reversiology ${level().name}`;
  const end = game.line().at(-1);
  const s = game.isOver(end) ? game.score(end) : null;
  const head = [`# Reversiology game, ${new Date().toISOString().slice(0, 10)}`, `# Black: ${name(BLACK)}`, `# White: ${name(WHITE)}`];
  if (resigned) head.push(`# Result: ${colorName(resigned)} resigned`);
  else if (s) head.push(`# Result: ${s.final[0]}-${s.final[1]}`);
  head.push(`# Main line: ${game.transcript()}`);
  const text = `${head.join('\n')}\n${game.toText()}\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `reversiology-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importGame(text) {
  try {
    const g = Game.fromText(text);
    cancelAI();
    stopCoach();
    // Loading a game leaves the puzzles: the loaded game replaces the one they'd return to.
    puzzle = null; hintOn = false;
    game = g;
    resetCoachHeight();
    settings.human = 0;
    resigned = 0; better = null; peek = null; armed = null; threat = null; overShown = null;
    syncOptions();
    flash('Game loaded in study mode (you play both colours). Step through it and watch the coach.');
    afterChange();
  } catch (e) {
    flash(`Could not load that game: ${e.message}`, 'bad');
  }
}

// ------------------------------------------------------------------ dialogs & controls

function openNewGame() {
  const dlg = $('#newGameDlg'), f = dlg.querySelector('form');
  f.elements.color.value = String(settings.human);
  f.elements.level.value = String(ladderLevel()); // a finished game moves the ladder
  f.elements.handicap.value = String(settings.handicap);
  dlg.returnValue = ''; // Esc keeps the previous returnValue, which would re-run newGame()
  dlg.showModal();
}

function setupDialog() {
  $('#levelList').innerHTML = LEVELS.map((l, i) =>
    `<label class="level"><input type="radio" name="level" value="${i}"><span><b>${i + 1} · ${l.name}</b><small>${l.blurb}</small></span></label>`).join('');
  const dlg = $('#newGameDlg'), f = dlg.querySelector('form');
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    settings.human = +f.elements.color.value;
    settings.level = +f.elements.level.value;
    settings.handicap = +f.elements.handicap.value;
    syncOptions();
    newGame();
  });
}

function syncOptions() {
  $('#optLevel').value = String(settings.level);
  $('#optCoach').value = settings.coachDepth;
  $('#optCoachFor').value = settings.coachFor;
  $('#optGradeAI').checked = settings.gradeAI;
  $('#optFindYourself').checked = settings.findYourself;
  $('#optLadder').checked = settings.ladder;
  $('#optSpeak').checked = settings.speak;
  $('#optSound').checked = settings.sound;
  $('#toggles').querySelectorAll('input').forEach(i => { i.checked = !!settings.show[i.dataset.key]; });
}

function setupControls() {
  $('#toggles').innerHTML = TOGGLES.map(([key, label, help, k]) =>
    `<label class="toggle"><input type="checkbox" data-key="${key}"><span class="sw" aria-hidden="true"></span>` +
    `<span class="tl">${label} <kbd>${k}</kbd></span><small>${help}</small></label>`).join('');
  $('#toggles').addEventListener('change', e => {
    const key = e.target.dataset.key;
    if (!key) return;
    settings.show[key] = e.target.checked;
    save(); render();
  });
  $('#optLevel').innerHTML = LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('');
  $('#optLevel').onchange = e => { settings.level = +e.target.value; save(); render(); };
  $('#optCoach').onchange = e => {
    settings.coachDepth = e.target.value;
    stopCoach();
    rereadAll();
    save(); render(); scheduleCoach();
  };
  $('#optCoachFor').innerHTML = COACH_FOR.map(o => `<option value="${o.key}">${o.label}</option>`).join('');
  $('#optCoachFor').onchange = e => { settings.coachFor = e.target.value; save(); render(); };
  $('#optGradeAI').onchange = e => {
    settings.gradeAI = e.target.checked;
    for (const n of game.line()) tryGrade(n);
    save(); render(); scheduleCoach();
  };
  $('#optFindYourself').onchange = e => { settings.findYourself = e.target.checked; save(); render(); };
  $('#coachBadge').onclick = () => $('.coach').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#optLadder').onchange = e => { settings.ladder = e.target.checked; save(); render(); };
  $('#optSound').onchange = e => { settings.sound = e.target.checked; setSoundEnabled(settings.sound); save(); if (settings.sound) playSound('disc'); };
  $('#optSpeak').onchange = e => { settings.speak = e.target.checked; setSpeech(settings.speak); save(); announce(settings.speak ? 'Speech on.' : 'Speech off.'); };
  if (!speechAvailable()) { $('#optSpeak').disabled = true; $('#speakNote').hidden = false; }
  // Hovering (or focusing) a square the coach mentions circles it on the board.
  const locate = p => { if (p !== locatePt) { locatePt = p; renderBoard(); } };
  const ptOf = el => { const t = el && el.closest ? el.closest('[data-pt]') : null; return t ? +t.dataset.pt : null; };
  // Pointing at (or tabbing to) a Try button previews the coach's move on the board.
  const tryOf = el => el && el.closest ? el.closest('[data-act=try]') : null;
  const peekFrom = btn => {
    const node = btn ? nodeById(+btn.dataset.id) : null;
    // A preview kept on by a first tap stays until it's ended (a tap elsewhere, a move, Esc):
    // pointing at or focusing anything else in the panel doesn't change it.
    if (ending || (armed && node !== armed)) return;
    peekAt(node);
  };
  const fbox = $('#feedback');
  fbox.addEventListener('pointerover', e => peekFrom(tryOf(e.target)));
  fbox.addEventListener('pointerout', e => { if (!armed && !tryOf(e.relatedTarget)) peekFrom(null); });
  fbox.addEventListener('focusin', e => {
    peekFrom(tryOf(e.target));
    if (peek) announce(`Coach's choice: ${sqName(peek.move)}${peek.pv.length > 1 ? ', then ' + peek.pv.slice(1, 4).map(m => sqName(m.move)).join(', ') : ''}.`);
  });
  fbox.addEventListener('focusout', e => { if (!armed && !tryOf(e.relatedTarget)) peekFrom(null); });
  // A tap outside the armed Try button ends its preview; one on the board plays nothing.
  document.addEventListener('keydown', () => { lastPointer = ''; }, true);
  document.addEventListener('pointerdown', e => {
    lastPointer = e.pointerType;
    swallowClick = false;
    if (!armed || (e.target.closest && e.target.closest('[data-act=try]'))) return;
    disarm();
    if (e.target.closest && e.target.closest('.board-svg')) swallowClick = true;
  }, true);
  for (const id of ['#feedback', '#warnings', '#threatBox', '#review']) {
    const box = $(id);
    box.addEventListener('pointerover', e => locate(ptOf(e.target)));
    box.addEventListener('pointerout', e => { if (ptOf(e.relatedTarget) === null) locate(null); });
    box.addEventListener('focusin', e => locate(ptOf(e.target)));
    box.addEventListener('focusout', () => locate(null));
  }

  $('#btnUndo').onclick = takeBack;
  $('#btnHint').onclick = () => {
    hintOn = !hintOn;
    if (hintOn && !game.current.analysis) flash('The coach is still reading this position…');
    render();
  };
  $('#btnAI').onclick = () => aiMove(true, true);
  $('#btnThreat').onclick = toggleThreat;
  $('#btnResign').onclick = resign;
  $('#btnNew').onclick = () => { if (puzzle) leavePuzzles(); openNewGame(); };
  $('#btnPuzzle').onclick = () => puzzle ? leavePuzzles() : enterPuzzles();
  $('#btnExport').onclick = exportGame;
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async e => {
    const file = e.target.files[0];
    if (file) importGame(await file.text());
    e.target.value = '';
  };
  document.querySelectorAll('[data-nav]').forEach(btn => { btn.onclick = () => nav(btn.dataset.nav); });

  const toggleKey = Object.fromEntries(TOGGLES.map(([key, , , k]) => [k.toLowerCase(), key]));
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element) {
      // Leave typing alone, but a focused toggle or select must not swallow the game shortcuts.
      if (e.target.closest('textarea, dialog, input:not([type=checkbox]):not([type=radio])')) return;
      if (e.target.closest('select') && /^(Arrow|Home|End|Enter| )/.test(e.key)) return;
    }
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') nav('prev');
    else if (e.key === 'ArrowRight') nav('next');
    else if (e.key === 'Home') nav('first');
    else if (e.key === 'End') nav('last');
    else if (e.key === 'PageUp') nav('prev');
    else if (e.key === 'PageDown') nav('next');
    else if (k === 's') { if (!$('#optSpeak').disabled) $('#optSpeak').click(); }
    else if (k === 'r') repeatLast();
    else if (k === 'u' || e.key === 'Backspace') takeBack();
    else if (k === 'h') $('#btnHint').click();
    else if (k === 'o') toggleThreat();
    else if (e.key === 'Escape') { better = null; peek = null; armed = null; hintOn = false; threat = null; scout.cancel(); render(); }
    else if (toggleKey[k]) {
      const key = toggleKey[k];
      settings.show[key] = !settings.show[key];
      syncOptions(); save(); render();
    } else return;
    e.preventDefault();
  });
}

// ------------------------------------------------------------------ boot

initAnnouncer($('#announcer'));
setupControls();
setupDialog();
if (!load()) game = new Game();
loadPuzzleProgress();
setSoundEnabled(settings.sound);
setSpeech(settings.speak);
syncOptions();
afterChange();
kept(storage.durable); // storage that keeps nothing is said from the start

// Handy for debugging from the console, and for tests.
window.reversi = {
  get game() { return game; },
  get settings() { return settings; },
  get aiThinking() { return !!aiNode; },
  get storage() { return storage; },
  get notSaved() { return notSaved; },
  // The Try preview: on, and kept on by a first tap (armed).
  get preview() { return { on: !!peek, armed: !!armed }; },
  get coachBusy() { return coach.busy; },
  render, aiMove,
  // Test hooks: play by name ("d3"), take back, start a game with options.
  play: name => onClick(parseSq(name)),
  takeBack,
  // Sound tweaking: reversi.sounds.disc = new reversi.ZZFXSound([...]); reversi.playSound('disc')
  sounds: SOUNDS, playSound, ZZFXSound,
  newGame: (opts = {}) => { Object.assign(settings, opts); syncOptions(); newGame(); },
};
