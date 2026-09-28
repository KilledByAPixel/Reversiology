// Helpers for finding squares and for playing by keyboard or screen reader.
// Pure functions — no DOM, testable in node.
import { BLACK, WHITE, EMPTY, PASS, parseSq, sqName } from './board.js';

// Wraps the squares the coach mentions ("d3") in <span class="pt" data-pt>,
// outside tags only, so hovering one can show where it is.
export function linkPoints(html) {
  return html.split(/(<[^>]*>)/).map(part => part.startsWith('<') ? part
    : part.replace(/\b([a-h][1-8])\b/g, (m, c) => `<span class="pt" data-pt="${parseSq(c)}">${c}</span>`)).join('');
}

const WHY = { noflip: 'it flips nothing', mustpass: 'no legal moves, pass', over: 'the game is over' };

// What's on square p, for the keyboard cursor.
export function pointReadout(board, p, check) {
  const name = sqName(p), c = board.color[p];
  if (c === EMPTY) {
    const r = check(p);
    if (!r.ok) return `${name}, empty, can't play: ${WHY[r.reason] || r.reason}`;
    const n = board.flips(p).length;
    return `${name}, empty, legal, flips ${n} ${n === 1 ? 'disc' : 'discs'}`;
  }
  return `${name}, ${c === BLACK ? 'black' : 'white'} disc`;
}

// "You played d3, flipping 2 discs.", "Black passed."
export function movePhrase(who, move, flipped) {
  if (move === PASS) return `${who} passed.`;
  return `${who} played ${sqName(move)}${flipped ? `, flipping ${flipped} ${flipped === 1 ? 'disc' : 'discs'}` : ''}.`;
}

export const plainText = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// "Move 12, White e6.", "Start."
export function positionPhrase(depth, color, move) {
  if (!depth) return 'Start.';
  const who = color === BLACK ? 'Black' : 'White';
  return move === PASS ? `Move ${depth}, ${who} passed.` : `Move ${depth}, ${who} ${sqName(move)}.`;
}

// "Black wins 40 to 24.", "A draw, 32 each."
export function resultPhrase(score) {
  if (!score.winner) return 'A draw, 32 each.';
  const [b, w] = score.final;
  return `${score.winner === BLACK ? 'Black' : 'White'} wins ${Math.max(b, w)} to ${Math.min(b, w)}.`;
}

export { WHITE };
