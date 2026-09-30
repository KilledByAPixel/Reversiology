import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, BLACK, WHITE, PASS, parseSq, sqName } from '../src/board.js';
import { Game } from '../src/game.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { annotate, gradeMove, winChance, openingOf, bookMoves, hintList, describeScore } from '../src/coach.js';
import { moveFacts, nodeFacts } from '../src/explain.js';
import { describe, describeNote, verdict, levelGrade, positionNotes } from '../src/wording.js';
import { stableDiscs, frontierDiscs, dangerSquares, emptyRegions } from '../src/concepts.js';
import { linkPoints, pointReadout, resultPhrase } from '../src/access.js';
import { loadWeights } from '../tools/weights-io.js';

const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const read = (engine, board, opts = {}) => annotate(engine.run(positionFromColors(board.color, board.toPlay), { depth: 3, exact: 10, all: true, ...opts }));

test('win chance grows with the lead and is certain when exact', () => {
  assert.equal(winChance(0, 30, false), 0.5);
  assert.ok(winChance(4, 30, false) > 0.5 && winChance(4, 30, false) < winChance(12, 30, false));
  assert.ok(winChance(4, 10, false) > winChance(4, 40, false), 'the same lead counts more near the end');
  assert.equal(winChance(2, 12, true), 1);
  assert.equal(winChance(-2, 12, true), 0);
  assert.equal(winChance(0, 12, true), 0.5);
});

test('grades by discs lost against the best move', () => {
  const before = annotate({ toPlay: BLACK, empties: 40, depth: 8, exact: false, score: 4, moves: [
    { move: 1, score: 4, pv: [] }, { move: 2, score: 3, pv: [] }, { move: 3, score: 0, pv: [] },
    { move: 4, score: -4, pv: [] }, { move: 5, score: -12, pv: [] },
  ] });
  assert.equal(gradeMove(before, 1).grade, 'best');
  assert.equal(gradeMove(before, 2).grade, 'good');
  assert.equal(gradeMove(before, 3).grade, 'inaccuracy');
  assert.equal(gradeMove(before, 4).grade, 'mistake');
  assert.equal(gradeMove(before, 5).grade, 'blunder');
  assert.equal(gradeMove(before, 9), null);
  assert.equal(gradeMove(before, 2).bestMove, 1);
});

test('throwing away an exact win is at least a mistake', () => {
  const before = annotate({ toPlay: WHITE, empties: 10, depth: 10, exact: true, score: 2, moves: [
    { move: 1, score: 2, pv: [], exact: true }, { move: 2, score: -2, pv: [], exact: true },
  ] });
  const g = gradeMove(before, 2);
  assert.equal(g.grade, 'mistake');
  assert.equal(g.result, -2);
  assert.match(verdict(g, 'improving', levelGrade(g, 'improving')), /wins by 2; this move loses by 2/);
});

test('names openings in any orientation and offers book moves', () => {
  // The Tiger from all four first moves.
  for (const t of ['f5d6c3d3c4', 'e6f4c3c4d3', 'd3c5f6f5e6', 'c4e3f6e6f5']) {
    assert.equal(openingOf(Game.fromText(t).line().at(-1)).name, 'Tiger', t);
  }
  // Still named a move after leaving the book, but no longer current.
  const left = openingOf(Game.fromText('f5d6c3d3c4b5').line().at(-1));
  assert.equal(left.name, 'Tiger');
  assert.equal(left.current, false);
  const g = Game.fromText('f5d6c3d3c4');
  const book = bookMoves(g.line().at(-1));
  assert.ok(book.some(b => b.name === 'Aubrey'), 'b3 leads to the Aubrey');
  assert.ok(book.every(b => b.names.length));
});

test('stable discs, frontier and danger squares', () => {
  const b = Board.fromString(
    'XXXO----' +
    'XX------' +
    'X-------' +
    '---OX---' +
    '---XO---' +
    '--------' +
    '--------' +
    '-------O', BLACK);
  const st = stableDiscs(b);
  for (const n of ['a1', 'b1', 'c1', 'a2', 'b2', 'a3', 'h8']) assert.ok(st.has(parseSq(n)), n);
  assert.ok(!st.has(parseSq('d1')), 'd1 can be flipped along the edge');
  assert.ok(!st.has(parseSq('d4')));
  const fr = frontierDiscs(b);
  assert.ok(fr.has(parseSq('d4')), 'd4 touches empty squares');
  assert.ok(!fr.has(parseSq('a1')), 'a1 has no empty neighbour');
  const d = dangerSquares(b);
  assert.equal(d.get(parseSq('g2')), 'x');
  assert.equal(d.get(parseSq('h2')), 'c');
  assert.ok(!d.has(parseSq('b2')), 'a1 is taken');
  assert.equal(d.has(parseSq('g7')), false, 'h8 is taken');
  assert.ok(emptyRegions(b).length >= 1);
});

