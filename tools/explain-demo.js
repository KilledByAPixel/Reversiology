// Prints what the coach says about every move of a game, to read the wording
// in bulk. The game is played between two levels unless a transcript is given.
//   node tools/explain-demo.js [level: beginner|improving|strong] [transcript]
import { BLACK, PASS, sqName } from '../src/board.js';
import { Game } from '../src/game.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';
import { annotate, gradeMove } from '../src/coach.js';
import { LEVELS, chooseLevelMove } from '../src/levels.js';
import { nodeFacts } from '../src/explain.js';
import { describe, verdict, verdictSaysResult, levelGrade, positionNotes } from '../src/wording.js';
import { plainText } from '../src/access.js';
import { loadWeights } from './weights-io.js';

const level = process.argv[2] || 'improving';
const W = loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname);
const engine = new Engine(W), player = new Engine(W);
const read = b => annotate(engine.run(positionFromColors(b.color, b.toPlay), { depth: 10, exact: 16, all: true, probcut: 2 }));

let game;
if (process.argv[3]) game = Game.fromText(process.argv[3]);
else {
  game = new Game();
  let s = 3;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  while (!game.isOver()) {
    const b = game.board;
    if (!b.legalMoves().length) { game.play(PASS); continue; }
    game.play(chooseLevelMove(player, positionFromColors(b.color, b.toPlay), LEVELS[b.toPlay === BLACK ? 2 : 4], rand));
  }
}
for (const node of game.line().slice(1)) {
  if (node.move === PASS) { console.log(`${node.depth}. pass`); continue; }
  node.parent.analysis ||= node.parent.board.isOver ? null : read(node.parent.board);
  node.analysis ||= node.board.isOver ? null : read(node.board);
  const facts = nodeFacts(node, { before: node.parent.analysis, after: node.analysis });
  const g = gradeMove(node.parent.analysis, node.move);
  const ctx = { level, mover: node.color, you: BLACK };
  let head = `${node.depth}. ${node.color === BLACK ? 'You' : 'White'} ${sqName(node.move)}`;
  const lines = [];
  if (g) {
    ctx.shown = levelGrade(g, level, facts);
    ctx.resultSaid = verdictSaysResult(g, level, ctx.shown);
    head += ` [${ctx.shown.label}${g.ptLoss ? `, −${g.ptLoss}` : ''}] ${plainText(verdict(g, level, ctx.shown))}`;
  }
  lines.push(...describe(facts, ctx).map(plainText));
  console.log(head);
  for (const l of lines) console.log(`     · ${l}`);
  for (const n of positionNotes(node.board, { who: c => c === BLACK ? 'You' : 'White' })) console.log(`     ! ${n.text}`);
}
