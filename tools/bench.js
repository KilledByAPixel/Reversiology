// Midgame search speed: analyses sample positions at a fixed depth.
//   node tools/bench.js [depth] [all|best] [probcut]
import { Engine, positionFromString } from '../src/engine/engine.js';
import { loadWeights } from './weights-io.js';

const depth = +(process.argv[2] || 10), all = process.argv[3] === 'all', probcut = +(process.argv[4] || 0);
const e = new Engine(loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname), { ttBits: 20 });
const POS = [
  ['---------------------------OX------XO---------------------------', 1],
  ['--------------------XXX-----XXO-----XOO------O------------------', 2],
  ['------------O-------OOOX---OOXXX--XXOXO-----X-O---------------- ', 1],
  ['--XXXX----OXXO--OOOXOXO-OOXOXOOO-OXXXXOO--XXXOO---X-XO------O---', 1],
  ['---O------OOO--XXXOXOO---XXOXO---XOOXXX-OOOOOX----O-O-----------', 2],
  ['--OOO-----OOOX--OOOOXXXX-OOOXXX--OOXOXX---XOXX-----XX-----------', 1],
];
let total = 0, nodes = 0;
for (const [b, side] of POS) {
  const t0 = Date.now();
  const r = e.run(positionFromString(b, side), { depth, exact: 0, all, probcut });
  const ms = Date.now() - t0;
  total += ms; nodes += r.nodes;
  console.log(`empties ${r.empties} depth ${r.depth} best ${r.moves[0].move} score ${r.score} ${ms}ms ${(r.nodes / 1e6).toFixed(2)}M ${(r.nodes / Math.max(1, ms) / 1000).toFixed(2)}M/s`);
}
console.log(`total ${total}ms ${(nodes / total / 1000).toFixed(2)}M nodes/s`);