test('move facts: corners, X-squares, passes', () => {
  // Black takes a1.
  let b = Board.fromString('-OX-----' + '--------'.repeat(7), BLACK);
  b.color[parseSq('d4')] = WHITE; b.color[parseSq('e5')] = WHITE; b.color[parseSq('d5')] = BLACK; b.color[parseSq('e4')] = BLACK;
  let after = b.clone(); let flipped = after.play(parseSq('a1'));
  let facts = moveFacts({ before: b, after, move: parseSq('a1'), mover: BLACK, flipped });
  assert.ok(facts.some(f => f.type === 'corner' && f.corner === 0));
  // White plays an X-square next to an empty corner.
  const g = Game.fromText('f5f6e6f4g5e7f7h5e3d3');
  const n = g.line().at(-1);
  facts = moveFacts({ before: n.parent.board, after: n.board, move: n.move, mover: n.color, flipped: n.flipped });
  assert.ok(Array.isArray(facts));
});

test('explanations read cleanly at every level over random games', () => {
  const engine = new Engine(W);
  let seed = 11;
  const rnd = k => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  const bad = /undefined|NaN|null|\[object/;
  for (let k = 0; k < 6; k++) {
    const g = new Game();
    while (!g.isOver()) {
      const ms = g.board.legalMoves();
      g.play(ms.length ? ms[rnd(ms.length)] : PASS);
    }
    for (const node of g.line().slice(1)) {
      if (!node.parent.analysis) node.parent.analysis = node.parent.board.isOver ? null : read(engine, node.parent.board);
      node.analysis = node.board.isOver ? null : read(engine, node.board);
      const facts = nodeFacts(node, { before: node.parent.analysis, after: node.analysis });
      const gr = node.move === PASS ? null : gradeMove(node.parent.analysis, node.move);
      for (const level of ['beginner', 'improving', 'strong']) {
        for (const you of [0, BLACK, WHITE]) {
          const ctx = { level, mover: node.color, you };
          if (gr) ctx.shown = levelGrade(gr, level, facts);
          const lines = [...describe(facts, ctx), ...describeNote(facts, ctx)];
          if (gr) lines.push(verdict(gr, level, ctx.shown));
          for (const l of lines) assert.ok(!bad.test(l) && l.length > 3, `${level}: "${l}" at ${g.transcript(node)}`);
        }
      }
      for (const n of positionNotes(node.board, { who: c => c === BLACK ? 'You' : 'AI' })) assert.ok(!bad.test(n.text));
      if (node.analysis) for (const h of hintList(node.analysis)) assert.ok(!bad.test(h.label + h.sub));
    }
  }
});

test('describeScore and access helpers', () => {
  assert.equal(describeScore(0.2), 'Even');
  assert.equal(describeScore(6), 'Black +6');
  assert.equal(describeScore(-3), 'White +3');
  assert.equal(linkPoints('Play <b>d3</b> or c4.'), 'Play <b><span class="pt" data-pt="19">d3</span></b> or <span class="pt" data-pt="26">c4</span>.');
  const g = new Game();
  assert.match(pointReadout(g.board, parseSq('d3'), p => g.check(p)), /d3, empty, legal, flips 1 disc/);
  assert.match(pointReadout(g.board, parseSq('a1'), p => g.check(p)), /can't play/);
  assert.equal(resultPhrase({ winner: BLACK, final: [40, 24] }), 'Black wins 40 to 24.');
});

test('wedges: playing one, and leaving a gap for one', async () => {
  const { edgeNeighbours, wedgeGaps } = await import('../src/explain.js');
  assert.deepEqual(edgeNeighbours(parseSq('d1')), [parseSq('c1'), parseSq('e1')]);
  assert.deepEqual(edgeNeighbours(parseSq('a4')), [parseSq('a3'), parseSq('a5')]);
  assert.equal(edgeNeighbours(parseSq('a1')), null);
  assert.equal(edgeNeighbours(parseSq('d4')), null);
  // White edge discs at c1 and e1 with d1 empty; Black can play d1 (flanking d2 with d3).
  const b = Board.fromString('--O-O---' + '---O----' + '---X----' + '--------'.repeat(5), BLACK);
  assert.deepEqual(wedgeGaps(b, WHITE), [parseSq('d1')]);
  const after = b.clone();
  const flipped = after.play(parseSq('d1'));
  assert.ok(flipped && flipped.length);
  const facts = moveFacts({ before: b, after, move: parseSq('d1'), mover: BLACK, flipped });
  assert.ok(facts.some(f => f.type === 'wedge'));
  const lines = describe(facts, { level: 'improving', mover: BLACK, you: BLACK, shown: { flagged: false } });
  assert.ok(lines.some(l => /wedge/i.test(l)), lines.join(' | '));
});

test('find it yourself: lines that name the answer are held back', async () => {
  const { hideAnswer } = await import('../src/wording.js');
  const lines = ['<b>c4</b> would have taken the corner.', 'This gives White the a1 corner.', 'Otherwise Black plays C4 next.'];
  assert.deepEqual(hideAnswer(lines, [parseSq('c4')]), ['This gives White the a1 corner.']);
  assert.deepEqual(hideAnswer(lines, []), lines);
});

test('the level ladder: a win moves up, a loss down, a draw stays', async () => {
  const { nextLevel, LEVELS } = await import('../src/levels.js');
  assert.deepEqual(nextLevel(3, 1), { level: 4, step: 'up' });
  assert.deepEqual(nextLevel(3, -1), { level: 2, step: 'down' });
  assert.deepEqual(nextLevel(3, 0), { level: 3, step: 'same' });
  assert.deepEqual(nextLevel(LEVELS.length - 1, 1), { level: LEVELS.length - 1, step: 'top' });
  assert.deepEqual(nextLevel(0, -1), { level: 0, step: 'bottom' });
});

test('key moments: the biggest mistakes, capped, a few moves apart, in move order', async () => {
  const { keyMoments } = await import('../src/coach.js');
  const picks = keyMoments([
    { depth: 10, ptLoss: 8 }, { depth: 12, ptLoss: 30 }, { depth: 13, ptLoss: 25 },
    { depth: 30, ptLoss: 6 }, { depth: 40, ptLoss: 12 }, { depth: 50, ptLoss: 4 },
  ]);
  assert.deepEqual(picks.map(p => p.depth), [12, 30, 40], 'one per fight: 10 and 13 are too close to 12');
  assert.deepEqual(picks.map(p => p.turning), [true, false, false]);
  assert.equal(keyMoments([]).length, 0);
  assert.equal(keyMoments([{ depth: 5, ptLoss: 9 }])[0].turning, false, 'a single moment is no turning point');
});

test('a best move says how far ahead it was, and why, against the next best', () => {
  const g = { grade: 'best', gap: 6, exact: false };
  assert.match(verdict(g, 'beginner', { key: 'best' }), /no other move was close/);
  assert.match(verdict(g, 'improving', { key: 'best' }), /about 6 discs worse/);
  assert.equal(verdict({ ...g, gap: 1 }, 'improving', { key: 'best' }), 'Exactly the coach\'s choice.');
  const facts = [{ type: 'whyBest', why: 'greed', other: parseSq('d3'), mine: 4, theirs: 1 }, { type: 'whyBest', why: 'keepsCorner', other: parseSq('d3'), corners: [parseSq('h8')] }];
  const lines = describe(facts, { level: 'beginner', mover: BLACK, you: BLACK, shown: { key: 'best', flagged: false } });
  assert.equal(lines.length, 1, 'one reason');
  assert.match(lines[0], /Compared with <b>d3<\/b>, the next best, it doesn't let White reach the h8 corner/, 'the strongest reason first');
});

test('the coach only praises leaving the opponent few moves on its own best move', () => {
  const facts = [{ type: 'mobility', theirs: 2, theirsBefore: 6, mine: 8 }];
  const say = key => describe(facts, { level: 'improving', mover: BLACK, you: BLACK, shown: { key, flagged: false } });
  assert.equal(say('best').length, 1);
  assert.equal(say('good').length, 0, 'not under a move that lost discs');
});

test('a mistake whose better square the opponent took next says so', async () => {
  const { missedLine } = await import('../src/wording.js');
  assert.equal(missedLine(parseSq('c4'), { level: 'improving', mover: BLACK, you: BLACK }), 'You missed <b>c4</b>, and White took it right away.');
});
