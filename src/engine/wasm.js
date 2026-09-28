// The WebAssembly search core (core.c) behind the same interface as Search
// in search.js, so engine.js can use either. The compiled module is set once
// with useWasm() (the worker fetches it; node reads the file); until then,
// and if WebAssembly is missing, engine.js uses the JavaScript search.
import { NF, X2F_START, X2F_FLAT, GROUP_OF, GROUP_OFFSET } from './patterns.js';
import { CANON_OF, CANON_OF_SWAPPED, PACKED_STAGE } from './weights.js';

let wasmModule = null;
export function useWasm(module) { wasmModule = module; }
export const wasmAvailable = () => !!wasmModule;

const FOFF = Int32Array.from({ length: NF }, (_, f) => GROUP_OFFSET[GROUP_OF[f]]);

export class WasmSearch {
  constructor(weights, { ttBits = 18 } = {}) {
    const x = this.x = new WebAssembly.Instance(wasmModule, { env: { now: Date.now } }).exports;
    this.weights = true; // (copied into the instance's memory, so the caller's copy can go)
    this.mem = x.memory;
    const put = (Type, data) => {
      const p = x.alloc(data.length * Type.BYTES_PER_ELEMENT);
      if (!p) throw new Error('out of memory for the search');
      new Type(this.mem.buffer, p, data.length).set(data);
      return p;
    };
    const w = put(Int16Array, weights.w);
    const ok = x.setup(w, put(Int32Array, CANON_OF), put(Int32Array, CANON_OF_SWAPPED), PACKED_STAGE,
      put(Uint8Array, weights.stageOf), put(Int32Array, X2F_START), put(Int32Array, X2F_FLAT), put(Int32Array, FOFF), ttBits);
    if (!ok) throw new Error('search setup failed');
    this._pcT = 0; this._pcLevel = 0;
  }

  get nodes() { return this.x.get_nodes(); }
  set nodes(v) { this.x.set_nodes(v); }
  get aborted() { return !!this.x.get_aborted(); }
  set aborted(v) { this.x.set_aborted(v ? 1 : 0); }
  set deadline(v) { this.x.set_deadline(v); }
  get age() { return this._age || 1; }
  set age(v) { this._age = v; this.x.set_age(v); }
  get pcT() { return this._pcT; }
  set pcT(v) { this._pcT = v; this.x.set_pc(v, this._pcLevel); }
  get pcLevel() { return this._pcLevel; }
  set pcLevel(v) { this._pcLevel = v; this.x.set_pc(this._pcT, v); }

  clearTT() { this.x.clear_tt(); }
  setRoot(bl, bh, wl, wh) { this.x.set_root(bl, bh, wl, wh); }
  updateFeatures(ply, color, sq, fl, fh) { this.x.update_features(ply, color, sq, fl, fh); }
  evalInt(ply, color, pl, ph, ol, oh) { return this.x.eval_int(ply, color, pl, ph, ol, oh); }
  pvs(pl, ph, ol, oh, color, depth, alpha, beta, ply, passed) {
    return this.x.pvs(pl, ph, ol, oh, color, depth, alpha, beta, ply, passed ? 1 : 0);
  }
  pv(pl, ph, ol, oh, max = 12) {
    const n = this.x.pv(pl, ph, ol, oh, max);
    return Array.from(new Int8Array(this.mem.buffer, this.x.pv_buf(), n));
  }
}
