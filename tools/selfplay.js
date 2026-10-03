// A soak test of the game record: seeded whole games played by the engine
// through Game, with take-backs, variations, replays, handicap starts and
// forced passes, every node checked, and each game saved as text and read
// back as the same tree.
//   node tools/selfplay.js [games] [seed]
// test/soak.test.js runs a few of these in the node suite.
import { Board, BLACK, WHITE, EMPTY, PASS } from '../src/board.js';
import { Game } from '../src/game.js';
import { Engine, positionFromColors } from '../src/engine/engine.js';

// A small seeded generator (xorshift32).
export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// Throws if node isn't a consistent step of the game: its board is its
// parent's with its move played, the discs it lists as flipped are the ones
// that flipped, the side to move is right, and a finished game's result adds up.
export function checkNode(game, node) {
  const b = node.board, where = `move ${node.depth} (${game.transcript(node) || 'start'})`;
  const fail = why => { throw new Error(`${where}: ${why}`); };
  const black = b.count(BLACK), white = b.count(WHITE);
  if (black + white + b.empties !== 64) fail('discs and empties don\'t add up to 64');
  for (let p = 0; p < 64; p++) if (![EMPTY, BLACK, WHITE].includes(b.color[p])) fail(`square ${p} holds ${b.color[p]}`);
  if (node.parent) {
    const before = node.parent.board;
    if (node.color !== before.toPlay) fail(`played by ${node.color}, but ${before.toPlay} was to move`);
    const replay = before.clone();
    if (node.move === PASS) {
      if (before.legalMoves().length) fail('a pass with a legal move');
      replay.play(PASS);
    } else {
      if (!before.isLegal(node.move)) fail('an illegal move');
      const flipped = replay.play(node.move);
      if ([...flipped].sort((a, c) => a - c).join() !== [...node.flipped].sort((a, c) => a - c).join()) fail('the flipped discs differ');
    }
    if (replay.toString() !== b.toString() || replay.toPlay !== b.toPlay) fail('the board isn\'t the parent\'s with the move played');
  }
  if (b.isOver) {
    if (b.legalMoves(BLACK).length || b.legalMoves(WHITE).length) fail('over, but someone can move');
    const s = game.score(node);
    if (s.final[0] + s.final[1] !== 64) fail(`the final score ${s.final.join('-')} doesn't add up to 64`);
    if (Math.sign(s.final[0] - s.final[1]) !== Math.sign(s.margin)) fail('the winner and the margin disagree');
  }
  for (const c of node.children) if (c.parent !== node) fail('a child with another parent');
  const moves = node.children.map(c => c.move);
  if (new Set(moves).size !== moves.length) fail('the same move twice among the children');
}

// Every node of the tree, depth first.
export function nodes(game) {
  const out = [], stack = [game.root];
  while (stack.length) { const n = stack.pop(); out.push(n); stack.push(...n.children); }
  return out;
}

// The tree as text that ignores ids: each node's move and children, in order.
const shape = node => `${node.move}${node.children.length ? `(${node.children.map(shape).join(',')})` : ''}`;

// One seeded game: the engine picks among its top few moves; now and then a
// move is taken back and another played (a variation), or a step back and
// the same move played again (a replay). Returns the game and what happened.
export function playGame(engine, rand, { handicap = 0 } = {}) {
  const game = handicap ? new Game({ handicap, handicapColor: rand() < 0.5 ? BLACK : WHITE }) : new Game();
  const seen = { moves: 0, passes: 0, variations: 0, replays: 0 };
  while (!game.isOver()) {
    const b = game.current.board;
    if (!b.legalMoves().length) { game.play(PASS); seen.passes++; continue; }
    const r = engine.run(positionFromColors(b.color, b.toPlay), { depth: 2, exact: 6, all: true });
    const top = r.moves.slice(0, 3);
    const move = top[(rand() * top.length) | 0].move;
    if (!game.play(move)) throw new Error(`the engine's move ${move} was refused`);
    seen.moves++;
    const cur = game.current;
    if (cur.parent && cur.parent.parent && rand() < 0.08) {
      // Take it back and play another legal move: a variation.
      game.goTo(cur.parent);
      const other = cur.parent.board.legalMoves().find(m => m !== cur.move);
      if (other != null) { game.play(other); seen.variations++; }
    } else if (cur.parent && rand() < 0.05) {
      // Step back and play the same move again: the record keeps one node.
      game.goTo(cur.parent);
      const again = game.play(cur.move);
      if (again !== cur) throw new Error('replaying a move made a second node');
      seen.replays++;
    }
  }
  return { game, seen };
}

// Plays `games` seeded games and checks them. Returns totals; throws on the
// first fault.
export function soak(engine, { games = 10, seed = 1 } = {}) {
  const rand = rng(seed);
  const total = { games: 0, nodes: 0, moves: 0, passes: 0, variations: 0, replays: 0 };
  for (let g = 0; g < games; g++) {
    const { game, seen } = playGame(engine, rand, { handicap: g % 4 === 3 ? 1 + (g % 3) : 0 });
    const all = nodes(game);
    for (const n of all) checkNode(game, n);
    // Saved and read back: the same tree, the same final positions.
    const back = Game.fromText(game.toText());
    if (shape(back.root) !== shape(game.root)) throw new Error(`game ${g}: the tree read back differs`);
    const ends = gm => nodes(gm).filter(n => !n.children.length).map(n => n.board.toString()).sort().join('|');
    if (ends(back) !== ends(game)) throw new Error(`game ${g}: the positions read back differ`);
    total.games++; total.nodes += all.length;
    for (const k of ['moves', 'passes', 'variations', 'replays']) total[k] += seen[k];
  }
  return total;
}

// Command line: node tools/selfplay.js [games] [seed]
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { loadWeights } = await import('./weights-io.js');
  const engine = new Engine(loadWeights(new URL('../weights/eval.bin.gz', import.meta.url).pathname), { ttBits: 18 });
  const [games = 50, seed = 1] = process.argv.slice(2).map(Number);
  const t0 = Date.now();
  console.log(soak(engine, { games, seed }), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
