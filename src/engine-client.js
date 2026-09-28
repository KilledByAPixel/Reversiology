// Main-thread handle to an engine worker. search() returns a promise for the
// final results and streams progress; starting a new search cancels the old one.

// The evaluation weights and the WebAssembly search core, downloaded once and
// handed to every worker. Without the core, the workers search in JavaScript.
let weights = null, core = null;
const loadWeights = () => weights ||= fetch(new URL('../weights/eval.bin.gz', import.meta.url))
  .then(res => { if (!res.ok) throw new Error(`couldn't load the evaluation (${res.status})`); return res.arrayBuffer(); })
  .then(bytes => ({ bytes }), e => ({ error: e.message || String(e) }));
const loadCore = () => core ||= fetch(new URL('./engine/core.wasm', import.meta.url))
  .then(res => res.ok ? res.arrayBuffer() : null, () => null);

export class Engine {
  // ttBits: the size of the worker's transposition table (2^ttBits entries,
  // 24 bytes each).
  constructor(name, { ttBits = 18 } = {}) {
    this.name = name;
    this.worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    Promise.all([loadWeights(), loadCore()]).then(([w, c]) => {
      // Each worker gets its own copy (transferred, so it isn't copied twice).
      const bytes = w.bytes && w.bytes.slice(0), wasm = c && c.slice(0);
      this.worker.postMessage({ type: 'weights', bytes, wasm, ttBits, error: w.error }, [bytes, wasm].filter(Boolean));
    });
    this.nextId = 1;
    this.pending = null;
    this.worker.onmessage = e => this.onMessage(e.data);
    this.worker.onerror = e => {
      console.error(`${name} worker error`, e.message);
      // Fail the running search instead of leaving the caller waiting forever.
      const job = this.pending;
      this.pending = null;
      if (job) job.resolve(null);
      if (Engine.onError) Engine.onError(name, e.message || 'failed to load');
    };
  }

  // board: a Board (only its squares and side to move are sent).
  // opts: engine options (depth, exact, all, maxTime, minDepth), plus
  // onProgress(results, done) and reportMs.
  search(board, { onProgress = null, reportMs = 250, ...opts } = {}) {
    this.cancel();
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending = { id, resolve, onProgress };
      this.worker.postMessage({ type: 'search', id, color: Array.from(board.color), toPlay: board.toPlay, opts, reportMs });
    });
  }

  cancel() {
    if (!this.pending) return;
    this.worker.postMessage({ type: 'stop' });
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
      if (job.onProgress) job.onProgress(msg.results, true);
      job.resolve(msg.results);
    }
  }
}

// Several engines, each given its own job (pool.engines[i]); search() uses the first.
export class EnginePool {
  constructor(name, size) {
    this.engines = Array.from({ length: size }, (_, i) => new Engine(`${name}${i}`));
  }
  search(board, opts) { this.cancel(); return this.engines[0].search(board, opts); }
  cancel() { for (const e of this.engines) e.cancel(); }
  get busy() { return this.engines.some(e => e.busy); }
}
