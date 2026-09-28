import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES } from '../src/puzzles.js';
import { puzzleAt, nextPuzzle, puzzleCount, judge, prompt, THEME_HINTS, THEME_NAMES } from '../src/puzzle.js';

test('every puzzle is a legal position with legal answers and a known theme', () => {
  assert.ok(PUZZLES.length > 0);
  for (let i = 0; i < PUZZLES.length; i++) {
    const p = puzzleAt(i);
    assert.ok(!p.board.isOver, `puzzle ${i} is finished`);
    const legal = p.board.legalMoves();
    assert.ok(legal.length >= 3, `puzzle ${i} has too few moves to be a puzzle`);
    for (const a of p.answers) assert.ok(legal.includes(a), `puzzle ${i}: answer ${a} isn't legal`);
    assert.ok(THEME_HINTS[p.theme] && THEME_NAMES[p.theme], `puzzle ${i}: theme ${p.theme}`);
    assert.ok([1, 2, 3].includes(p.difficulty));
    assert.ok(p.gap > 0);
  }
});

test('next puzzle prefers unsolved ones and respects the difficulty', () => {
  const solved = new Set();
  const first = nextPuzzle(solved, 0, -1);
  assert.equal(first, 0);
  solved.add(puzzleAt(0).id);
  assert.notEqual(nextPuzzle(solved, 0, -1), 0);
  for (const d of [1, 2, 3]) {
    const i = nextPuzzle(new Set(), d, -1);
    if (puzzleCount(d)) assert.equal(puzzleAt(i).difficulty, d);
    else assert.equal(i, null);
  }
  // All solved: they come round again.
  const all = new Set(PUZZLES.map((_, i) => puzzleAt(i).id));
  assert.notEqual(nextPuzzle(all, 0, 0), null);
});

test('judging answers reads cleanly', () => {
  const bad = /undefined|NaN|null|\[object/;
  for (let i = 0; i < PUZZLES.length; i++) {
    const p = puzzleAt(i);
    assert.ok(!bad.test(prompt(p)));
    for (const m of p.board.legalMoves()) {
      for (const level of ['beginner', 'improving', 'strong']) {
        const r = judge(p, m, level);
        assert.equal(r.correct, p.answers.includes(m));
        for (const l of [...r.lines, ...r.reveal]) assert.ok(!bad.test(l), `puzzle ${i} ${m}: ${l}`);
      }
    }
  }
});
