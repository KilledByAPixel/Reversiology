// The soak test (tools/selfplay.js): seeded whole games through the game
// record, with variations, replays, handicap starts and passes; every node
// checked, every game saved and read back as the same tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soak, playGame, checkNode, nodes, rng } from '../tools/selfplay.js';
import { Engine } from '../src/engine/engine.js';
import { BLACK, WHITE } from '../src/board.js';
import { loadWeights } from '../tools/weights-io.js';

const engine = new Engine(loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname), { ttBits: 16 });

test('ten seeded games through the record: every node consistent, saved and read back whole', () => {
  const t = soak(engine, { games: 10, seed: 1 });
  assert.equal(t.games, 10);
  for (const k of ['moves', 'variations', 'replays']) assert.ok(t[k] > 0, `went through ${k}`);
});

test('the soak notices a broken record', () => {
  const { game } = playGame(engine, rng(3));
  const all = nodes(game);
  const mid = all.find(n => n.depth === 20 && n.flipped.length);
  assert.doesNotThrow(() => checkNode(game, mid));
  // A disc changed behind the record's back.
  const p = mid.board.color.findIndex(c => c === BLACK || c === WHITE);
  mid.board.color[p] = 3 - mid.board.color[p];
  assert.throws(() => checkNode(game, mid), /board isn't the parent's/);
  mid.board.color[p] = 3 - mid.board.color[p];
  // A flipped list that lies.
  const saved = mid.flipped;
  mid.flipped = saved.slice(1);
  assert.throws(() => checkNode(game, mid), /flipped discs differ/);
  mid.flipped = saved;
  // A move played by the wrong side.
  mid.color = 3 - mid.color;
  assert.throws(() => checkNode(game, mid), /was to move/);
});
