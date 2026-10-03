// The page's text (index.html and src/app.js): every element the code looks
// up exists, ids are unique, and the browser's storage is reached in one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('every id the code looks up is in the page', () => {
  const ids = new Set();
  for (const re of [/\$\('#([\w-]+)'\)/g, /querySelector\('#([\w-]+)'\)/g, /getElementById\('([\w-]+)'\)/g]) {
    for (const m of app.matchAll(re)) ids.add(m[1]);
  }
  assert.ok(ids.size > 30, `the patterns still match (${ids.size} ids)`);
  const missing = [...ids].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('no id is used twice', () => {
  const seen = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([id]) => id), []);
});

test('the browser\'s storage is reached in one place, and a game that isn\'t saved says so', () => {
  assert.equal(app.match(/localStorage/g).length, 1, 'only safeStorage(() => localStorage)');
  assert.match(html, /id="saveNote"[^>]*hidden>Your game is not being saved in this browser\. Use Save game to keep it\./);
});
