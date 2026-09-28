// Plays Reversiology against Edax (through its NBoard protocol), each opening
// twice with colours swapped, as an outside yardstick for strength.
//   node tools/edax-match.js <edax binary> <edax depth> <games> <our options JSON | level index>
// e.g. node tools/edax-match.js ../edax/bin/lEdax 4 20 '{"depth":6,"exact":14}'
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { Board, BLACK, WHITE, PASS, sqName, parseSq } from '../src/board.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { loadWeights } from './weights-io.js';
import { LEVELS, chooseLevelMove } from '../src/levels.js';

const [bin, edaxDepth = '4', games = '10', ours = '{"depth":6,"exact":14}'] = process.argv.slice(2);
const level = /^\d+$/.test(ours) ? LEVELS[+ours] : null;
const opts = level ? null : JSON.parse(ours);
const W = loadWeights(new URL("../weights/eval.bin.gz", import.meta.url).pathname);
const engine = new Engine(W, { ttBits: 20 });

const edax = spawn(bin, ['-nboard'], { cwd: dirname(dirname(bin)) });
let buf = '', waiting = null;
edax.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (process.env.DEBUG) console.log("edax:", line);
    if (line.startsWith('===') && waiting) { const w = waiting; waiting = null; w(line.split(/\s+/)[1]); }
  }
});
const send = s => edax.stdin.write(s + '\n');
send('nboard 1');
send(`set depth ${edaxDepth}`);

function edaxMove(moves) {
  const start = '---------------------------O*------*O--------------------------- *';
  let g = `(;GM[Othello]PC[NBoard]SZ[8]BO[8 ${start}]`;
  for (const [m, c] of moves) g += `${c === BLACK ? 'B' : 'W'}[${m === PASS ? 'PA' : sqName(m).toUpperCase()}]`;
  send(`set game ${g};)`);
  return new Promise(res => { waiting = res; send('go'); });
}

let seed = 7;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

let wins = 0, losses = 0, draws = 0, discs = 0;
for (let g = 0; g < +games; g++) {
  // Openings: 6 random plies, reused with colours swapped.
  seed = 1000 + g - (g % 2);
  const b = new Board(), moves = [];
  for (let k = 0; k < 6; k++) {
    const ms = b.legalMoves();
    const m = ms[(rand() * ms.length) | 0];
    moves.push([m, b.toPlay]); b.play(m);
  }
  const us = g % 2 === 0 ? BLACK : WHITE;
  while (!b.isOver) {
    const ms = b.legalMoves();
    let m;
    if (!ms.length) m = PASS;
    else if (b.toPlay === us) {
      if (level) m = chooseLevelMove(engine, positionFromColors(b.color, b.toPlay), level);
      else {
        const r = (process.env.FRESH ? new Engine(engine.search.weights ? W : null) : engine).run(positionFromColors(b.color, b.toPlay), { ...opts, all: false });
        m = r.moves[0].move;
        if (process.env.DEBUG) console.log('us:', sqName(m), r.score, 'depth', r.depth, b.toString(), b.toPlay);
      }
    } else {
      m = parseSq(await edaxMove(moves));
    }
    if (m === null || (m !== PASS && !b.isLegal(m))) throw new Error(`bad move ${m}`);
    moves.push([m, b.toPlay]); b.play(m);
  }
  const margin = b.finalMargin() * (us === BLACK ? 1 : -1);
  if (margin > 0) wins++; else if (margin < 0) losses++; else draws++;
  discs += margin;
  console.log(`game ${g + 1}: ${us === BLACK ? 'black' : 'white'} ${margin > 0 ? '+' : ''}${margin}  (${wins}-${losses}-${draws})`);
}
console.log(`vs Edax depth ${edaxDepth}: ${wins} wins, ${losses} losses, ${draws} draws, average ${(discs / +games).toFixed(1)} discs`);
send('quit');
edax.kill();
