// The WebAssembly search core (src/engine/core.c) against the JavaScript
// search it was ported from: the same scores, moves and node counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, positionFromString } from '../src/engine/engine.js';
import { WasmSearch } from '../src/engine/wasm.js';
import { Search } from '../src/engine/search.js';
import { BLACK, WHITE } from '../src/engine/search.js';
import { loadWeights } from '../tools/weights-io.js';

const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const POS = [
  ['--------------------XXX-----XXO-----XOO------O------------------', WHITE],
  ['--XXXX----OXXO--OOOXOXO-OOXOXOOO-OXXXXOO--XXXOO---X-XO------O---', BLACK],
  ['---O------OOO--XXXOXOO---XXOXO---XOOXXX-OOOOOX----O-O-----------', WHITE],
  ['--OOOO--X-OOOOO-XXOOXOXXXOXOXXXXXXXOXXXX-XXOXOXX--OXXX-X----X---', WHITE],
];

test('the WebAssembly search is used when loaded', () => {
  assert.ok(new Engine(W).search instanceof WasmSearch);
  assert.ok(new Engine(W, { js: true }).search instanceof Search);
  assert.ok(new Engine(null).search instanceof Search, 'no weights: the simple evaluation in JavaScript');
});

test('the WebAssembly search agrees with the JavaScript one exactly', () => {
  const opts = [
    { depth: 6, exact: 0, all: true },
    { depth: 9, exact: 0, all: false, probcut: 1.5 },
    { depth: 4, exact: 18, all: true },
  ];
  for (const [b, side] of POS) {
    for (const o of opts) {
      const pos = positionFromString(b, side);
      const a = new Engine(W).run(pos, o), j = new Engine(W, { js: true }).run(pos, o);
      const pick = r => ({ score: r.score, depth: r.depth, exact: r.exact, nodes: r.nodes, moves: r.moves.map(m => [m.move, m.score, m.bound, m.pv.join()]) });
      assert.deepEqual(pick(a), pick(j), `${b} ${JSON.stringify(o)}`);
    }
  }
});

test('the WebAssembly search stops on time', () => {
  const e = new Engine(W);
  const t0 = Date.now();
  const r = e.run(positionFromString(POS[0][0], POS[0][1]), { depth: 40, exact: 0, all: true, maxTime: 150 });
  assert.ok(Date.now() - t0 < 1500);
  assert.ok(r.depth >= 2 && r.moves.length);
});
