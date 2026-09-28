// SVG board renderer. Stateless apart from animation bookkeeping: render(s)
// redraws every layer from a plain description of what to show.
import { BLACK, WHITE, EMPTY, PASS, N, sq, sqX, sqY } from './board.js';

const CELL = 100, M = 56, S = M * 2 + CELL * N;
const X = p => M + sqX(p) * CELL + CELL / 2, Y = p => M + sqY(p) * CELL + CELL / 2;
const COLS = 'abcdefgh';
const R = 42;
const RED = '#e03131', ORANGE = '#f08c00', GREEN = '#2f9e61', BLUE = '#1c7ed6';

const ink = c => c === BLACK ? '#f5f3ee' : '#1c1a17';
const disc = c => `url(#${c === BLACK ? 'gB' : 'gW'})`;

export class BoardView {
  constructor(el, { onClick, onHover, onCursor }) {
    this.el = el;
    let grid = '';
    for (let i = 0; i <= N; i++) {
      const a = M + i * CELL;
      grid += `<line x1="${M}" y1="${a}" x2="${S - M}" y2="${a}"/><line x1="${a}" y1="${M}" x2="${a}" y2="${S - M}"/>`;
    }
    // The four dots marking the centre and the corner regions.
    const dots = [[2, 2], [6, 2], [2, 6], [6, 6]].map(([x, y]) => `<circle cx="${M + x * CELL}" cy="${M + y * CELL}" r="7"/>`).join('');
    let coords = '';
    for (let i = 0; i < N; i++) {
      const a = M + i * CELL + CELL / 2;
      coords += `<text data-col="${i}" x="${a}" y="${M * 0.45}">${COLS[i]}</text><text data-col="${i}" x="${a}" y="${S - M * 0.45}">${COLS[i]}</text>`;
      coords += `<text data-row="${i}" x="${M * 0.45}" y="${a}">${i + 1}</text><text data-row="${i}" x="${S - M * 0.45}" y="${a}">${i + 1}</text>`;
    }
    el.innerHTML = `
<svg class="board-svg" viewBox="0 0 ${S} ${S}" role="application" tabindex="0" aria-label="Reversi board, 8 by 8. Arrow keys move the cursor, Enter plays.">
  <defs>
    <linearGradient id="gFelt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2f8a57"/><stop offset="0.5" stop-color="#287a4c"/><stop offset="1" stop-color="#216b42"/>
    </linearGradient>
    <linearGradient id="gFrame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4a3322"/><stop offset="1" stop-color="#2e1f14"/>
    </linearGradient>
    <radialGradient id="gB" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#5c5c5c"/><stop offset="0.35" stop-color="#262626"/><stop offset="1" stop-color="#050505"/>
    </radialGradient>
    <radialGradient id="gW" cx="38%" cy="32%" r="78%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#efeee9"/><stop offset="1" stop-color="#c4c0b5"/>
    </radialGradient>
    <filter id="fShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="4" stdDeviation="3" flood-color="#04150b" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" rx="18" fill="url(#gFrame)"/>
  <rect x="${M}" y="${M}" width="${S - 2 * M}" height="${S - 2 * M}" fill="url(#gFelt)"/>
  <g class="l-under"></g>
  <g stroke="#0f3d24" stroke-width="3">${grid}</g>
  <g fill="#0f3d24">${dots}</g>
  <g class="coords" fill="#d8c7a8" font-size="28" text-anchor="middle" dominant-baseline="central">${coords}</g>
  <g class="l-discs" filter="url(#fShadow)"></g>
  <g class="l-marks"></g>
  <g class="l-hints"></g>
  <g class="l-hover" pointer-events="none"></g>
  <g class="l-cursor" pointer-events="none"></g>
</svg>`;
    this.svg = el.querySelector('svg');
    this.coordTexts = [...el.querySelectorAll('.coords text')];
    this.coordPt = null;
    this.layers = {
      under: el.querySelector('.l-under'), discs: el.querySelector('.l-discs'), marks: el.querySelector('.l-marks'),
      hints: el.querySelector('.l-hints'), hover: el.querySelector('.l-hover'), cursor: el.querySelector('.l-cursor'),
    };
    this.animId = null;
    this.hoverPt = null;
    const squareAt = e => {
      const r = this.svg.getBoundingClientRect();
      const gx = ((e.clientX - r.left) / r.width * S - M) / CELL;
      const gy = ((e.clientY - r.top) / r.height * S - M) / CELL;
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) return null;
      return sq(Math.floor(gx), Math.floor(gy));
    };
    this.svg.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return; // no hover on touch: a tap plays
      const p = squareAt(e);
      if (p !== this.hoverPt) { this.hoverPt = p; onHover(p); }
    });
    this.svg.addEventListener('pointerleave', () => { this.hoverPt = null; onHover(null); });
    this.svg.addEventListener('click', e => { const p = squareAt(e); if (p !== null) onClick(p); });
    this.onHover = onHover;
    this.onCursor = onCursor;
    this.cursor = null;
    this.focused = false;
    this.last = null;
    // Mouse clicks shouldn't take keyboard focus: arrows keep stepping through the game.
    this.svg.addEventListener('mousedown', e => e.preventDefault());
    this.svg.addEventListener('focus', () => {
      this.focused = true;
      if (this.cursor === null) this.cursor = this.last && this.last.lastMove != null && this.last.lastMove !== PASS ? this.last.lastMove : sq(3, 2);
      this.moveCursor(0, 0);
    });
    this.svg.addEventListener('blur', () => { this.focused = false; this.drawCursor(); onHover(null); });
    this.svg.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) this.moveCursor(d[0], d[1]);
      else if ((e.key === 'Enter' || e.key === ' ') && this.cursor !== null) onClick(this.cursor);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  moveCursor(dx, dy) {
    const x = Math.max(0, Math.min(N - 1, sqX(this.cursor) + dx)), y = Math.max(0, Math.min(N - 1, sqY(this.cursor) + dy));
    this.cursor = sq(x, y);
    this.drawCursor();
    this.onHover(this.cursor, true); // the same preview a mouse gets
    if (this.onCursor) this.onCursor(this.cursor);
  }

  drawCursor() {
    const p = this.cursor;
    this.layers.cursor.innerHTML = this.focused && p !== null
      ? `<rect x="${X(p) - 48}" y="${Y(p) - 48}" width="96" height="96" rx="12" fill="none" stroke="#74c0fc" stroke-width="8"/>` : '';
  }

  // s: { board, nodeId, lastMove, flipped, moves (legal squares), stable (Set),
  //   frontier (Set), danger (Map square → 'x'|'c'), numbers (Map), hints,
  //   better, threat, pv, pvAccent, grade, hover, locate, animate }
  render(s) {
    this.last = s;
    const b = s.board;
    const animate = s.animate !== false && s.nodeId !== this.animId;
    this.animId = s.nodeId;

    // ---- under the discs: danger squares
    let under = '';
    if (s.danger) {
      for (const [p, kind] of s.danger) {
        const k = kind === 'x' ? '#ff6b6b' : '#ffa94d';
        under += `<rect x="${X(p) - CELL / 2 + 8}" y="${Y(p) - CELL / 2 + 8}" width="${CELL - 16}" height="${CELL - 16}" rx="10" fill="${k}" fill-opacity="0.16" stroke="${k}" stroke-width="5" stroke-dasharray="${kind === 'x' ? 'none' : '10 7'}" stroke-opacity="0.85"/>`;
      }
    }
    if (s.regions) {
      // Empty regions: odd ones tinted blue, with each region's size on its first square.
      for (const reg of s.regions) {
        const odd = reg.length % 2 === 1;
        for (const p of reg) under += `<rect x="${X(p) - CELL / 2 + 3}" y="${Y(p) - CELL / 2 + 3}" width="${CELL - 6}" height="${CELL - 6}" fill="${odd ? '#74c0fc' : '#ced4da'}" fill-opacity="${odd ? 0.28 : 0.14}"/>`;
        const first = Math.min(...reg);
        under += `<text x="${X(first) - 30}" y="${Y(first) - 28}" class="region-num" fill="${odd ? '#d0ebff' : '#dee2e6'}">${reg.length}</text>`;
      }
    }
    this.layers.under.innerHTML = under;

    // ---- discs: rebuilt only when the position changes, so redraws for the
    // coach or the pointer don't restart (or cut short) a flip in progress.
    const discKey = `${s.nodeId}:${b.color.join('')}`;
    if (discKey !== this.discKey) {
      this.discKey = discKey;
      this.layers.discs.innerHTML = this.discsSVG(s, animate);
    }

    // ---- marks on and between discs
    this.renderMarks(s);
  }

  discsSVG(s, animate) {
    const b = s.board;
    let discs = '';
    const flipped = animate && s.flipped ? new Set(s.flipped) : null;
    for (let p = 0; p < 64; p++) {
      const c = b.color[p];
      if (c === EMPTY) continue;
      if (flipped && flipped.has(p)) {
        // A flip: the old colour narrows to nothing, then the new one widens.
        const delay = `style="--d:${(0.1 + 0.06 * Math.max(Math.abs(sqX(p) - sqX(s.lastMove)), Math.abs(sqY(p) - sqY(s.lastMove)))).toFixed(2)}s"`;
        discs += `<circle class="disc flip-in" ${delay} cx="${X(p)}" cy="${Y(p)}" r="${R}" fill="${disc(c)}"/>` +
          `<circle class="disc flip-out" ${delay} cx="${X(p)}" cy="${Y(p)}" r="${R}" fill="${disc(3 - c)}"/>`;
        continue;
      }
      const cls = animate && p === s.lastMove ? 'disc fresh' : 'disc';
      discs += `<circle class="${cls}" cx="${X(p)}" cy="${Y(p)}" r="${R}" fill="${disc(c)}"/>`;
    }
    return discs;
  }

  // Everything drawn over the discs: marks, hints, the hover preview.
  renderMarks(s) {
    const b = s.board;
    let marks = '';
    if (s.moves) {
      for (const p of s.moves) marks += `<circle cx="${X(p)}" cy="${Y(p)}" r="11" fill="${b.toPlay === BLACK ? '#111' : '#f4f4f4'}" fill-opacity="0.45"/>`;
    }
    if (s.stable) {
      for (const p of s.stable) {
        const c = b.color[p];
        marks += `<rect x="${X(p) - 11}" y="${Y(p) - 11}" width="22" height="22" rx="3" fill="${c === BLACK ? '#f1c232' : '#b8860b'}" opacity="0.9"/>`;
      }
    }
    if (s.frontier) {
      for (const p of s.frontier) marks += `<circle cx="${X(p)}" cy="${Y(p)}" r="${R - 6}" fill="none" stroke="${ink(b.color[p])}" stroke-opacity="0.55" stroke-width="4" stroke-dasharray="6 7"/>`;
    }
    for (let p = 0; p < 64; p++) {
      const c = b.color[p];
      if (c === EMPTY) continue;
      const num = s.numbers && s.numbers.get(p);
      if (num) {
        const fill = p === s.lastMove ? RED : ink(c);
        marks += `<text x="${X(p)}" y="${Y(p) + 2}" class="disc-num" fill="${fill}" font-size="${num >= 10 ? 36 : 40}">${num}</text>`;
      } else if (p === s.lastMove) {
        marks += `<circle cx="${X(p)}" cy="${Y(p)}" r="9" fill="${RED}"/>`;
      }
    }
    if (s.better != null && s.better !== PASS) {
      const p = s.better;
      marks += `<circle cx="${X(p)}" cy="${Y(p)}" r="40" fill="${GREEN}" fill-opacity="0.18" stroke="${GREEN}" stroke-width="8"/>`;
    }
    if (s.grade && s.lastMove !== PASS && s.lastMove != null) {
      const p = s.lastMove;
      marks += `<circle cx="${X(p)}" cy="${Y(p)}" r="${R + 4}" fill="none" stroke="${s.grade}" stroke-width="7"/>`;
    }
    this.layers.marks.innerHTML = marks;

    // ---- hints and expected continuations
    let hints = '';
    if (s.hints) {
      for (const h of s.hints) {
        if (h.move === PASS) continue;
        hints += `<g class="hint"><circle cx="${X(h.move)}" cy="${Y(h.move)}" r="40" fill="${h.color}" fill-opacity="0.92" stroke="${h.rank === 0 ? '#fff6cc' : '#fff'}" stroke-width="${h.rank === 0 ? 7 : 3}"/>` +
          `<text x="${X(h.move)}" y="${Y(h.move) + (h.sub ? -7 : 2)}" class="hint-main">${h.label}</text>` +
          (h.sub ? `<text x="${X(h.move)}" y="${Y(h.move) + 21}" class="hint-sub">${h.sub}</text>` : '') + '</g>';
      }
    }
    if (s.threat != null && s.threat !== PASS) {
      hints += `<circle cx="${X(s.threat)}" cy="${Y(s.threat)}" r="${R + 4}" fill="none" stroke="${RED}" stroke-width="8" stroke-dasharray="16 9"/>`;
    }
    if (s.pv) {
      const shown = new Set();
      s.pv.forEach((mv, i) => {
        if (mv.move === PASS || b.color[mv.move] !== EMPTY || shown.has(mv.move)) return;
        shown.add(mv.move);
        hints += `<circle cx="${X(mv.move)}" cy="${Y(mv.move)}" r="${R}" fill="${disc(mv.color)}" opacity="0.7"/>` +
          `<text x="${X(mv.move)}" y="${Y(mv.move) + 2}" class="disc-num" fill="${i === 0 ? (s.pvAccent || '#69db7c') : ink(mv.color)}" font-size="40">${i + 1}</text>`;
      });
    }
    if (s.locate != null && s.locate !== PASS) {
      hints += `<circle class="locate" cx="${X(s.locate)}" cy="${Y(s.locate)}" r="${R + 8}" fill="none" stroke="#74c0fc" stroke-width="8" stroke-dasharray="4 12" stroke-linecap="round"/>`;
    }
    this.layers.hints.innerHTML = hints;

    // ---- hover preview
    let hov = '';
    const h = s.hover;
    if (h) {
      const x = X(h.p), y = Y(h.p);
      if (!h.ok) {
        hov += `<path d="M${x - 20} ${y - 20} L${x + 20} ${y + 20} M${x + 20} ${y - 20} L${x - 20} ${y + 20}" stroke="${RED}" stroke-width="9" stroke-linecap="round" opacity="0.8"/>`;
      } else {
        hov += `<circle cx="${x}" cy="${y}" r="${R}" fill="${disc(h.color)}" opacity="0.55"/>`;
        if (h.flips) {
          // Discs that would flip: a ring of the mover's colour.
          for (const q of h.flips) hov += `<circle cx="${X(q)}" cy="${Y(q)}" r="${R - 12}" fill="none" stroke="${h.color === BLACK ? '#111' : '#fafafa'}" stroke-width="9" opacity="0.85"/>`;
          hov += `<text x="${x}" y="${y + 2}" class="disc-num" fill="${ink(h.color)}" font-size="38">${h.flips.length}</text>`;
        }
      }
    }
    this.layers.hover.innerHTML = hov;

    // The pointed-at square's column letter and row number stand out on the edges
    // (any square: a disc, or while the AI thinks, not only where a move previews).
    const hp = s.coord ?? (h ? h.p : null);
    if (hp !== this.coordPt) {
      this.coordPt = hp;
      for (const t of this.coordTexts) t.classList.toggle('on', hp !== null && (+t.dataset.col === sqX(hp) || +t.dataset.row === sqY(hp)));
    }
  }
}
