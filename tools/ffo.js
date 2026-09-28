// Solves FFO endgame test positions and checks the scores.
//   node tools/ffo.js [file.obf] [first] [last]
import { readFileSync } from 'node:fs';
import { Engine, positionFromString } from '../src/engine/engine.js';
import { BLACK, WHITE } from '../src/engine/search.js';
import { loadWeights } from './weights-io.js';

const file = process.argv[2] || 'test/fixtures/fforum-1-19.obf';
const lines = readFileSync(file, 'utf8').split('\n').filter(l => /^[-XO]{64} [XO]/.test(l));
const first = +(process.argv[3] || 0), last = +(process.argv[4] || lines.length - 1);
const e = new Engine(loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname), { ttBits: 20 });
let total = 0, nodes = 0;
for (let i = first; i <= last && i < lines.length; i++) {
  const [board, rest] = lines[i].split(' ');
  const toPlay = rest.startsWith('X') ? BLACK : WHITE;
  const want = +/[A-H][1-8]:([+-]\d+)/.exec(lines[i])[1];
  const t0 = Date.now();
  e.search.clearTT();
  const r = e.run(positionFromString(board, toPlay), { exact: 64, all: false });
  const ms = Date.now() - t0;
  total += ms; nodes += r.nodes;
  console.log(`#${i} empties ${r.empties} score ${r.score} want ${want} ${r.score === want ? 'ok' : 'WRONG'} ${ms}ms ${(r.nodes / 1e6).toFixed(2)}M nodes ${(r.nodes / ms / 1000).toFixed(2)}M/s`);
}
console.log(`total ${total}ms, ${(nodes / total / 1000).toFixed(2)}M nodes/s`);
