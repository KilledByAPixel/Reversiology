// Reversi ideas the coach and the board overlays talk about: stable discs,
// frontier discs, dangerous squares next to empty corners, and the empty
// regions that matter for parity at the end. Pure functions on a Board.
import { BLACK, WHITE, EMPTY, CORNERS, X_SQUARES, C_SQUARES, sq, sqX, sqY } from './board.js';

const LINES = [[1, 0], [0, 1], [1, 1], [1, -1]];
const inside = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;

// Discs that can never be flipped again. A disc is stable when, along each
// of the four lines through it, the line is full or it's anchored on one side
// by the edge or a stable disc of its own colour. Found by growing the set
// until nothing more qualifies (an underestimate in rare shapes, never an over).
export function stableDiscs(board) {
  const c = board.color, stable = new Uint8Array(64);
  // Lines with no empty square: every disc on them is safe along that line.
  const full = LINES.map(([dx, dy]) => {
    const f = new Uint8Array(64);
    for (let p = 0; p < 64; p++) {
      if (c[p] === EMPTY) continue;
      let ok = true;
      for (const s of [1, -1]) {
        let x = sqX(p) + dx * s, y = sqY(p) + dy * s;
        while (inside(x, y)) { if (c[sq(x, y)] === EMPTY) { ok = false; break; } x += dx * s; y += dy * s; }
        if (!ok) break;
      }
      f[p] = ok ? 1 : 0;
    }
    return f;
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (let p = 0; p < 64; p++) {
      if (c[p] === EMPTY || stable[p]) continue;
      let ok = true;
      for (let l = 0; l < 4 && ok; l++) {
        if (full[l][p]) continue;
        const [dx, dy] = LINES[l];
        const a = [sqX(p) + dx, sqY(p) + dy], b = [sqX(p) - dx, sqY(p) - dy];
        const safe = ([x, y]) => !inside(x, y) || (c[sq(x, y)] === c[p] && stable[sq(x, y)]);
        ok = safe(a) || safe(b);
      }
      if (ok) { stable[p] = 1; changed = true; }
    }
  }
  const out = new Set();
  for (let p = 0; p < 64; p++) if (stable[p]) out.add(p);
  return out;
}

export const countStable = (board, color) => { let n = 0; for (const p of stableDiscs(board)) if (board.color[p] === color) n++; return n; };

// Discs next to an empty square: the ones that give the opponent moves.
export function frontierDiscs(board, color = 0) {
  const c = board.color, out = new Set();
  for (let p = 0; p < 64; p++) {
    if (c[p] === EMPTY || (color && c[p] !== color)) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = sqX(p) + dx, y = sqY(p) + dy;
      if ((dx || dy) && inside(x, y) && c[sq(x, y)] === EMPTY) { out.add(p); dx = dy = 2; }
    }
  }
  return out;
}

// Empty X- and C-squares whose corner is still empty: playing there usually
// helps the opponent to the corner. Map square → 'x' | 'c'.
export function dangerSquares(board) {
  const out = new Map();
  for (const [p, corner] of X_SQUARES) if (board.color[p] === EMPTY && board.color[corner] === EMPTY) out.set(p, 'x');
  for (const [p, corner] of C_SQUARES) if (board.color[p] === EMPTY && board.color[corner] === EMPTY) out.set(p, 'c');
  return out;
}

// Connected groups of empty squares (touching along a side or a corner).
export function emptyRegions(board) {
  const seen = new Uint8Array(64), regions = [];
  for (let p = 0; p < 64; p++) {
    if (board.color[p] !== EMPTY || seen[p]) continue;
    const reg = [p];
    seen[p] = 1;
    for (let i = 0; i < reg.length; i++) {
      const q = reg[i];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = sqX(q) + dx, y = sqY(q) + dy;
        if (!inside(x, y)) continue;
        const r = sq(x, y);
        if (board.color[r] === EMPTY && !seen[r]) { seen[r] = 1; reg.push(r); }
      }
    }
    regions.push(reg);
  }
  return regions;
}

export const regionOf = (regions, p) => regions.find(r => r.includes(p)) || null;

// Which corner (if any) a square is next to, and how.
export function cornerRelation(p) {
  if (CORNERS.includes(p)) return { kind: 'corner', corner: p };
  if (X_SQUARES.has(p)) return { kind: 'x', corner: X_SQUARES.get(p) };
  if (C_SQUARES.has(p)) return { kind: 'c', corner: C_SQUARES.get(p) };
  return null;
}

export const mobility = (board, color) => board.legalMoves(color).length;
export { BLACK, WHITE };
