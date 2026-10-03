// The page's storage accessor (src/storage.js): blocked storage never stops
// the page, and whether writes are kept is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeStorage } from '../src/storage.js';

const fakeStorage = ({ refuseWrites = false } = {}) => {
  const m = new Map();
  return {
    refuse: refuseWrites,
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem(k, v) { if (this.refuse) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: k => m.delete(k),
    map: m,
  };
};

test('storage that cannot be had: memory, never throws, never durable', () => {
  const s = safeStorage(() => { throw new Error('SecurityError'); });
  assert.equal(s.durable, false);
  assert.equal(s.memoryOnly, true);
  s.setItem('a', 'b');
  assert.equal(s.getItem('a'), 'b');
  assert.equal(s.durable, false);
});

test('storage that works: durable, and nothing left behind by the probe', () => {
  const real = fakeStorage();
  const s = safeStorage(() => real);
  assert.equal(s.durable, true);
  assert.equal(real.map.size, 0);
  s.setItem('a', 'b');
  assert.equal(real.getItem('a'), 'b');
});

test('storage that reads but refuses writes: not durable, still read, a write throws', () => {
  const real = fakeStorage({ refuseWrites: true });
  real.map.set('game', 'saved before');
  const s = safeStorage(() => real);
  assert.equal(s.durable, false);
  assert.equal(s.getItem('game'), 'saved before');
  assert.throws(() => s.setItem('game', 'new'));
});

test('durable follows the last write', () => {
  const real = fakeStorage();
  const s = safeStorage(() => real);
  real.refuse = true;
  assert.throws(() => s.setItem('a', '1'));
  assert.equal(s.durable, false);
  real.refuse = false;
  s.setItem('a', '2');
  assert.equal(s.durable, true);
});
