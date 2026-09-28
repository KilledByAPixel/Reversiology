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
  // A corner the opponent reaches within a few moves in the expected line.
  if (an && an.moves && an.moves.length) {
    const c = cornerInLine([an.moves[0].move, ...(an.moves[0].pv || [])], an.toPlay, opp, 5);
    if (c && !facts.some(f => f.type === 'threat' || (f.type === 'givesCorner'))) facts.push({ type: 'cornerSoon', corner: c.move, plies: c.ply });
  }
  if (an && an.exact) facts.push({ type: 'exact', score: -an.score, discs: finalDiscs(after, mover, -an.score) });
  return facts;
}

// The first corner `who` plays within `max` moves of a line (passes, -1,
// don't count as moves but hand the turn over). first: colour of line[0].
export function cornerInLine(line, first, who, max) {
  let c = first;
  for (let i = 0; i < line.length && i < max; i++) {
    const m = line[i];
    if (m >= 0 && c === who && CORNERS.includes(m)) return { move: m, ply: i + 1 };
    c = 3 - c;
  }
  return null;
}

// Why the coach's move `best` beats `move`: what it does that the move
// doesn't. Facts of type 'vsBest' with a `why`.
export function compareFacts(before, move, best, mover) {
  if (best == null || best === PASS || move === best || move === PASS) return [];
  const opp = 3 - mover, out = [];
  const play = m => { const b = before.clone(); b.toPlay = mover; const f = b.play(m); return { b, f }; };
  const mine = play(move), theirs = play(best);
  const oppMoves = r => r.b.legalMoves(opp);
  const mo = oppMoves(mine), bo = oppMoves(theirs);
  if (CORNERS.includes(best) && !CORNERS.includes(move)) out.push({ type: 'vsBest', why: 'corner', best, corner: best });
  const cornersAfter = r => oppMoves(r).filter(p => CORNERS.includes(p));
  const gaveMine = cornersAfter(mine).length, gaveBest = cornersAfter(theirs).length;
  if (gaveMine > gaveBest) out.push({ type: 'vsBest', why: 'keepsCorner', best, corners: cornersAfter(mine) });
  if (!bo.length && !theirs.b.isOver && mo.length) out.push({ type: 'vsBest', why: 'pass', best });
  else if (mo.length >= bo.length + 2 && mo.length >= bo.length * 1.3 && before.empties > 12) out.push({ type: 'vsBest', why: 'mobility', best, mine: mo.length, theirs: bo.length });
  const fr = r => frontierDiscs(r.b, mover).size;
  if (fr(mine) >= fr(theirs) + 2 && before.empties > 16) out.push({ type: 'vsBest', why: 'frontier', best, mine: fr(mine), theirs: fr(theirs) });
  // The mover's own options on the next turn (if the opponent passed): a
  // move that leaves you short of moves is as bad as one that helps them.
  const myMoves = r => r.b.legalMoves(mover).length;
  if (myMoves(theirs) >= myMoves(mine) + 3 && before.empties > 16) out.push({ type: 'vsBest', why: 'ownMobility', best, mine: myMoves(mine), theirs: myMoves(theirs) });
  // Greed: flipping more than the better move, early on.
  if (before.empties > 20 && mine.f.length >= theirs.f.length + 2) out.push({ type: 'vsBest', why: 'greed', best, mine: mine.f.length, theirs: theirs.f.length });
  const st = r => countOf(stableDiscs(r.b), r.b, mover);
  if (st(theirs) >= st(mine) + 3) out.push({ type: 'vsBest', why: 'stable', best, gain: st(theirs) - st(mine) });
  if (before.empties <= 18) {
    const regions = emptyRegions(before), rm = regionOf(regions, move), rb = regionOf(regions, best);
    if (regions.length > 1 && rm && rb && rm.length % 2 === 0 && rb.length % 2 === 1) out.push({ type: 'vsBest', why: 'parity', best, size: rb.length });
  }
  return out;
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
  // Against the coach's choice, once the read before the move has one.
  const best = reads.before && reads.before.moves && reads.before.moves[0];
  if (best && best.move !== node.move) {
    node.facts.push(...compareFacts(node.parent.board, node.move, best.move, node.color));
    // The coach's line wins a corner soon, and this one doesn't.
    const c = cornerInLine([best.move, ...(best.pv || [])], node.color, node.color, 5);
    const played = reads.after && reads.after.moves && reads.after.moves[0];
    const mine = played && cornerInLine([played.move, ...(played.pv || [])], 3 - node.color, node.color, 4);
    if (c && c.move !== best.move && !mine) node.facts.push({ type: 'vsBest', why: 'cornerLine', best: best.move, corner: c.move });
  }
  return node.facts;
}

export { BLACK, WHITE };
