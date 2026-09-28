// Reversi board for the game record and the coach's explanations: a plain
// 64-square array, easy to read and to reason about. The search has its own
// bitboards (engine/bits.js); this one is the reference they're tested against.
// Squares: row * 8 + col, a1 (top left) = 0, h8 = 63.

export const N = 8;
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const PASS = -1;
export const opp = c => 3 - c;
export const SQUARES = Array.from({ length: 64 }, (_, i) => i);
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]];

export const sq = (x, y) => y * N + x;
export const sqX = p => p & 7;
export const sqY = p => p >> 3;
export const sqName = p => p === PASS ? 'pass' : 'abcdefgh'[p & 7] + ((p >> 3) + 1);
export function parseSq(s) {
  const t = String(s).trim().toLowerCase();
  if (t === 'pass' || t === 'pa' || t === '--') return PASS;
  const m = /^([a-h])([1-8])$/.exec(t);
  return m ? sq(m[1].charCodeAt(0) - 97, +m[2] - 1) : null;
}

export const CORNERS = [0, 7, 56, 63];
// X-squares (diagonally next to a corner) and C-squares (next to it along an
// edge), each with the corner it belongs to.
export const X_SQUARES = new Map([[9, 0], [14, 7], [49, 56], [54, 63]]);
export const C_SQUARES = new Map([[1, 0], [8, 0], [6, 7], [15, 7], [48, 56], [57, 56], [55, 63], [62, 63]]);
export const isEdge = p => sqX(p) === 0 || sqX(p) === 7 || sqY(p) === 0 || sqY(p) === 7;

export class Board {
  constructor() {
    this.color = new Uint8Array(64);
    this.color[sq(3, 3)] = WHITE; this.color[sq(4, 4)] = WHITE;
    this.color[sq(4, 3)] = BLACK; this.color[sq(3, 4)] = BLACK;
    this.toPlay = BLACK;
    this.lastMove = PASS;
    this.passes = 0;       // consecutive passes just played
    this.moveCount = 0;
  }

  clone() {
    const b = Object.create(Board.prototype);
    b.color = this.color.slice();
    b.toPlay = this.toPlay; b.lastMove = this.lastMove; b.passes = this.passes; b.moveCount = this.moveCount;
    return b;
  }

  count(c) { let n = 0; for (let i = 0; i < 64; i++) if (this.color[i] === c) n++; return n; }
  get empties() { return this.count(EMPTY); }

  // Discs that playing p as colour c would flip (empty: not a legal move).
  flips(p, c = this.toPlay) {
    if (p < 0 || this.color[p] !== EMPTY) return [];
    const out = [], o = 3 - c, x0 = sqX(p), y0 = sqY(p);
    for (const [dx, dy] of DIRS) {
      const line = [];
      let x = x0 + dx, y = y0 + dy;
      while (x >= 0 && x < 8 && y >= 0 && y < 8 && this.color[sq(x, y)] === o) { line.push(sq(x, y)); x += dx; y += dy; }
      if (line.length && x >= 0 && x < 8 && y >= 0 && y < 8 && this.color[sq(x, y)] === c) out.push(...line);
    }
    return out;
  }

  isLegal(p, c = this.toPlay) { return this.flips(p, c).length > 0; }

  legalMoves(c = this.toPlay) {
    const out = [];
    for (let p = 0; p < 64; p++) if (this.color[p] === EMPTY && this.isLegal(p, c)) out.push(p);
    return out;
  }

  // Neither side can move: the game is over.
  get isOver() { return !this.legalMoves(BLACK).length && !this.legalMoves(WHITE).length; }
  // The side to move has no move and must pass.
  get mustPass() { return !this.legalMoves().length && !this.isOver; }

  // Plays p (or PASS) for the side to move. Returns the flipped discs, or null if illegal.
  play(p) {
    const c = this.toPlay;
    if (p === PASS) {
      this.toPlay = 3 - c; this.lastMove = PASS; this.passes++; this.moveCount++;
      return [];
    }
    const f = this.flips(p, c);
    if (!f.length) return null;
    this.color[p] = c;
    for (const q of f) this.color[q] = c;
    this.toPlay = 3 - c; this.lastMove = p; this.passes = 0; this.moveCount++;
    return f;
  }

  // Final score as black minus white, with empty squares going to the winner
  // (the World Othello Federation rule).
  finalMargin() {
    const b = this.count(BLACK), w = this.count(WHITE), e = 64 - b - w;
    return b > w ? b - w + e : b < w ? b - w - e : 0;
  }

  // 64 characters, 'X' black, 'O' white, '-' empty (the common text format).
  toString() {
    let s = '';
    for (let i = 0; i < 64; i++) s += '-XO'[this.color[i]];
    return s;
  }

  static fromString(s, toPlay = BLACK) {
    const b = new Board();
    const t = s.replace(/\s+/g, '');
    for (let i = 0; i < 64; i++) {
      const ch = t[i];
      b.color[i] = ch === 'X' || ch === 'x' || ch === '*' || ch === 'B' ? BLACK : ch === 'O' || ch === 'o' || ch === 'W' ? WHITE : EMPTY;
    }
    b.toPlay = toPlay;
    return b;
  }

  // Readable grid, for tests and debugging.
  pretty() {
    let s = '  a b c d e f g h\n';
    for (let y = 0; y < 8; y++) {
      s += (y + 1);
      for (let x = 0; x < 8; x++) s += ' ' + '.XO'[this.color[sq(x, y)]];
      s += '\n';
    }
    return s + `${this.toPlay === BLACK ? 'X' : 'O'} to play`;
  }
}

// The eight symmetries of the square, as square maps.
export const SYMMETRIES = [];
for (let s = 0; s < 8; s++) {
  const map = new Int8Array(64);
  for (let p = 0; p < 64; p++) {
    let x = sqX(p), y = sqY(p);
    if (s & 1) x = 7 - x;
    if (s & 2) y = 7 - y;
    if (s & 4) [x, y] = [y, x];
    map[p] = sq(x, y);
  }
  SYMMETRIES.push(map);
}
