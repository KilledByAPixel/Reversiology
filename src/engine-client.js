// Main-thread handle to an engine worker. search() returns a promise for the
// final results and streams progress; starting a new search cancels the old one.

// How long the evaluation weights and the WebAssembly core may take to arrive.
// The weights are 4.5 MB: generous, but a request that stalls must not leave
// every worker (and the AI's turn) waiting for ever.
export const DOWNLOAD_MS = 60000;

// The evaluation weights and the WebAssembly search core, downloaded once and
// handed to every worker: { bytes } or { error } for the weights, and wasm (or
// null: the workers then search in JavaScript). At the deadline, whatever has
// arrived is used and the rest is given up.
let data = null;
function loadData() {
  return data ||= new Promise(resolve => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const signal = ctl ? ctl.signal : undefined;
    let weights = null, wasm, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...(weights || { error: 'the evaluation took too long to arrive' }), wasm: wasm || null });
    };
    const timer = setTimeout(() => { finish(); if (ctl) ctl.abort(); }, Engine.downloadMs);
    fetch(new URL('../weights/eval.bin.gz', import.meta.url), { signal })
      .then(res => { if (!res.ok) throw new Error(`couldn't load the evaluation (${res.status})`); return res.arrayBuffer(); })
      .then(bytes => ({ bytes }), e => ({ error: e.message || String(e) }))
      .then(w => { weights = w; if (wasm !== undefined) finish(); });
    fetch(new URL('./engine/core.wasm', import.meta.url), { signal })
      .then(res => res.ok ? res.arrayBuffer() : null)
      .then(c => c, () => null)
      .then(c => { wasm = c; if (weights) finish(); });
  });
}

export class Engine {
  // ttBits: the size of the worker's transposition table (2^ttBits entries,
  // 24 bytes each).
  constructor(name, { ttBits = 18 } = {}) {
    this.name = name;
    this.ttBits = ttBits;
    this.nextId = 1;
    this.pending = null;
    this.start();
  }

  // A new worker, sent the engine data. A worker that broke (an error event)
  // is replaced this way by the next search; messages and errors from a
  // replaced worker are nobody's.
  start() {
    let worker;
    try { worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' }); } catch (err) {
      // No worker at all (a strict content policy, say): the page still works,
      // and searches answer null as a broken worker's do.
      this.worker = null;
      this.failed = true;
      if (!this.reported && Engine.onError) Engine.onError(this.name, String(err && err.message || err));
      this.reported = true;
      return;
    }
    this.worker = worker;
    this.failed = false;
    loadData().then(d => {
      if (this.worker !== worker) return;
      // Each worker gets its own copy (transferred, so it isn't copied twice).
      const bytes = d.bytes && d.bytes.slice(0), wasm = d.wasm && d.wasm.slice(0);
      worker.postMessage({ type: 'weights', bytes, wasm, ttBits: this.ttBits, error: d.error }, [bytes, wasm].filter(Boolean));
    });
    worker.onmessage = e => { if (this.worker === worker && !this.failed) this.onMessage(e.data); };
    worker.onerror = e => {
      if (this.worker !== worker || this.failed) return;
      console.error(`${this.name} worker error`, e.message);
      this.failed = true;
      try { worker.terminate(); } catch { /* already gone */ }
      // Fail the running search instead of leaving the caller waiting for ever.
      const job = this.pending;
      this.pending = null;
      if (job) job.resolve(null);
      if (Engine.onError) Engine.onError(this.name, e.message || 'failed to load');
    };
  }

  // board: a Board (only its squares and side to move are sent).
  // opts: engine options (depth, exact, all, maxTime, minDepth), plus
  // onProgress(results, done) and reportMs.
  search(board, { onProgress = null, reportMs = 250, ...opts } = {}) {
    this.cancel();
    if (this.failed) this.start(); // one new worker per search asked for, never a loop
    if (!this.worker) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending = { id, resolve, onProgress };
      this.worker.postMessage({ type: 'search', id, color: Array.from(board.color), toPlay: board.toPlay, opts, reportMs });
    });
  }

  cancel() {
    if (!this.pending) return;
    if (!this.failed) this.worker.postMessage({ type: 'stop' });
    this.pending.resolve(null);
    this.pending = null;
  }

  get busy() { return !!this.pending; }

  onMessage(msg) {
    if (msg.type === 'warning') { if (Engine.onWarning) Engine.onWarning(this.name, msg.message); return; }
    const job = this.pending;
    if (!job || msg.id !== job.id) return;
    if (msg.type === 'progress') { if (job.onProgress) job.onProgress(msg.results, false); return; }
    if (msg.type === 'done') {
      this.pending = null;
      // A callback that throws mustn't leave the search waiting for ever; an
      // empty result (a failed search) isn't a finished read to report.
      try { if (job.onProgress && msg.results) job.onProgress(msg.results, true); } finally { job.resolve(msg.results); }
    }
  }
}
Engine.downloadMs = DOWNLOAD_MS; // (tests make it short)

// Several engines, each given its own job (pool.engines[i]); search() uses the first.
export class EnginePool {
  constructor(name, size) {
    this.engines = Array.from({ length: size }, (_, i) => new Engine(`${name}${i}`));
  }
  search(board, opts) { this.cancel(); return this.engines[0].search(board, opts); }
  cancel() { for (const e of this.engines) e.cancel(); }
  get busy() { return this.engines.some(e => e.busy); }
}
