// Web Worker around the engine. One job at a time; a new job or 'stop'
// pre-empts the current one between steps (each step searches one root move
// at one depth). Progress is streamed so the coach can show early results.
// The page sends the evaluation weights (fetched once for all workers) first.
import { Engine, positionFromColors } from './engine/engine.js';
import { unpackWeights, gunzip } from './engine/weights.js';
import { useWasm } from './engine/wasm.js';

let engine = null, job = null, loadError = null;
let resolveReady;
const ready = new Promise(r => { resolveReady = r; });

async function setWeights(bytes, wasm, ttBits = 18, error) {
  // The WebAssembly search core, when it loads; the JavaScript search otherwise.
  if (wasm && typeof WebAssembly === 'object') {
    try { useWasm(await WebAssembly.compile(wasm)); } catch (e) { console.warn('search core:', e.message || e); }
  }
  try {
    if (error) throw new Error(error);
    engine = new Engine(unpackWeights(await gunzip(new Uint8Array(bytes))), { ttBits });
  } catch (e) {
    loadError = e.message || String(e);
    engine = new Engine(null, { ttBits });
  }
  resolveReady();
}

const channel = new MessageChannel();
channel.port1.onmessage = step;
let stepQueued = false;
const yieldThen = () => { if (!stepQueued) { stepQueued = true; channel.port2.postMessage(0); } };

self.onmessage = async e => {
  const msg = e.data;
  if (msg.type === 'weights') { setWeights(msg.bytes, msg.wasm, msg.ttBits, msg.error); return; }
  if (msg.type === 'stop') { job = null; return; }
  if (msg.type === 'search') {
    job = { id: msg.id, msg, gen: null, lastReport: 0, started: performance.now() };
    const mine = job;
    await ready;
    if (job !== mine) return;
    if (loadError) { postMessage({ type: 'warning', message: loadError }); loadError = null; }
    const { color, toPlay, opts } = msg;
    try { mine.gen = engine.analyze(positionFromColors(color, toPlay), opts); } catch (err) { failJob(mine, err); return; }
    yieldThen();
  }
};

// A search that throws (an odd position, a bug) ends with no results instead
// of taking the whole worker down; the next search runs as usual.
function failJob(j, err) {
  console.warn('Engine: a search failed', err && err.message);
  if (job === j) job = null;
  postMessage({ type: 'done', id: j.id, results: null });
}

function step() {
  stepQueued = false;
  const j = job;
  if (!j || !j.gen) return;
  const t0 = performance.now();
  let x;
  // A few steps per slice when they're quick.
  try {
    do x = j.gen.next(); while (!x.done && performance.now() - t0 < 15);
  } catch (err) { failJob(j, err); return; }
  if (job !== j) return;
  const now = performance.now();
  if (x.done) {
    job = null;
    postMessage({ type: 'done', id: j.id, results: x.value });
    return;
  }
  const reportMs = j.msg.reportMs ?? 250;
  if (reportMs && x.value.depth && now - j.lastReport > reportMs) {
    j.lastReport = now;
    postMessage({ type: 'progress', id: j.id, results: x.value });
  }
  yieldThen();
}
