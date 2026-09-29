// Game record: a tree of positions (so take-backs and "what if" branches are
// never lost), rule checks with human-readable reasons, the final count, and
// saving and loading as move transcripts ("f5d6c3...").
import { Board, BLACK, WHITE, EMPTY, PASS, sqName, parseSq } from './board.js';

let nextId = 1;

export class GameNode {
  constructor(parent, move, color, board) {
    this.id = nextId++;
    this.parent = parent;
    this.move = move;          // PASS for the root / a pass
    this.color = color;        // who played the move (0 at the root)
    this.board = board;        // position after the move
    this.children = [];
    this.lastChild = null;     // branch to follow on redo
    this.flipped = [];         // discs this move flipped
    this.analysis = null;      // the coach's read of this position
    this.comment = '';
    this.depth = parent ? parent.depth + 1 : 0;
  }
  get isPass() { return this.parent !== null && this.move === PASS; }
}

// Handicap: the player receiving it starts with discs on the corners, in this order.
export const HANDICAP_CORNERS = [0, 63, 7, 56];

export class Game {
  // handicap: corners given to `handicapColor` before the first move.
  // setup: [[square, colour], ...] for a custom start (replaces the usual four discs).
  constructor({ handicap = 0, handicapColor = BLACK, setup = null, toPlay = BLACK } = {}) {
    const board = new Board();
    this.handicap = 0;
    this.handicapColor = handicapColor;
    if (setup) {
      board.color.fill(EMPTY);
      for (const [p, c] of setup) board.color[p] = c;
      board.toPlay = toPlay;
    } else if (handicap) {
      this.handicap = Math.min(4, handicap);
      for (const p of HANDICAP_CORNERS.slice(0, this.handicap)) board.color[p] = handicapColor;
    }
    this.setup = setup || (this.handicap ? HANDICAP_CORNERS.slice(0, this.handicap).map(p => [p, handicapColor]) : null);
    this.root = new GameNode(null, PASS, 0, board);
    this.current = this.root;
  }

  get board() { return this.current.board; }
  get toPlay() { return this.current.board.toPlay; }

