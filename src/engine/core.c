// The search core in C, compiled to WebAssembly (tools/build-wasm.sh): the
// same search as search.js, move for move, on native 64-bit bitboards, which
// makes it several times faster. search.js stays as the reference and the
// fallback; wasm.js wraps this in the same interface for engine.js.
//
// Boards are two 64-bit sets: P, the side to move's discs, and O, the
// opponent's. Square = row * 8 + col, a1 = 0, h8 = 63. JavaScript passes each
// set as two 32-bit halves (lo: squares 0-31, hi: 32-63).
#include <stdint.h>

typedef uint64_t u64;
typedef uint32_t u32;
#define EXPORT(name) __attribute__((export_name(name)))
#define NF 46
#define MAX_PLY 72
#define INF 127
#define BLACK 1

__attribute__((import_module("env"), import_name("now"))) double now(void);

// ------------------------------------------------------------ memory

extern unsigned char __heap_base;
static uintptr_t heapTop = 0;

// A block of `bytes` from the heap (never freed; the instance is the unit).
EXPORT("alloc") void *alloc(u32 bytes) {
  if (!heapTop) heapTop = (uintptr_t)&__heap_base;
  uintptr_t p = (heapTop + 15) & ~(uintptr_t)15;
  uintptr_t end = p + bytes;
  uintptr_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) < 0) return 0;
  heapTop = end;
  return (void *)p;
}

// ------------------------------------------------------------ bitboards

static inline int popcount(u64 x) { return __builtin_popcountll(x); }
static inline int lowBit(u64 x) { return __builtin_ctzll(x); }
static inline u64 join(int lo, int hi) { return (u64)(u32)lo | ((u64)(u32)hi << 32); }

// Legal moves for P against O (Kogge-Stone fills in the eight directions).
static inline u64 mobility(u64 P, u64 O) {
  const u64 mO = O & 0x7e7e7e7e7e7e7e7eULL, empty = ~(P | O);
  u64 moves = 0, t;
#define FILL(MASK, SH) \
  t = MASK & (P SH); t |= MASK & (t SH); t |= MASK & (t SH); \
  t |= MASK & (t SH); t |= MASK & (t SH); t |= MASK & (t SH); moves |= t SH;
  FILL(mO, << 1) FILL(mO, >> 1) FILL(O, << 8) FILL(O, >> 8)
  FILL(mO, << 9) FILL(mO, >> 9) FILL(mO, << 7) FILL(mO, >> 7)
#undef FILL
  return moves & empty;
}

// The squares along each ray from every square: the four rays going up the
// board (+1, +7, +8, +9) and the four going down.
static u64 RAY_UP[64][4], RAY_DOWN[64][4];

// Discs flipped when P plays sq (0: not a legal move). Along each ray, the
// first square that isn't the opponent's must be P's; the discs before it flip.
static inline u64 flips(int sq, u64 P, u64 O) {
  u64 f = 0;
  const u64 notO = ~O;
  for (int d = 0; d < 4; d++) {
    const u64 up = RAY_UP[sq][d], x = notO & up;
    const u64 first = x & (0 - x);
    if (first & P) f |= (first - 1) & up;
    const u64 down = RAY_DOWN[sq][d], y = notO & down;
    if (y) {
      const u64 last = 1ULL << (63 - __builtin_clzll(y));
      if (last & P) f |= ~((last << 1) - 1) & down;
    }
  }
  return f;
}

// Squares next to each square.
static u64 NEIGH[64];

// Final score with empties to the winner.
static inline int finalScore(u64 P, u64 O) {
  int p = popcount(P), o = popcount(O), e = 64 - p - o;
  return p > o ? p - o + e : p < o ? p - o - e : 0;
}

static const int8_t SQUARE_ORDER[64] = {
  0, 7, 56, 63, 2, 5, 16, 23, 40, 47, 58, 61, 3, 4, 24, 31, 32, 39, 59, 60,
  18, 21, 42, 45, 19, 20, 26, 29, 34, 37, 43, 44, 11, 12, 25, 30, 33, 38, 51, 52,
  10, 13, 17, 22, 41, 46, 50, 53, 1, 6, 8, 15, 48, 55, 57, 62, 9, 14, 49, 54,
  27, 28, 35, 36,
};
static uint8_t QUADRANT[64];
static const int8_t SQUARE_VALUE[64] = {
  18, -6, 8, 6, 6, 8, -6, 18,
  -6, -12, -2, -2, -2, -2, -12, -6,
  8, -2, 1, 0, 0, 1, -2, 8,
  6, -2, 0, 0, 0, 0, -2, 6,
  6, -2, 0, 0, 0, 0, -2, 6,
  8, -2, 1, 0, 0, 1, -2, 8,
  -6, -12, -2, -2, -2, -2, -12, -6,
  18, -6, 8, 6, 6, 8, -6, 18,
};

