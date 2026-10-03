// The page's one way to the browser's storage. safeStorage(get) gives
// getItem / setItem over localStorage when it can be had, else over a stand-in
// in memory, so blocked site data never stops the page. durable says whether
// what's written survives a reload: false for the stand-in, false when a probe
// write fails at the start, and afterwards whatever the last write did. A
// write the browser refuses throws (after keeping the value in memory), so
// the caller can say the game isn't being saved.
const PROBE = 'reversiology.probe';

export function safeStorage(get = () => globalThis.localStorage) {
  let real = null;
  try { real = get() || null; if (real) real.getItem(PROBE); } catch { real = null; }
  let durable = false;
  if (real) {
    try { real.setItem(PROBE, '1'); real.removeItem(PROBE); durable = true; } catch { durable = false; }
  }
  const memory = new Map();
  return {
    get durable() { return durable; },
    get memoryOnly() { return !real; },
    getItem(key) {
      if (real) { try { return real.getItem(key); } catch { /* fall back on memory */ } }
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
      if (!real) return;
      try { real.setItem(key, value); durable = true; } catch (e) { durable = false; throw e; }
    },
  };
}
