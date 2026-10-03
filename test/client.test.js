// The page's engine handle (src/engine-client.js) with a fake Worker and
// fetch: the download has a deadline, and a worker that broke is replaced by
// the next search. Each test imports a fresh copy of the module (the download
// is cached for the life of the module).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const workers = [];
class FakeWorker {
  constructor() { this.posted = []; this.terminated = false; workers.push(this); }
  postMessage(m) {
    this.posted.push(m);
    // Answer searches at once, unless the test holds them.
    if (m.type === 'search' && !this.hold) queueMicrotask(() => this.onmessage && this.onmessage({ data: { type: 'done', id: m.id, results: { ok: true } } }));
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;
const real = globalThis.fetch;
let stamp = 0;
async function fresh(fetchImpl, ms = 50) {
  workers.length = 0;
  globalThis.fetch = fetchImpl;
  const mod = await import(`../src/engine-client.js?fresh=${++stamp}`);
  mod.Engine.downloadMs = ms;
  mod.Engine.onError = null;
  return mod;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = n => () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(n)) });
const never = () => new Promise(() => {});
const weightsMsg = w => w.posted.find(m => m.type === 'weights');
const board = { color: new Array(64).fill(0), toPlay: 1 };
test.after(() => { globalThis.fetch = real; });

test('engine data that arrives is sent to the worker, and the deadline then changes nothing', async () => {
  const { Engine } = await fresh(ok(8));
  const e = new Engine('t');
  await wait(80);
  const m = weightsMsg(e.worker);
  assert.equal(m.bytes.byteLength, 8);
  assert.equal(m.wasm.byteLength, 8);
  assert.equal(m.error, undefined);
  assert.equal(e.worker.posted.filter(x => x.type === 'weights').length, 1);
});

test('a download that never answers is given up at the deadline, and the worker is told', async () => {
  const { Engine } = await fresh(never, 30);
  const e = new Engine('t');
  await wait(10);
  assert.equal(weightsMsg(e.worker), undefined, 'still waiting');
  await wait(60);
  const m = weightsMsg(e.worker);
  assert.match(m.error, /too long/);
  assert.equal(m.wasm, null);
});

test('headers that arrive with a body that never does are given up the same way', async () => {
  const { Engine } = await fresh(() => Promise.resolve({ ok: true, arrayBuffer: never }), 30);
  const e = new Engine('t');
  await wait(80);
  assert.match(weightsMsg(e.worker).error, /too long/);
});

test('arrived weights are kept when only the core stalls; a failed download says why', async () => {
  let { Engine } = await fresh(url => String(url).endsWith('.wasm') ? never() : ok(4)(), 30);
  let e = new Engine('t');
  await wait(80);
  assert.equal(weightsMsg(e.worker).bytes.byteLength, 4);
  assert.equal(weightsMsg(e.worker).wasm, null, 'searches in JavaScript instead');
  ({ Engine } = await fresh(() => Promise.resolve({ ok: false, status: 404 })));
  e = new Engine('t');
  await wait(20);
  assert.match(weightsMsg(e.worker).error, /404/);
});

test('a worker that broke before any search is replaced by the next search, which is answered', async () => {
  const { Engine } = await fresh(ok(4));
  const reports = [];
  Engine.onError = (name, msg) => reports.push(msg);
  const e = new Engine('t');
  const first = e.worker;
  first.onerror({ message: 'boom' });
  assert.ok(first.terminated);
  assert.deepEqual(await e.search(board), { ok: true });
  assert.notEqual(e.worker, first, 'a new worker');
  assert.deepEqual(reports, ['boom']);
  await wait(20);
  assert.ok(weightsMsg(e.worker), 'the new worker is sent the data too');
});

test('a worker that breaks during a search answers it with null; the next search is answered', async () => {
  const { Engine } = await fresh(ok(4));
  const e = new Engine('t');
  e.worker.hold = true;
  const p = e.search(board);
  e.worker.onerror({ message: 'boom' });
  assert.equal(await p, null);
  assert.deepEqual(await e.search(board), { ok: true });
});

test('two failures in a row give null and one report each, and a replaced worker is nobody\'s', async () => {
  const { Engine } = await fresh(ok(4));
  const reports = [];
  Engine.onError = (name, msg) => reports.push(msg);
  const e = new Engine('t');
  const w1 = e.worker; w1.hold = true;
  const p1 = e.search(board);
  w1.onerror({ message: 'one' });
  w1.onerror({ message: 'again' }); // the same broken worker: already reported
  assert.equal(await p1, null);
  const p2 = e.search(board);
  const w2 = e.worker; w2.hold = true;
  w2.onerror({ message: 'two' });
  assert.equal(await p2, null);
  w1.onmessage({ data: { type: 'done', id: 99, results: {} } }); // late, from a replaced worker
  assert.deepEqual(reports, ['one', 'two']);
  assert.equal(e.busy, false, 'nothing left waiting');
  assert.equal(workers.length, 2, 'one new worker per search asked for');
});