// ProbCut error model (Edax's parameters), as in search.js.
static double evalSigma(int empties, int depth, int pcDepth) {
  double s = -0.10026799 * empties + 0.31027733 * depth - 0.57772603 * pcDepth;
  return 0.07585621 * s * s + 1.16492647 * s + 5.4171698;
}
static inline int ifloor(double x) { int i = (int)x; return (double)i > x ? i - 1 : i; }

// ------------------------------------------------------------ state

static int16_t *W;                       // weights, stages × packedStage
static const int32_t *canonOf, *canonOfSwapped;
static int packedStage;
static uint8_t stageOf[65];
static int32_t x2fStart[65], x2fFlat[1024], foff[NF];
static int32_t feat[MAX_PLY * NF];

typedef struct { u64 p, o; u32 packed, age; } Entry;
static Entry *tt;
static u32 ttMask;

static u64 nodes;
static double deadline;
static int aborted, checkEvery;
static u32 age = 1;
static double pcT;
static int pcLevel;

static int8_t nxt[66], prv[66];
static int parity;
static int8_t pvBuf[64];

// Sets up the instance: tables from JavaScript (engine/patterns.js and
// weights.js) and a transposition table of 2^ttBits entries.
EXPORT("setup") int setup(int16_t *w, const int32_t *canon, const int32_t *canonSwapped, int stage,
                          const uint8_t *stages, const int32_t *xs, const int32_t *xf, const int32_t *fo, int ttBits) {
  W = w; canonOf = canon; canonOfSwapped = canonSwapped; packedStage = stage;
  for (int i = 0; i < 65; i++) stageOf[i] = stages[i], x2fStart[i] = xs[i];
  if (x2fStart[64] > 1024) return 0;
  for (int i = 0; i < x2fStart[64]; i++) x2fFlat[i] = xf[i];
  for (int i = 0; i < NF; i++) foff[i] = fo[i];
  for (int s = 0; s < 64; s++) {
    QUADRANT[s] = ((s >> 5) << 1) | ((s & 7) >> 2);
    u64 n = 0;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      int x = (s & 7) + dx, y = (s >> 3) + dy;
      if ((dx || dy) && x >= 0 && x < 8 && y >= 0 && y < 8) n |= 1ULL << (y * 8 + x);
    }
    NEIGH[s] = n;
    static const int DX[4] = {1, -1, 0, 1}, DY[4] = {0, 1, 1, 1};
    for (int d = 0; d < 4; d++) {
      u64 up = 0, down = 0;
      for (int k = 1; k < 8; k++) {
        int x = (s & 7) + DX[d] * k, y = (s >> 3) + DY[d] * k;
        if (x < 0 || x > 7 || y < 0 || y > 7) break;
        up |= 1ULL << (y * 8 + x);
      }
      for (int k = 1; k < 8; k++) {
        int x = (s & 7) - DX[d] * k, y = (s >> 3) - DY[d] * k;
        if (x < 0 || x > 7 || y < 0 || y > 7) break;
        down |= 1ULL << (y * 8 + x);
      }
      RAY_UP[s][d] = up; RAY_DOWN[s][d] = down;
    }
  }
  ttMask = (1u << ttBits) - 1;
  tt = alloc(sizeof(Entry) << ttBits);
  if (!tt) return 0;
  for (u32 i = 0; i <= ttMask; i++) tt[i] = (Entry){0, 0, 0, 0};
  return 1;
}

EXPORT("clear_tt") void clearTT(void) { for (u32 i = 0; i <= ttMask; i++) tt[i] = (Entry){0, 0, 0, 0}; }
EXPORT("get_nodes") double getNodes(void) { return (double)nodes; }
EXPORT("set_nodes") void setNodes(double n) { nodes = (u64)n; }
EXPORT("get_aborted") int getAborted(void) { return aborted; }
EXPORT("set_aborted") void setAborted(int a) { aborted = a; }
EXPORT("set_deadline") void setDeadline(double d) { deadline = d; }
EXPORT("set_age") void setAge(u32 a) { age = a; }
EXPORT("set_pc") void setPc(double t, int level) { pcT = t; pcLevel = level; }
EXPORT("pv_buf") int8_t *pvBufPtr(void) { return pvBuf; }

