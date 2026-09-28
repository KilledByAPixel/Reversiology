// High-level engine API: analyses a position (every move scored, for the
// coach) or picks a move, by iterative deepening. `analyze` is a generator
// that yields after each unit of work, so the worker can report progress and
// stop between units; `run` drives it to the end synchronously (node, tests).
import { Search, finalScore, BLACK, WHITE } from './search.js';
import { R, mobility, flips, popcount, lowBit } from './bits.js';

// A position for the engine: black and white bitboards as 32-bit halves, and
// the side to move.
export function positionFromColors(color, toPlay) {
  let bl = 0, bh = 0, wl = 0, wh = 0;
  for (let s = 0; s < 64; s++) {
    if (color[s] === BLACK) { if (s < 32) bl |= 1 << s; else bh |= 1 << (s - 32); }
    else if (color[s] === WHITE) { if (s < 32) wl |= 1 << s; else wh |= 1 << (s - 32); }
  }
  return { bl, bh, wl, wh, toPlay };
}

export function positionFromString(s, toPlay = BLACK) {
  const color = [...s.replace(/\s+/g, '')].slice(0, 64).map(ch => 'Xx*B'.includes(ch) ? BLACK : 'OoW'.includes(ch) ? WHITE : 0);
  return positionFromColors(color, toPlay);
}

const listBits = (lo, hi) => {
  const out = [];
  while (lo) { out.push(lowBit(lo)); lo &= lo - 1; }
  while (hi) { out.push(lowBit(hi) + 32); hi &= hi - 1; }
  return out;
};

export class Engine {
  constructor(weights = null, opts = {}) {
    this.search = new Search(weights, opts);
  }

