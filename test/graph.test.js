// The game graph (src/graph.js): where mistake dots go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGraph } from '../src/graph.js';

test('mistake dots sit on the disc-lead line in handicap games', () => {
  // Black far ahead the whole game: the win chance is pinned near the top, the lead isn't.
  const line = [0, 1, 2, 3].map(i => ({ id: i, analysis: { blackWinrate: 0.99, blackScore: 4 + i * 4 } }));
  const mark = n => n.id === 2 ? { color: '#e07b2c' } : null;
  const dotY = opts => { const el = {}; renderGraph(el, line, line[3], () => {}, mark, opts); return +/<circle[^>]*cy="([\d.]+)"/.exec(el.innerHTML)[1]; };
  const onWin = dotY(), onScore = dotY({ dotsOnScore: true });
  assert.ok(onWin < 10, 'on the win-chance line, at the very top');
  assert.ok(onScore > 30 && onScore < 75, 'on the disc-lead line, where the change shows');
});