// ------------------------------------------------------------ evaluation

// Feature indices for the root position (absolute colours).
EXPORT("set_root") void setRoot(int bl, int bh, int wl, int wh) {
  u64 B = join(bl, bh), Wh = join(wl, wh);
  for (int i = 0; i < NF; i++) feat[i] = 0;
  // Each square adds its digit times its place value in every feature it's in.
  for (int s = 0; s < 64; s++) {
    int d = (B >> s) & 1 ? 1 : (Wh >> s) & 1 ? 2 : 0;
    if (!d) continue;
    for (int k = x2fStart[s]; k < x2fStart[s + 1]; k += 2) feat[x2fFlat[k]] += d * x2fFlat[k + 1];
  }
}

// Child features at ply + 1: `color` played sq and flipped f.
static inline void updateFeatures(int ply, int color, int sq, u64 f) {
  int32_t *src = feat + ply * NF, *dst = src + NF;
  for (int i = 0; i < NF; i++) dst[i] = src[i];
  const int flip = color == BLACK ? -1 : 1;
  for (int k = x2fStart[sq], e = x2fStart[sq + 1]; k < e; k += 2) dst[x2fFlat[k]] += color * x2fFlat[k + 1];
  while (f) {
    int s = lowBit(f); f &= f - 1;
    for (int k = x2fStart[s], e = x2fStart[s + 1]; k < e; k += 2) dst[x2fFlat[k]] += flip * x2fFlat[k + 1];
  }
}
EXPORT("update_features") void updateFeaturesJS(int ply, int color, int sq, int fl, int fh) {
  updateFeatures(ply, color, sq, join(fl, fh));
}

// Evaluation for the side to move, in 1/128 disc.
static inline int evaluate(int ply, int color, u64 P, u64 O) {
  const int16_t *w = W + stageOf[popcount(P | O)] * packedStage;
  const int32_t *f = feat + ply * NF, *canon = color == BLACK ? canonOf : canonOfSwapped;
  int sum = w[0];
  for (int i = 0; i < NF; i++) sum += w[canon[foff[i] + f[i]]];
  return sum;
}

// In whole discs, rounded half up, inside the win/loss range.
static inline int evalInt(int ply, int color, u64 P, u64 O) {
  int v = (evaluate(ply, color, P, O) + 64) >> 7;
  return v > 64 ? 64 : v < -64 ? -64 : v;
}
EXPORT("eval_int") int evalIntJS(int ply, int color, int pl, int ph, int ol, int oh) {
  return evalInt(ply, color, join(pl, ph), join(ol, oh));
}

// ------------------------------------------------------------ transposition table
// packed: lower+64 | upper+64 << 8 | depth << 16 | move+1 << 24; depth 99 = exact.

static inline Entry *ttEntry(u64 P, u64 O) {
  u32 pl = (u32)P, ph = (u32)(P >> 32), ol = (u32)O, oh = (u32)(O >> 32);
  u32 h = ((pl ^ (ph * 0x2545f491u)) * 0x9e3779b1u) ^ ((ol ^ (oh * 0x6c8e9cf5u)) * 0x85ebca77u);
  h ^= h >> 15; h *= 0xc2b2ae3du; h ^= h >> 13;
  return tt + (h & ttMask);
}

static inline u32 ttProbe(u64 P, u64 O) {
  Entry *t = ttEntry(P, O);
  return t->p == P && t->o == O ? t->packed : 0;
}

static void ttStore(u64 P, u64 O, int depth, int alpha, int beta, int score, int move) {
  Entry *t = ttEntry(P, O);
  int lo = -64, hi = 64;
  if (t->p == P && t->o == O && t->packed) {
    u32 old = t->packed; int od = (old >> 16) & 0xff;
    if (od > depth) return;
    if (od == depth) { lo = (int)(old & 0xff) - 64; hi = (int)((old >> 8) & 0xff) - 64; }
    if (move < 0) move = (int)((old >> 24) & 0xff) - 1;
  } else if (t->packed && (int)((t->packed >> 16) & 0xff) > depth + 2 && t->age == age) return;
  if (score < beta && score < hi) hi = score;
  if (score > alpha && score > lo) lo = score;
  if (lo > hi) { lo = score; hi = score; }
  t->p = P; t->o = O;
  t->packed = (u32)(lo + 64) | ((u32)(hi + 64) << 8) | ((u32)depth << 16) | ((u32)(move + 1) << 24);
  t->age = age;
}

