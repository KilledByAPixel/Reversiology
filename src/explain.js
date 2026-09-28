// What a move did, as facts the coach can put into words (wording.js):
// corners won or given away, risky squares next to empty corners, how many
// moves each side is left with, frontier and stable discs, parity near the
// end, openings, and exact results. Pure functions, no DOM, testable in node.
import { BLACK, WHITE, EMPTY, PASS, CORNERS } from './board.js';
import { stableDiscs, frontierDiscs, emptyRegions, regionOf, cornerRelation } from './concepts.js';
import { openingAt } from './coach.js';

const countOf = (set, board, color) => { let n = 0; for (const p of set) if (board.color[p] === color) n++; return n; };
const legalFor = (board, color) => board.legalMoves(color);

// Facts about `move` by `mover` from board `before` to board `after`.
// reads: { before, after } engine reads (annotated) of the two positions, when done.
export function moveFacts({ before, after, move, mover, flipped = [], reads = {} }) {
  const facts = [];
  if (move === PASS) return [{ type: 'pass' }];
  const opp = 3 - mover, empties = after.empties;

  // Corners and the squares next to them.
  const rel = cornerRelation(move);
  if (rel && rel.kind === 'corner') facts.push({ type: 'corner', corner: move });
  else if (rel && before.color[rel.corner] === EMPTY) facts.push({ type: rel.kind === 'x' ? 'xsquare' : 'csquare', corner: rel.corner });

  // Corners the opponent can now take, or no longer can.
  const oppBefore = new Set(legalFor(before, opp)), oppAfter = legalFor(after, opp);
  const newCorners = oppAfter.filter(p => CORNERS.includes(p) && !oppBefore.has(p));
  if (newCorners.length) facts.push({ type: 'givesCorner', corners: newCorners });
  const shut = [...oppBefore].filter(p => CORNERS.includes(p) && !oppAfter.includes(p) && p !== move);
  if (shut.length) facts.push({ type: 'blocksCorner', corners: shut });

  // Mobility: how many moves the opponent has now, against before the move.
  const myAfter = legalFor(after, mover).length;
  if (!oppAfter.length && !after.isOver) facts.push({ type: 'forcesPass' });
  else if (oppAfter.length) facts.push({ type: 'mobility', theirs: oppAfter.length, theirsBefore: oppBefore.size, mine: myAfter });

  // Discs flipped, and whether they sit inside or on the frontier.
  const frontier = frontierDiscs(after, mover);
  const exposed = flipped.filter(p => frontier.has(p)).length + (frontier.has(move) ? 1 : 0);
  facts.push({ type: 'flips', n: flipped.length, exposed, empties });

  // Stable discs gained.
  const sBefore = countOf(stableDiscs(before), before, mover), sAfter = countOf(stableDiscs(after), after, mover);
  if (sAfter - sBefore >= 2) facts.push({ type: 'stable', gain: sAfter - sBefore, total: sAfter });

  // Parity near the end: the empty region played into, odd or even.
  if (empties <= 18 && empties > 0) {
    const reg = regionOf(emptyRegions(before), move);
    if (reg && emptyRegions(before).length > 1) facts.push({ type: 'parity', odd: reg.length % 2 === 1, size: reg.length });
  }

  // Wipeout: every disc on the board is one colour.
  if (!after.count(opp)) facts.push({ type: 'wipeout' });

  // Openings.
  const o = openingAt(after);
  if (o) facts.push({ type: 'opening', name: o.name });

  // From the reads: what the opponent wants next, and exact results.
  const an = reads.after;
  if (an && an.moves && an.moves.length && !an.pass) {
    const reply = an.moves[0];
    if (CORNERS.includes(reply.move)) facts.push({ type: 'threat', move: reply.move, corner: true });
    else facts.push({ type: 'reply', move: reply.move });
  }
  if (an && an.exact) facts.push({ type: 'exact', score: -an.score, discs: finalDiscs(after, mover, -an.score) });
  return facts;
}

// A final disc count for a perfect-play margin, as [mover, opponent] out of 64.
function finalDiscs(board, mover, margin) {
  const m = Math.max(-64, Math.min(64, margin));
  return [(64 + m) / 2, (64 - m) / 2];
}

// Facts for a node in the game tree (cached until the reads change).
export function nodeFacts(node, reads) {
  const key = `${reads.before ? reads.before.depth + (reads.before.exact ? 'x' : '') : '-'}|${reads.after ? reads.after.depth + (reads.after.exact ? 'x' : '') : '-'}`;
  if (node.factsKey === key) return node.facts;
  node.factsKey = key;
  node.facts = moveFacts({ before: node.parent.board, after: node.board, move: node.move, mover: node.color, flipped: node.flipped, reads });
  return node.facts;
}

export { BLACK, WHITE };