  // opts:
  //   depth     most plies to read in the midgame
  //   exact     solve exactly when this many empties or fewer remain
  //   maxTime   ms; the deepest finished depth stands when time runs out
  //   all       score every move exactly (the coach) instead of just finding the best
  //   minDepth  depth to finish even past maxTime
  // Yields { done, ...result } after each root move searched.
  *analyze(pos, { depth = 8, exact = 14, maxTime = Infinity, all = true, minDepth = 1 } = {}) {
    const s = this.search;
    const t0 = Date.now();
    s.nodes = 0;
    s.aborted = false;
    s.age = (s.age + 1) & 0x3fffffff || 1;
    const me = pos.toPlay, pl0 = me === BLACK ? pos.bl : pos.wl, ph0 = me === BLACK ? pos.bh : pos.wh;
    const ol0 = me === BLACK ? pos.wl : pos.bl, oh0 = me === BLACK ? pos.wh : pos.bh;
    const empties = 64 - popcount(pl0) - popcount(ph0) - popcount(ol0) - popcount(oh0);
    mobility(pl0, ph0, ol0, oh0);
    const legal = listBits(R.lo, R.hi);
    const base = { toPlay: me, empties, nodes: 0, depth: 0, exact: false, moves: [], score: 0 };
    if (!legal.length) {
      // Must pass (or the game is over): the score is the opponent's view negated.
      mobility(ol0, oh0, pl0, ph0);
      const over = !(R.lo | R.hi);
      const score = over ? finalScore(pl0, ph0, ol0, oh0) : null;
      if (over) return { ...base, done: true, over: true, exact: true, score, pass: false };
      const sub = this.analyze({ ...pos, toPlay: 3 - me }, { depth, exact, maxTime, all: false, minDepth });
      let r;
      for (;;) { const x = sub.next(); if (x.done) { r = x.value; break; } yield { ...base, pass: true, score: -x.value.score }; }
      return { ...base, done: true, pass: true, score: -r.score, depth: r.depth, exact: r.exact, nodes: r.nodes, pv: [-1, ...(r.moves[0] ? [r.moves[0].move, ...r.moves[0].pv] : [])] };
    }
    s.setRoot(pos.bl, pos.bh, pos.wl, pos.wh);
    const moves = legal.map(m => ({ move: m, score: 0, pv: [], depth: 0, exact: false, bound: 0 }));
    // Initial order: a shallow look.
    const child = m => {
      flips(m.move, pl0, ph0, ol0, oh0);
      const fl = R.lo, fh = R.hi;
      const nl = pl0 | fl | (m.move < 32 ? 1 << m.move : 0), nh = ph0 | fh | (m.move >= 32 ? 1 << (m.move - 32) : 0);
      if (s.weights) s.updateFeatures(0, me, m.move, fl, fh);
      return [ol0 & ~fl, oh0 & ~fh, nl, nh];
    };
    for (const m of moves) { const [a, b, c, d] = child(m); m.score = -s.evalInt(1, 3 - me, a, b, c, d); }
    moves.sort((a, b) => b.score - a.score);

    const solveNow = empties <= exact;
    // Midgame depths first (quick feedback, and move order for the solve).
    const depths = [];
    const midMax = solveNow ? Math.min(depth, Math.max(1, empties - 8), 10) : Math.min(depth, empties - 1);
    for (let d = Math.min(2, midMax); d <= midMax; d++) depths.push(d);
    if (solveNow || depth >= empties - 1) depths.push(empties); // reaches the end: exact
    let result = { ...base, moves: moves.map(m => ({ ...m })), done: false };
    let finished = 0;
    s.deadline = maxTime === Infinity ? Infinity : t0 + maxTime;
    for (const d of depths) {
      const isExact = d >= empties;
      if (d > minDepth && Date.now() - t0 > maxTime) break;
      // Past minDepth the clock can cut a depth short.
      s.deadline = d <= minDepth || maxTime === Infinity ? Infinity : t0 + maxTime;
      let alpha = -127, bestScore = -127;
      let complete = true;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const [a, b, c, e] = child(m);
        let v;
        if (all || i === 0) {
          // Aspiration around the last depth's score, widened on a miss.
          const prev = m.depth ? m.score : null;
          if (prev !== null && !isExact) {
            let lo = prev - 4, hi = prev + 4;
            v = -s.pvs(a, b, c, e, 3 - me, d - 1, -hi, -lo, 1, false);
            if (!s.aborted && (v <= lo || v >= hi)) v = -s.pvs(a, b, c, e, 3 - me, d - 1, -127, 127, 1, false);
          } else v = -s.pvs(a, b, c, e, 3 - me, d - 1, -127, 127, 1, false);
          m.bound = 0;
        } else {
          v = -s.pvs(a, b, c, e, 3 - me, d - 1, -alpha - 1, -alpha, 1, false);
          if (!s.aborted && v > alpha) v = -s.pvs(a, b, c, e, 3 - me, d - 1, -127, -alpha, 1, false), m.bound = 0;
          else m.bound = -1; // at most v
        }
        if (s.aborted) { complete = false; break; }
        m.next = v;
        m.nextDepth = d;
        m.nextPv = s.pv(a, b, c, e);
        if (v > alpha) alpha = v;
        if (v > bestScore) bestScore = v;
        finished++;
        yield { ...result, done: false, searching: { depth: d, index: i, of: moves.length }, nodes: s.nodes };
        if (s.aborted) { complete = false; break; }
      }
      if (!complete) break;
      for (const m of moves) { m.score = m.next; m.depth = m.nextDepth; m.pv = m.nextPv; m.exact = isExact && m.bound === 0; }
      // Stable sort keeps the earlier order among equals.
      moves.sort((a, b) => b.score - a.score || (a.bound - b.bound));
      result = this.pack(base, moves, d, isExact, s.nodes, t0);
      yield { ...result, done: false };
    }
    if (!result.depth) {
      // Not even the first depth finished: fall back on the shallow order.
      result = this.pack(base, moves, 0, false, s.nodes, t0);
    }
    return { ...result, done: true };
  }

  pack(base, moves, depth, exact, nodes, t0) {
    const list = moves.map(m => ({ move: m.move, score: m.score | 0, pv: m.pv, exact: m.exact, bound: m.bound }));
    return { ...base, moves: list, score: list[0].score, depth, exact, nodes, ms: Date.now() - t0 };
  }

  run(pos, opts) {
    const g = this.analyze(pos, opts);
    for (;;) { const x = g.next(); if (x.done) return x.value; }
  }
}
