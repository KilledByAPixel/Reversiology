// Calibrates the AI levels: plays level a against level b over shared random
// openings (each twice, colours swapped) and reports the score.
//   node tools/levels.js <a> <b> [games] [seed]
// a and b are level indexes, or JSON level settings to try out.
import { Board, BLACK, WHITE, PASS } from '../src/board.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { LEVELS, chooseLevelMove } from '../src/levels.js';
import { loadWeights } from './weights-io.js';

const lv = x => /^\d+$/.test(x) ? { ...LEVELS[+x], index: +x } : { name: 'custom', ...JSON.parse(x) };
const [A, B] = process.argv.slice(2, 4).map(lv);
const [games = 20, seed0 = 1] = process.argv.slice(4).map(Number);
const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const engines = [new Engine(W, { ttBits: 20 }), new Engine(W, { ttBits: 20 })];
let s = seed0;
const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

let winsA = 0, winsB = 0, draws = 0, discs = 0;
for (let g = 0; g < games; g++) {
  // Two random plies of opening, shared by each pair of games.
  const opening = new Board();
  let os = 1000 + seed0 * 7919 + (g >> 1);
  const orand = () => { os ^= os << 13; os ^= os >>> 17; os ^= os << 5; return (os >>> 0) / 4294967296; };
  for (let k = 0; k < 2; k++) { const ms = opening.legalMoves(); opening.play(ms[(orand() * ms.length) | 0]); }
  const board = opening.clone();
  const aColor = g % 2 ? WHITE : BLACK;
  while (!board.isOver) {
    const ms = board.legalMoves();
    if (!ms.length) { board.play(PASS); continue; }
    const isA = board.toPlay === aColor;
    const m = chooseLevelMove(engines[isA ? 0 : 1], positionFromColors(board.color, board.toPlay), isA ? A : B, rand);
    board.play(m);
  }
  const margin = board.finalMargin() * (aColor === BLACK ? 1 : -1);
  if (margin > 0) winsA++; else if (margin < 0) winsB++; else draws++;
  discs += margin;
}
const name = l => l.index != null ? `${l.index + 1}·${l.name}` : JSON.stringify(l).replace('"name":"custom",', '');
const a = A, b = B;
console.log(`${name(a)} vs ${name(b)}: ${winsA}-${winsB}-${draws} (${name(b)} scores ${(100 * (winsB + draws / 2) / games).toFixed(0)}%), avg margin for ${name(a)} ${(discs / games).toFixed(1)}`);