  // { ok, reason } — reason is 'occupied', 'noflip', 'mustpass', 'notpass' or 'over'.
  check(p, node = this.current) {
    const b = node.board;
    if (b.isOver) return { ok: false, reason: 'over' };
    if (p === PASS) return b.legalMoves().length ? { ok: false, reason: 'notpass' } : { ok: true };
    if (b.color[p] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (!b.isLegal(p)) return { ok: false, reason: b.legalMoves().length ? 'noflip' : 'mustpass' };
    return { ok: true };
  }

  // Plays at the current node. Re-uses an existing branch with the same move.
  play(p) {
    const node = this.current;
    const existing = node.children.find(ch => ch.move === p);
    if (existing) { node.lastChild = existing; this.current = existing; return existing; }
    if (!this.check(p, node).ok) return null;
    const b = node.board.clone();
    const color = b.toPlay;
    const flipped = b.play(p);
    const child = new GameNode(node, p, color, b);
    child.flipped = flipped;
    node.children.push(child);
    node.lastChild = child;
    this.current = child;
    return child;
  }

  pass() { return this.play(PASS); }
  undo() { if (this.current.parent) this.current = this.current.parent; return this.current; }
  redo() {
    const n = this.current.lastChild || this.current.children[0];
    if (n) this.current = n;
    return this.current;
  }
  goTo(node) {
    this.current = node;
    for (let n = node; n.parent; n = n.parent) n.parent.lastChild = n;
  }

  // Root → current, then onward along remembered branches.
  line(node = this.current) {
    const path = [];
    for (let n = node; n; n = n.parent) path.unshift(n);
    let n = node;
    while (n.lastChild || n.children[0]) { n = n.lastChild || n.children[0]; path.push(n); }
    return path;
  }

  isOver(node = this.current) { return node.board.isOver; }

  deleteBranch(node) {
    const parent = node.parent;
    if (!parent) return;
    parent.children = parent.children.filter(c => c !== node);
    if (parent.lastChild === node) parent.lastChild = parent.children[0] || null;
    let inside = false;
    for (let n = this.current; n; n = n.parent) if (n === node) inside = true;
    if (inside) this.current = parent;
  }

  // The count: discs of each colour, empties (which go to the winner) and
  // the margin, black minus white.
  score(node = this.current) {
    const b = node.board;
    const black = b.count(BLACK), white = b.count(WHITE), empty = 64 - black - white;
    const margin = b.finalMargin();
    return {
      black, white, empty, margin,
      winner: margin > 0 ? BLACK : margin < 0 ? WHITE : 0,
      // Empties go to the winner: the usual way to write the final score.
      final: margin > 0 ? [black + empty, white] : margin < 0 ? [black, white + empty] : [black + empty / 2, white + empty / 2],
      text: margin === 0 ? 'Draw' : `${black > white ? black + (empty ? empty : 0) : black}–${white > black ? white + empty : white}`,
    };
  }

  // ------------------------------------------------------------------ transcripts

  // The main line (or the line to `node`) as "f5d6c3...". Passes aren't
  // written: they're implied, since only a player without moves passes.
  transcript(node = null) {
    const line = node ? this.line(node).slice(0, this.line(node).indexOf(node) + 1) : this.line(this.root);
    return line.filter(n => n.parent && n.move !== PASS).map(n => sqName(n.move)).join('');
  }

  // Saves the whole tree, variations included, as text: an optional setup line,
  // then the main line; variations follow in parentheses after the move they replace.
  //   "f5 d6 c3 (c5 f4) d3 c4"
  toText() {
    let s = '';
    if (this.setup) s += `setup ${this.setupString()} ${this.root.board.toPlay === WHITE ? 'O' : 'X'}\n`;
    const walk = node => {
      const out = [];
      let n = node;
      while (n.children.length) {
        const [main, ...rest] = n.children;
        out.push(main.move === PASS ? 'pass' : sqName(main.move));
        for (const v of rest) out.push(`(${[v.move === PASS ? 'pass' : sqName(v.move), walk(v)].filter(Boolean).join(' ')})`);
        n = main;
      }
      return out.join(' ');
    };
    return s + walk(this.root);
  }

  setupString() {
    let s = '';
    for (let i = 0; i < 64; i++) s += '-XO'[this.root.board.color[i]];
    return s;
  }

  // Reads toText() output, or a plain transcript ("f5d6c3d3c4" or
  // "F5 D6 C3 ..."), or a board of 64 characters (X, O, -) and the side to
  // move followed by moves. Passes may be written or left out.
  static fromText(text) {
    let src = text.replace(/\r/g, '');
    let game;
    const setup = /(?:^|\n)\s*(?:setup\s+)?([-XO*.]{64})\s+([XOBW])\b/i.exec(src);
    if (setup) {
      const cells = [...setup[1]];
      const stones = [];
      cells.forEach((ch, i) => { if (/[X*]/i.test(ch)) stones.push([i, BLACK]); else if (/O/i.test(ch)) stones.push([i, WHITE]); });
      const toPlay = /[OW]/i.test(setup[2]) ? WHITE : BLACK;
      game = new Game({ setup: stones, toPlay });
      // A standard start with extra corners is a handicap game.
      const std = new Board();
      const extra = stones.filter(([p, c]) => std.color[p] !== c);
      const missing = [...std.color].some((c, i) => c && !stones.some(([p, k]) => p === i && k === c));
      const handicapSquares = HANDICAP_CORNERS.slice(0, extra.length);
      if (!missing && extra.length && toPlay === BLACK && extra.every(([p, c]) => handicapSquares.includes(p) && c === extra[0][1])) {
        game = new Game({ handicap: extra.length, handicapColor: extra[0][1] });
      }
      src = src.slice(0, setup.index) + ' ' + src.slice(setup.index + setup[0].length);
    } else game = new Game();
    // Tokens: moves, "pass", and parentheses for variations. Comments (# ...),
    // bracketed tags ([Event "..."], {...}), move numbers and separators are
    // skipped; anything else means this isn't a game record.
    src = src.replace(/#[^\n]*/g, ' ').replace(/\[[^\]\n]*\]|\{[^}]*\}/g, ' ');
    const TOKEN = /\(|\)|pass|pa|--|[a-h][1-8]/gi;
    const junk = src.replace(TOKEN, ' ').replace(/\d+\.+|[,;.\-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (junk) throw new Error(`it isn't a game record ("${junk.length > 24 ? junk.slice(0, 24).trim() + '…' : junk}" isn't a move)`);
    const tokens = src.match(TOKEN) || [];
    if (!setup && !tokens.some(t => t !== '(' && t !== ')')) throw new Error('there are no moves in it');
    let i = 0;
    const parse = (from, first) => {
      let node = from;
      while (i < tokens.length) {
        const t = tokens[i];
        if (t === ')') {
          if (first) throw new Error('a closing bracket has no opening one');
          i++; return;
        }
        if (t === '(') {
          i++;
          // A variation replaces the last move: it branches from its parent.
          parse(node.parent || node, false);
          continue;
        }
        i++;
        const mv = parseSq(t);
        game.current = node;
        // A player without moves passes, whether or not the record says so.
        if (mv !== PASS && !node.board.legalMoves().length && !node.board.isOver) node = game.play(PASS);
        game.current = node;
        const child = game.play(mv);
        if (!child) throw new Error(`${sqName(mv)} isn't a legal move after ${game.transcript(node) || 'the start'}`);
        node = child;
      }
      if (!first) throw new Error('a variation is missing its closing bracket');
    };
    parse(game.root, true);
    // A trailing forced pass is part of the position.
    game.current = game.root;
    const stack = [game.root];
    while (stack.length) {
      const n = stack.pop();
      n.lastChild = n.children[0] || null;
      stack.push(...n.children);
    }
    return game;
  }
}

export function reasonText(reason) {
  return {
    occupied: 'That square is already taken.',
    noflip: 'A move must flip at least one disc: place your disc so it traps a line of your opponent\'s discs between it and another of yours.',
    mustpass: 'You have no legal move, so you must pass.',
    notpass: 'You can only pass when you have no legal move.',
    over: 'The game is over.',
  }[reason] || '';
}

export const colorName = c => c === BLACK ? 'Black' : c === WHITE ? 'White' : '';
export { sqName };
