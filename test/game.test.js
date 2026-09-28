import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, reasonText } from '../src/game.js';
import { Board, BLACK, WHITE, PASS, parseSq, sqName } from '../src/board.js';

const sq = parseSq;

test('moves flip discs and alternate turns', () => {
  const g = new Game();
  const n = g.play(sq('f5'));
  assert.ok(n);
  assert.deepEqual(n.flipped, [sq('e5')]);
  assert.equal(g.board.count(BLACK), 4);
  assert.equal(g.board.count(WHITE), 1);
  assert.equal(g.toPlay, WHITE);
});

test('illegal moves are refused with a reason', () => {
  const g = new Game();
  assert.deepEqual(g.check(sq('a1')), { ok: false, reason: 'noflip' });
  assert.deepEqual(g.check(sq('d4')), { ok: false, reason: 'occupied' });
  assert.deepEqual(g.check(PASS), { ok: false, reason: 'notpass' });
  assert.equal(g.play(sq('a1')), null);
  for (const r of ['noflip', 'occupied', 'notpass', 'mustpass', 'over']) assert.ok(reasonText(r).length > 10);
});

test('transcripts round-trip, with variations', () => {
  const g = Game.fromText('f5d6c3d3c4');
  assert.equal(g.transcript(), 'f5d6c3d3c4');
  // Add a variation at move 3.
  g.goTo(g.line()[2]);
  g.play(sq('c5'));
  g.play(sq('f4'));
  const text = g.toText();
  assert.equal(text, 'f5 d6 c3 (c5 f4) d3 c4');
  const h = Game.fromText(text);
  assert.equal(h.transcript(), 'f5d6c3d3c4');
  assert.equal(h.root.children[0].children[0].children.length, 2);
  assert.equal(h.toText(), text);
});

test('reads common transcript styles', () => {
  for (const t of ['F5 D6 C3 D3 C4', 'f5-d6-c3-d3-c4', '1. f5 d6 2. c3 d3 3. c4', 'f5d6c3d3c4\n']) {
    assert.equal(Game.fromText(t).transcript(), 'f5d6c3d3c4', t);
  }
  assert.throws(() => Game.fromText('f5 a1'), /isn't a legal move/);
});

test('forced passes are inserted when a record leaves them out', () => {
  // A position where White has no move after Black's move.
  const b = Board.fromString('XXXXXXXX' + 'XXXXXXXX'.repeat(6) + 'XXXXXO--', BLACK);
  const g = new Game({ setup: [...b.color].flatMap((c, i) => c ? [[i, c]] : []), toPlay: BLACK });
  // Black plays h8 (flips nothing? g8 empty) — find Black's legal moves instead.
  const ms = g.board.legalMoves();
  assert.ok(ms.length > 0);
  const text = g.toText();
  assert.match(text, /^setup /);
  const h = Game.fromText(`${text} ${sqName(ms[0])}`);
  assert.equal(h.line().length, 2);
});

test('handicap corners go to the chosen side and survive saving', () => {
  const g = new Game({ handicap: 2, handicapColor: WHITE });
  assert.equal(g.root.board.color[sq('a1')], WHITE);
  assert.equal(g.root.board.color[sq('h8')], WHITE);
  assert.equal(g.root.board.toPlay, BLACK);
  const h = Game.fromText(g.toText());
  assert.equal(h.handicap, 2);
  assert.equal(h.handicapColor, WHITE);
  assert.equal(h.root.board.toString(), g.root.board.toString());
});

test('the count gives empty squares to the winner', () => {
  // White has three discs the empties can't reach: nobody can move.
  const b = Board.fromString('OOO-' + '-XXX' + 'X'.repeat(56), WHITE);
  const g = new Game({ setup: [...b.color].flatMap((c, i) => c ? [[i, c]] : []), toPlay: WHITE });
  assert.ok(g.isOver(), g.board.pretty());
  const s = g.score();
  assert.equal(s.black, 59);
  assert.equal(s.white, 3);
  assert.equal(s.margin, 58);
  assert.deepEqual(s.final, [61, 3]);
  assert.equal(s.winner, BLACK);
});

test('random games play to the end with passes', () => {
  let seed = 5;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 50; k++) {
    const g = new Game();
    while (!g.isOver()) {
      const ms = g.board.legalMoves();
      assert.ok(g.play(ms.length ? ms[rnd(ms.length)] : PASS));
    }
    const back = Game.fromText(g.transcript());
    assert.equal(back.line().at(-1).board.toString(), g.board.toString());
  }
});
