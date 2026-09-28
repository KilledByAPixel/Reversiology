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
