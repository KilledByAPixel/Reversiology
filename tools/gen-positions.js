// Generates positions to train the evaluation on: games mixing random moves
// (the odd shapes beginners make) with engine moves (the positions good
// players reach), sampled a few per game. One line per position:
// 64 characters (X black, O white, -) then the side to move.
//   node tools/gen-positions.js <count> <seed> [weights.bin] > positions.txt
import { Board, BLACK, WHITE, PASS } from '../src/board.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { loadWeights } from './weights-io.js';

const count = +(process.argv[2] || 1000);
let seed = +(process.argv[3] || 1) >>> 0 || 1;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const weights = process.argv[4] ? loadWeights(process.argv[4]) : null;
const engine = new Engine(weights, { ttBits: 16 });
const seen = new Set();
let out = 0;
const lines = [];
while (out < count) {
  const b = new Board();
  // How random this game is: many near-perfect games, some chaotic ones.
  const r = rand();
  const noise = r < 0.35 ? 0.02 : r < 0.7 ? 0.1 : r < 0.9 ? 0.3 : 0.7;
  const opening = (rand() * 12) | 0; // random moves at the start, for variety
  const depth = weights ? 2 + ((rand() * 4) | 0) : 1 + ((rand() * 3) | 0);
  const sampleEvery = 3 + ((rand() * 4) | 0);
  let ply = 0;
  while (!b.isOver) {
    const ms = b.legalMoves();
    if (!ms.length) { b.play(PASS); continue; }
    if (rand() * sampleEvery < 1 && b.empties > 0) {
      const key = b.toString() + (b.toPlay === BLACK ? 'X' : 'O');
      if (!seen.has(key)) { seen.add(key); lines.push(`${b.toString()} ${b.toPlay === BLACK ? 'X' : 'O'}`); out++; }
    }
    let move;
    if (ply < opening || rand() < noise) move = ms[(rand() * ms.length) | 0];
    else {
      const res = engine.run(positionFromColors(b.color, b.toPlay), { depth, exact: 10, all: false });
      // Among moves within a disc or two of the best, pick at random.
      const top = res.moves.filter(m => m.bound === 0 && m.score >= res.moves[0].score - 1);
      move = (top.length ? top : res.moves)[(rand() * (top.length || 1)) | 0].move;
    }
    b.play(move);
    ply++;
  }
  if (lines.length >= 1000) { process.stdout.write(lines.join('\n') + '\n'); lines.length = 0; }
}
if (lines.length) process.stdout.write(lines.join('\n') + '\n');
