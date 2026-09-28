// Web Worker around the engine. One job at a time; a new job or 'stop'
// pre-empts the current one between steps (each step searches one root move
// at one depth). Progress is streamed so the coach can show early results.
import { Engine, positionFromColors } from './engine/engine.js';
import { fetchWeights } from './engine/weights.js';

let engine = null, job = null, loadError = null;
const ready = fetchWeights(new URL('../weights/eval.bin.gz', import.meta.url).href)
  .then(w => { engine = new Engine(w, { ttBits: 18 }); })
  .catch(e => { loadError = e.message || String(e); engine = new Engine(null, { ttBits: 18 }); });

const channel = new MessageChannel();
channel.port1.onmessage = step;
let stepQueued = false;
const yieldThen = () => { if (!stepQueued) { stepQueued = true; channel.port2.postMessage(0); } };

self.onmessage = async e => {
  const msg = e.data;
  if (msg.type === 'stop') { job = null; return; }
  if (msg.type === 'search') {
    job = { id: msg.id, msg, gen: null, lastReport: 0, started: performance.now() };
    const mine = job;
    await ready;
    if (job !== mine) return;
    if (loadError) postMessage({ type: 'warning', message: loadError });
    const { color, toPlay, opts } = msg;
    mine.gen = engine.analyze(positionFromColors(color, toPlay), opts);
    yieldThen();
  }
};

function step() {
  stepQueued = false;
  const j = job;
  if (!j || !j.gen) return;
  const t0 = performance.now();
  let x;
  // A few steps per slice when they're quick.
  do x = j.gen.next(); while (!x.done && performance.now() - t0 < 15);
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