static inline void tick(void) {
  if (++checkEvery >= 2048) {
    checkEvery = 0;
    if (now() > deadline) aborted = 1;
  }
}

// ------------------------------------------------------------ endgame solver

static inline void unlink(int sq) {
  int p = prv[sq], n = nxt[sq];
  nxt[p] = n; prv[n] = p;
  parity ^= 1 << QUADRANT[sq];
}
static inline void relink(int sq) {
  int p = prv[sq], n = nxt[sq];
  nxt[p] = sq; prv[n] = sq;
  parity ^= 1 << QUADRANT[sq];
}

// One empty square left, sq.
static inline int solveLast(u64 P, u64 O, int sq) {
  int p = popcount(P), o = popcount(O);
  int f = popcount(flips(sq, P, O));
  if (f) return p - o + 1 + 2 * f;
  f = popcount(flips(sq, O, P));
  if (f) return p - o - 1 - 2 * f;
  return p > o ? p - o + 1 : p - o - 1;
}

// Two empty squares, a and b.
static int solve2(u64 P, u64 O, int alpha, int beta, int a, int b, int passed) {
  nodes++;
  int best = -INF, moved = 0;
  if (NEIGH[a] & O) {
    u64 f = flips(a, P, O);
    if (f) {
      moved = 1;
      best = -solveLast(O & ~f, P | f | (1ULL << a), b);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
  }
  if (NEIGH[b] & O) {
    u64 f = flips(b, P, O);
    if (f) {
      moved = 1;
      int v = -solveLast(O & ~f, P | f | (1ULL << b), a);
      if (v > best) best = v;
    }
  }
  if (moved) return best;
  if (passed) return finalScore(P, O);
  return -solve2(O, P, -beta, -alpha, a, b, 1);
}

// Few empties: try the empty squares directly (odd quadrants first).
static int solveSmall(u64 P, u64 O, int alpha, int beta, int empties, int passed) {
  nodes++;
  if (empties == 2) { int a = nxt[64]; return solve2(P, O, alpha, beta, a, nxt[a], passed); }
  if (empties == 1) return solveLast(P, O, nxt[64]);
  if (empties == 0) return finalScore(P, O);
  int8_t buf[8];
  int n = 0, par = parity;
  for (int sq = nxt[64]; sq != 65; sq = nxt[sq]) if ((par >> QUADRANT[sq]) & 1) buf[n++] = sq;
  for (int sq = nxt[64]; sq != 65; sq = nxt[sq]) if (!((par >> QUADRANT[sq]) & 1)) buf[n++] = sq;
  int best = -INF, moved = 0;
  for (int i = 0; i < n; i++) {
    int sq = buf[i];
    if (!(NEIGH[sq] & O)) continue;
    u64 f = flips(sq, P, O);
    if (!f) continue;
    moved = 1;
    unlink(sq);
    int v = -solveSmall(O & ~f, P | f | (1ULL << sq), -beta, -alpha, empties - 1, 0);
    relink(sq);
    if (v > best) {
      best = v;
      if (v > alpha) { alpha = v; if (v >= beta) return v; }
    }
  }
  if (moved) return best;
  if (passed) return finalScore(P, O);
  return -solveSmall(O, P, -beta, -alpha, empties, 1);
}

static inline void sortMoves(int8_t *mv, int32_t *sc, int n) {
  for (int i = 1; i < n; i++) {
    int m = mv[i], s = sc[i], j = i - 1;
    while (j >= 0 && sc[j] < s) { mv[j + 1] = mv[j]; sc[j + 1] = sc[j]; j--; }
    mv[j + 1] = m; sc[j + 1] = s;
  }
}

static int solve(u64 P, u64 O, int alpha, int beta, int empties, int passed) {
  if (empties <= 6) return solveSmall(P, O, alpha, beta, empties, passed);
  nodes++;
  tick();
  if (aborted) return 0;
  u64 moves = mobility(P, O);
  if (!moves) {
    if (passed) return finalScore(P, O);
    return -solve(O, P, -beta, -alpha, empties, 1);
  }
  int ttMove = -1;
  const int useTT = empties >= 8;
  if (useTT) {
    u32 e = ttProbe(P, O);
    if (e) {
      ttMove = (int)((e >> 24) & 0xff) - 1;
      if (((e >> 16) & 0xff) == 99) {
        int lo = (int)(e & 0xff) - 64, hi = (int)((e >> 8) & 0xff) - 64;
        if (lo >= beta) return lo;
        if (hi <= alpha) return hi;
        if (lo == hi) return lo;
        if (lo > alpha) alpha = lo;
        if (hi < beta) beta = hi;
      }
    }
  }
  // Fastest first: moves that leave the opponent fewest replies.
  int8_t mv[32]; int32_t sc[32];
  int n = 0;
  while (moves) { mv[n++] = lowBit(moves); moves &= moves - 1; }
  for (int i = 0; i < n; i++) {
    int sq = mv[i];
    if (sq == ttMove) { sc[i] = 1 << 30; continue; }
    u64 f = flips(sq, P, O);
    u64 om = mobility(O & ~f, P | f | (1ULL << sq));
    int k = popcount(om) + popcount(om & 0x8100000000000081ULL);
    sc[i] = -k * 16 + SQUARE_VALUE[sq] + ((parity >> QUADRANT[sq]) & 1) * 4;
  }
  sortMoves(mv, sc, n);
  const int a0 = alpha;
  int best = -INF, bestMove = -1;
  for (int i = 0; i < n; i++) {
    int sq = mv[i];
    u64 f = flips(sq, P, O);
    u64 np = P | f | (1ULL << sq), no = O & ~f;
    unlink(sq);
    int v;
    if (i == 0) v = -solve(no, np, -beta, -alpha, empties - 1, 0);
    else {
      v = -solve(no, np, -alpha - 1, -alpha, empties - 1, 0);
      if (v > alpha && v < beta) v = -solve(no, np, -beta, -alpha, empties - 1, 0);
    }
    relink(sq);
    if (aborted) return 0;
    if (v > best) {
      best = v; bestMove = sq;
      if (v > alpha) { alpha = v; if (v >= beta) break; }
    }
  }
  if (useTT) ttStore(P, O, 99, a0, beta, best, bestMove);
  return best;
}

// Exact score: sets up the empty-square list, then solves.
static int solveRoot(u64 P, u64 O, int alpha, int beta, int empties) {
  u64 occ = P | O;
  int prev = 64;
  parity = 0;
  for (int i = 0; i < 64; i++) {
    int s = SQUARE_ORDER[i];
    if ((occ >> s) & 1) continue;
    nxt[prev] = s; prv[s] = prev; prev = s;
    parity ^= 1 << QUADRANT[s];
  }
  nxt[prev] = 65; prv[65] = prev;
  return solve(P, O, alpha, beta, empties, 0);
}

// ------------------------------------------------------------ midgame search

static int pvs(u64 P, u64 O, int color, int depth, int alpha, int beta, int ply, int passed);

// Fills mv with the legal moves, best-looking first. Returns how many.
static int orderMoves(u64 P, u64 O, u64 moves, int color, int depth, int ply, int ttMove, int8_t *mv, int32_t *sc) {
  int n = 0;
  while (moves) { mv[n++] = lowBit(moves); moves &= moves - 1; }
  if (n == 1) return 1;
  for (int i = 0; i < n; i++) {
    int sq = mv[i];
    if (sq == ttMove) { sc[i] = 1 << 30; continue; }
    u64 f = flips(sq, P, O);
    u64 np = P | f | (1ULL << sq), no = O & ~f;
    int s = SQUARE_VALUE[sq] * 16 - popcount(mobility(no, np)) * 64;
    if (depth >= 3) {
      updateFeatures(ply, color, sq, f);
      if (depth >= 6) s += -pvs(no, np, 3 - color, depth >= 10 ? 2 : 1, -INF, INF, ply + 1, 0) * 256;
      else s -= evaluate(ply + 1, 3 - color, no, np) * 2;
    }
    sc[i] = s;
  }
  sortMoves(mv, sc, n);
  return n;
}

// Principal variation search to `depth` plies; switches to the exact solver
// once the depth reaches the end of the game.
static int pvs(u64 P, u64 O, int color, int depth, int alpha, int beta, int ply, int passed) {
  nodes++;
  tick();
  if (aborted) return 0;
  const int empties = 64 - popcount(P | O);
  if (depth >= empties) return solveRoot(P, O, alpha, beta, empties);
  if (depth <= 0) return evalInt(ply, color, P, O);

  u64 moves = mobility(P, O);
  if (!moves) {
    if (passed) return finalScore(P, O);
    return -pvs(O, P, 3 - color, depth, -beta, -alpha, ply, 1);
  }

  int ttMove = -1;
  u32 e = ttProbe(P, O);
  if (e) {
    int d = (e >> 16) & 0xff;
    ttMove = (int)((e >> 24) & 0xff) - 1;
    if (d >= depth) {
      int lo = (int)(e & 0xff) - 64, hi = (int)((e >> 8) & 0xff) - 64;
      if (lo >= beta) return lo;
      if (hi <= alpha) return hi;
      if (lo == hi) return lo;
      if (lo > alpha) alpha = lo;
      if (hi < beta) beta = hi;
    }
  }

  // ProbCut, at null-window nodes.
  if (pcT != 0 && beta == alpha + 1 && depth >= 4 && pcLevel < 2) {
    const int pd = 2 * (depth / 4) + (depth & 1);
    const int err = ifloor(pcT * evalSigma(empties, depth, pd) + 0.5);
    const int ev = evalInt(ply, color, P, O);
    const int evErr = ifloor(pcT * 0.5 * (evalSigma(empties, depth, 0) + evalSigma(empties, depth, pd)) + 0.5);
    if (ev >= beta - evErr && beta + err < 64) {
      pcLevel++;
      int v = pvs(P, O, color, pd, beta + err - 1, beta + err, ply, passed);
      pcLevel--;
      if (aborted) return 0;
      if (v >= beta + err) return beta;
    }
    if (ev < alpha + evErr && alpha - err > -64) {
      pcLevel++;
      int v = pvs(P, O, color, pd, alpha - err, alpha - err + 1, ply, passed);
      pcLevel--;
      if (aborted) return 0;
      if (v <= alpha - err) return alpha;
    }
  }

  int8_t mv[32]; int32_t sc[32];
  const int n = orderMoves(P, O, moves, color, depth, ply, ttMove, mv, sc);
  int best = -INF, bestMove = -1;
  const int a0 = alpha;
  for (int i = 0; i < n; i++) {
    int sq = mv[i];
    u64 f = flips(sq, P, O);
    u64 np = P | f | (1ULL << sq), no = O & ~f;
    updateFeatures(ply, color, sq, f);
    int v;
    if (i == 0) v = -pvs(no, np, 3 - color, depth - 1, -beta, -alpha, ply + 1, 0);
    else {
      v = -pvs(no, np, 3 - color, depth - 1, -alpha - 1, -alpha, ply + 1, 0);
      if (v > alpha && v < beta) v = -pvs(no, np, 3 - color, depth - 1, -beta, -alpha, ply + 1, 0);
    }
    if (aborted) return 0;
    if (v > best) {
      best = v; bestMove = sq;
      if (v > alpha) { alpha = v; if (v >= beta) break; }
    }
  }
  ttStore(P, O, depth, a0, beta, best, bestMove);
  return best;
}

EXPORT("pvs") int pvsJS(int pl, int ph, int ol, int oh, int color, int depth, int alpha, int beta, int ply, int passed) {
  return pvs(join(pl, ph), join(ol, oh), color, depth, alpha, beta, ply, passed);
}

// The expected continuation from the table's best moves, into pvBuf
// (-1: a pass). Returns its length.
EXPORT("pv") int pvJS(int pl, int ph, int ol, int oh, int max) {
  u64 P = join(pl, ph), O = join(ol, oh);
  int n = 0;
  if (max > 64) max = 64;
  for (int k = 0; k < max; k++) {
    if (!mobility(P, O)) {
      if (!mobility(O, P)) break;
      pvBuf[n++] = -1;
      u64 t = P; P = O; O = t;
      continue;
    }
    u32 e = ttProbe(P, O);
    int m = e ? (int)((e >> 24) & 0xff) - 1 : -1;
    if (m < 0) break;
    u64 f = flips(m, P, O);
    if (!f) break;
    pvBuf[n++] = m;
    u64 np = P | f | (1ULL << m);
    P = O & ~f; O = np;
  }
  return n;
}
