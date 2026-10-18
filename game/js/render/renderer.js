// Canvas renderer of the game screen (docs/ARCHITECTURE.md §4.12).
//
// Every frame draws the LIVE session (board + tray) plus transient effect layers that are
// independent of the session state (dying cells copied from PlaceResult.cleared, line sweeps,
// particles, floating texts…). Effects start synchronously when an animate*() call happens, so the
// state change and its effect are always shown in the same frame, and several effects can overlap
// (the player may drop the next piece while the previous clear is still bursting).
//
// Performance rules: sprites are pre-rendered (sprites.js), per frame only drawImage/fillRect with
// constant styles, no allocations (typed-array pools), the RAF loop stops when nothing animates.

import { getShape } from '../core/shapes.js';
import { getTheme } from './theme.js';
import { computeLayout } from './layout.js';
import { SpriteSet, makeCanvas, renderTextSprite, makeRandom, PRAISE_STYLES } from './sprites.js';
import { Particles, P_SHARD, P_SPARKLE, P_DOT, P_CONFETTI, P_GEM, LAYER_BOARD, LAYER_TOP } from './particles.js';

export { computeLayout };

const N = 8;
const SLOTS = 3;

/** Animation timings in ms at timeScale 1 (§4.12 timing table + renderer-internal values). */
export const TIMING = Object.freeze({
  PICKUP: 90,
  POP: 120,
  FLASH: 60,
  STEP: 25,
  MAX_STEPS: 6,
  BURST: 130,          // FLASH + MAX_STEPS * STEP + BURST = 340 ≤ 350
  SWEEP: 380,
  POINTS: 700,
  PRAISE: 950,
  SHAKE: 180,
  SHAKE_PX: 6,
  REFILL: 300,
  REFILL_STAGGER: 60,
  RETURN: 150,
  NEW_BEST: 1200,
  GAME_OVER: 1000,
  NOSPACE: 1400,
  TRAY_SHAKE: 400,
  GREY_START: 420,
  GREY_ROW: 50,
  GREY_FADE: 140,
  UNGREY: 260,
  SYNC_FADE: 220,
  SHUFFLE: 460,
  SHUFFLE_STAGGER: 70,
  BLAST: 380,
  REVIVE: 560,
  HINT_CYCLE: 2400,
  TWINKLE: 650,
  WIN: 1500,
  ALL_CLEAR: 1000,
});

/** English fallbacks if the injected `t` lacks a key (sandbox / tests). */
const FALLBACK_TEXT = Object.freeze({
  'praise.good': 'Good!',
  'praise.great': 'Great!',
  'praise.excellent': 'Excellent!',
  'praise.amazing': 'Amazing!',
  'praise.unbelievable': 'Unbelievable!',
  combo: 'Combo x{n}',
  nospace: 'No space!',
  newbest: 'New best!',
});

// float-text kinds
const TK_POINTS = 0;
const TK_PRAISE = 1;
const TK_COMBO = 2;
const TK_NOSPACE = 3;
const TK_BANNER = 4;
const TK_INFO = 5;

// dying-cell kinds
const DK_LINE = 0;
const DK_BLAST = 1;

const MAX_DYING = 192;
const MAX_SWEEPS = 16;
const MAX_RINGS = 8;
const MAX_TEXTS = 8;
const NEVER = -1e12;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const backOut = (t) => {
  const s = 1.9;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
};
const elasticOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)));

/** Waits for the bundled Nunito font (max 1.5 s) before canvas text is rendered (§4.12 Fonts). */
function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.race([
    document.fonts.load('900 40px Nunito', 'AaĞğŞşİıЖж').catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas the UI owns its CSS box; the renderer sizes the backing store
   * @param {{ theme?: Object|string, t?: (key: string, params?: Object) => string }} [opts]
   */
  constructor(canvas, { theme, t } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.theme = typeof theme === 'object' && theme ? theme : getTheme(theme);
    this._t = typeof t === 'function' ? t : null;
    /** @type {Object|null} GameSession */
    this.session = null;
    /** @type {import('./layout.js').Layout} */
    this.layout = computeLayout(Math.max(1, canvas.clientWidth || 360), Math.max(1, canvas.clientHeight || 640), 1);
    /** 1 = normal speed, 0 = instant (effects skipped, promises resolve immediately), tests use 20 */
    this.timeScale = 1;
    /** Where collected gems fly to (CSS px in canvas coordinates; may be above the canvas). Extra. */
    this.gemTarget = null;
    /** Max render pixel ratio (§4.12: 2). Extra. */
    this.maxDpr = 2;
    /** Automatic drop to 1.5 dpr on slow devices. Extra. */
    this.autoDpr = true;
    /** Optional frame statistics for the sandbox (extra): enable with renderer.perf.enabled = true. */
    this.perf = { enabled: false, n: 0, lastT: 0, work: new Float32Array(4096), interval: new Float32Array(4096) };

    this.dpr = 1;
    this._dprCap = 2;
    this._sizeKey = '';
    this._insets = { gestureLeft: 0, gestureRight: 0 };
    this.sprites = new SpriteSet();
    this.particles = new Particles(256);
    this._rnd = makeRandom(0x5eed);
    this.time = 0;
    this._frozen = false;
    this._running = false;
    this._raf = 0;
    this._last = 0;
    this._busyUntil = 0;
    this._pending = [];
    this._frameHook = null;
    this._fontsReady = false;
    this._dprSamples = new Float32Array(60);
    this._dprScratch = new Float32Array(60);
    this._dprN = 0;

    // drag state (copied from setDrag)
    this._drag = {
      active: false, trayIndex: -1, x: 0, y: 0, hasSnap: false, snapR: 0, snapC: 0,
      rowsRef: null, colsRef: null, color: 0, shape: null, pickupStart: 0, fromX: 0, fromY: 0, fromScale: 1,
    };
    this._hl = new Uint8Array(N * N); // cells in lines that would clear (hover)
    this._hlRows = [];
    this._hlCols = [];

    // per-cell / per-row / per-slot animation clocks
    this._popStart = new Float64Array(N * N).fill(NEVER);
    this._greyStart = new Float64Array(N).fill(NEVER);
    this._greyK = new Float32Array(N);
    this._gameOver = false;
    this._gameOverStart = NEVER;
    this._ungreyStart = NEVER;
    this._refillStart = new Float64Array(SLOTS).fill(NEVER);
    this._shuffleStart = new Float64Array(SLOTS).fill(NEVER);
    this._retActive = new Uint8Array(SLOTS);
    this._retStart = new Float64Array(SLOTS);
    this._retX = new Float64Array(SLOTS);
    this._retY = new Float64Array(SLOTS);
    this._retDone = [null, null, null];
    this._trayShakeStart = NEVER;
    this._placeable = [true, true, true];
    this._dimming = true;

    // dying cells pool
    this._dyN = 0;
    this._dyIdx = new Uint8Array(MAX_DYING);
    this._dyColor = new Uint8Array(MAX_DYING);
    this._dyShard = new Uint8Array(MAX_DYING);
    this._dyGem = new Uint8Array(MAX_DYING);
    this._dyKind = new Uint8Array(MAX_DYING);
    this._dySpawned = new Uint8Array(MAX_DYING);
    this._dyStart = new Float64Array(MAX_DYING);
    this._dyDelay = new Float32Array(MAX_DYING);
    this._dyOx = new Float32Array(MAX_DYING);
    this._dyOy = new Float32Array(MAX_DYING);

    // light sweeps along cleared lines
    this._swN = 0;
    this._swRow = new Uint8Array(MAX_SWEEPS);
    this._swIdx = new Uint8Array(MAX_SWEEPS);
    this._swStart = new Float64Array(MAX_SWEEPS);
    this._swOrigin = new Float32Array(MAX_SWEEPS);

    // shockwave rings
    this._rgN = 0;
    this._rgX = new Float32Array(MAX_RINGS);
    this._rgY = new Float32Array(MAX_RINGS);
    this._rgR = new Float32Array(MAX_RINGS);
    this._rgStart = new Float64Array(MAX_RINGS);
    this._rgDur = new Float32Array(MAX_RINGS);

    // floating texts (each slot owns a canvas for dynamic strings)
    this._texts = [];
    for (let i = 0; i < MAX_TEXTS; i++) {
      this._texts.push({
        active: false, kind: 0, own: makeCanvas(1, 1), img: null, w: 0, h: 0,
        x: 0, y: 0, start: 0, dur: 0, rise: 0,
      });
    }

    // board-wide effects
    this._shakeStart = NEVER;
    this._shakeDur = 0;
    this._shakeAmp = 0;
    this._flashStart = NEVER;
    this._flashDur = 0;

    // hint, target mode, twinkle, sync fade
    this._hint = { active: false, trayIndex: 0, r: 0, c: 0, start: 0 };
    /** @type {null|'hammer'} */
    this.targetMode = null;
    this._target = { active: false, r: 0, c: 0 };
    this._twinkleIdx = -1;
    this._twinkleStart = NEVER;
    this._nextTwinkle = 0;
    this._ambientTimer = 0;
    this._fadeCanvas = null;
    this._fadeStart = NEVER;
    this._tmp = { x: 0, y: 0, s: 1 };
    this._allClearAt = NEVER;

    this._onFrame = this._onFrame.bind(this);
    this._onVisibility = () => {
      if (!document.hidden) this.invalidate();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
    this._onFontsDone = () => {
      this.sprites.texts.clear();
      this.invalidate();
    };
    if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', this._onFontsDone);
    }
    /** Resolves once the font is loaded (or after 1.5 s). Extra. */
    this.ready = loadFonts().then(() => {
      this._fontsReady = true;
      this.sprites.texts.clear();
      this._warmTexts();
      this.invalidate();
    });

    this._resizeRaf = 0;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._scheduleResize());
      this._ro.observe(canvas);
    }
    this._onWinResize = () => this._scheduleResize();
    if (typeof window !== 'undefined') window.addEventListener('resize', this._onWinResize);
    this.resize();
  }

  // -------------------------------------------------------------------------------------------
  // Public API – configuration
  // -------------------------------------------------------------------------------------------

  /** @param {Object|string} theme theme object or id */
  setTheme(theme) {
    this.theme = typeof theme === 'object' && theme ? theme : getTheme(theme);
    this._rebuildSprites();
    this.invalidate();
  }

  /** Replaces the translator (language change). Extra. */
  setTranslator(t) {
    this._t = typeof t === 'function' ? t : null;
    this.sprites.texts.clear();
    this._warmTexts();
  }

  /**
   * Side margins from the native gesture insets (CSS px). Extra (§4.12 layout margins).
   * @param {{ gestureLeft?: number, gestureRight?: number }} insets
   */
  setInsets(insets) {
    this._insets = { gestureLeft: (insets && insets.gestureLeft) || 0, gestureRight: (insets && insets.gestureRight) || 0 };
    this._sizeKey = '';
    this.resize();
  }

  /** Called once per rendered frame before drawing (DragController uses it). Extra. */
  setFrameHook(fn) {
    this._frameHook = typeof fn === 'function' ? fn : null;
  }

  /** @param {Object|null} session GameSession; resets all transient effects */
  setSession(session) {
    this.session = session || null;
    this._resetEffects();
    this._refreshPlaceable();
    this.invalidate();
  }

  /** Adopts the current session state with a short cross-fade (e.g. next tutorial step). */
  sync() {
    if (this.canvas.width > 1 && this.timeScale > 0) {
      if (!this._fadeCanvas || this._fadeCanvas.width !== this.canvas.width || this._fadeCanvas.height !== this.canvas.height) {
        this._fadeCanvas = makeCanvas(this.canvas.width, this.canvas.height);
      }
      const fctx = this._fadeCanvas.getContext('2d');
      fctx.drawImage(this.canvas, 0, 0);
      this._fadeStart = this.time;
      this._extend(TIMING.SYNC_FADE);
    }
    this._popStart.fill(NEVER);
    this._dyN = 0;
    this._swN = 0;
    this._gameOver = false;
    this._greyStart.fill(NEVER);
    this._ungreyStart = NEVER;
    this._refreshPlaceable();
    this.invalidate();
  }

  /** Stops (true) or resumes (false) the animation clock – for screenshots mid-animation. */
  freeze(on) {
    this._frozen = !!on;
    this._last = 0;
    this.invalidate();
  }

  /**
   * Steps the effect clock by `ms` in 16 ms increments and draws one frame – deterministic
   * screenshots / tests (use with freeze(true)). Extra.
   * @param {number} ms
   */
  advance(ms) {
    let left = Math.max(0, ms);
    while (left > 0) {
      const dt = Math.min(16, left);
      left -= dt;
      this.time += dt;
      if (this._frameHook) this._frameHook();
      this._update(dt);
    }
    this._draw();
  }

  /** Starts rendering (idempotent). */
  start() {
    this._running = true;
    this._last = 0;
    this.invalidate();
  }

  /** Stops the RAF loop (no frames until start()). */
  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._last = 0;
    clearTimeout(this._ambientTimer);
  }

  /** Requests a redraw (starts the loop for at least one frame). */
  invalidate() {
    if (!this._running || this._raf) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this._raf = requestAnimationFrame(this._onFrame);
  }

  /** Releases observers and listeners. Extra. */
  destroy() {
    this.stop();
    if (this._ro) this._ro.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onWinResize);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', this._onFontsDone);
    }
    for (const p of this._pending) {
      clearTimeout(p.timer);
      p.resolve();
    }
    this._pending.length = 0;
  }

  /**
   * Re-measures the canvas and rebuilds size-dependent sprites. Ignored if (cssW, cssH, dpr) are
   * unchanged. Called automatically (ResizeObserver, coalesced to the next animation frame).
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (!(cssW > 0 && cssH > 0)) return;
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, this.maxDpr, this._dprCap);
    const key = `${cssW}x${cssH}@${dpr}`;
    if (key === this._sizeKey) return;
    this._sizeKey = key;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.layout = computeLayout(cssW, cssH, dpr, this._insets);
    this._rebuildSprites();
    this._last = 0;
    this.invalidate();
  }

  // -------------------------------------------------------------------------------------------
  // Public API – input queries
  // -------------------------------------------------------------------------------------------

  /** @returns {number} tray slot under (x, y) CSS px, or -1 */
  trayIndexAt(x, y) {
    const rects = this.layout.trayRects;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
  }

  /** @returns {{r: number, c: number}} fractional (unclamped) board cell under (x, y) */
  cellAt(x, y) {
    const L = this.layout;
    return { r: (y - L.boardY) / L.cell, c: (x - L.boardX) / L.cell };
  }

  // -------------------------------------------------------------------------------------------
  // Public API – drag visuals
  // -------------------------------------------------------------------------------------------

  /**
   * Floating piece + ghost + line highlight.
   * @param {{ trayIndex: number, x: number, y: number, snap: {r:number,c:number}|null, rows: number[], cols: number[] } | null} d
   *   x, y = top-left of the floating piece at board cell size (CSS px)
   */
  setDrag(d) {
    const D = this._drag;
    if (!d) {
      if (D.active) {
        D.active = false;
        this._setHighlight(null, null);
      }
      this.invalidate();
      return;
    }
    const piece = this.session && this.session.tray[d.trayIndex];
    if (!D.active || D.trayIndex !== d.trayIndex) {
      if (!piece) return;
      const shape = getShape(piece.shapeId);
      D.active = true;
      D.trayIndex = d.trayIndex;
      D.shape = shape;
      D.color = piece.color;
      D.pickupStart = this.time;
      D.fromScale = this.layout.trayCell / this.layout.cell;
      if (this._retActive[d.trayIndex]) {
        // picked up again while flying back: continue from the current flight position
        const p = this._returnPos(d.trayIndex, this._tmp);
        D.fromX = p.x;
        D.fromY = p.y;
        D.fromScale = p.s;
        this._finishReturn(d.trayIndex);
      } else {
        const p = this._slotTopLeft(d.trayIndex, shape, this._tmp);
        D.fromX = p.x;
        D.fromY = p.y;
      }
      this._refillStart[d.trayIndex] = NEVER;
      this._shuffleStart[d.trayIndex] = NEVER;
    }
    D.x = d.x;
    D.y = d.y;
    D.hasSnap = !!d.snap;
    if (d.snap) {
      D.snapR = d.snap.r;
      D.snapC = d.snap.c;
    }
    if (d.rows !== D.rowsRef || d.cols !== D.colsRef) {
      D.rowsRef = d.rows;
      D.colsRef = d.cols;
      this._setHighlight(d.snap ? d.rows : null, d.snap ? d.cols : null);
    }
    this.invalidate();
  }

  /**
   * Flies a released piece back to its slot.
   * @param {number} trayIndex
   * @param {number} x top-left of the floating piece (board scale, CSS px)
   * @param {number} y
   * @returns {Promise<void>}
   */
  animateReturn(trayIndex, x, y) {
    if (trayIndex < 0 || trayIndex >= SLOTS) return Promise.resolve();
    this._finishReturn(trayIndex);
    if (this.timeScale <= 0) return Promise.resolve();
    this._retActive[trayIndex] = 1;
    this._retStart[trayIndex] = this.time;
    this._retX[trayIndex] = x;
    this._retY[trayIndex] = y;
    const p = this._after(TIMING.RETURN);
    this._retDone[trayIndex] = p;
    return p;
  }

  // -------------------------------------------------------------------------------------------
  // Public API – effects
  // -------------------------------------------------------------------------------------------

  /**
   * Placement feedback: pop-in, clear flash + staggered burst + shards, light sweep, +points,
   * praise / combo text, shake, all-clear celebration, gems flying to the HUD.
   * @param {Object} result PlaceResult
   * @returns {Promise<void>} resolves when the board visuals are final (≤ 350 ms)
   */
  animatePlace(result) {
    this._refreshPlaceable(result && result.placeable);
    this.invalidate();
    if (!result || this.timeScale <= 0) return Promise.resolve();
    const T = this.time;
    const L = this.layout;
    const cell = L.cell;
    const shape = getShape(result.piece.shapeId);
    const pc = result.piece.color;
    const placed = result.placedCells || [];
    for (let k = 0; k < placed.length; k++) this._popStart[placed[k][0] * N + placed[k][1]] = T;
    const cx = L.boardX + (result.c + shape.w / 2) * cell;
    const cy = L.boardY + (result.r + shape.h / 2) * cell;
    let dur = TIMING.POP;
    const cleared = result.cleared || [];
    if (cleared.length) {
      let maxStep = 0;
      for (let k = 0; k < cleared.length; k++) {
        const cl = cleared[k];
        let d = 99;
        for (let j = 0; j < placed.length; j++) {
          const dd = Math.max(Math.abs(cl.r - placed[j][0]), Math.abs(cl.c - placed[j][1]));
          if (dd < d) d = dd;
        }
        const step = Math.min(TIMING.MAX_STEPS, d === 99 ? 0 : d);
        if (step > maxStep) maxStep = step;
        this._addDying(cl.r, cl.c, pc, cl.color, cl.gem, T, TIMING.FLASH + step * TIMING.STEP, cx, cy, DK_LINE);
      }
      dur = TIMING.FLASH + maxStep * TIMING.STEP + TIMING.BURST;
      const rows = (result.lines && result.lines.rows) || [];
      const cols = (result.lines && result.lines.cols) || [];
      for (let k = 0; k < rows.length; k++) this._addSweep(true, rows[k], result.c + shape.w / 2, T);
      for (let k = 0; k < cols.length; k++) this._addSweep(false, cols[k], result.r + shape.h / 2, T);
      this._spawnClearTexts(result, cx, cy);
      if ((result.linesCount || 0) >= 3 || result.allClear) this._shake(TIMING.SHAKE_PX, TIMING.SHAKE);
      if (result.allClear) this._allClearFx();
    }
    return this._after(dur);
  }

  /** Bounce-in of a new tray (pieces stay pickable while bouncing). */
  animateTrayRefill() {
    this._refreshPlaceable();
    this.invalidate();
    if (this.timeScale <= 0 || !this.session) return Promise.resolve();
    let k = 0;
    for (let i = 0; i < SLOTS; i++) {
      if (!this.session.tray[i]) continue;
      if (this._drag.active && this._drag.trayIndex === i) continue;
      this._refillStart[i] = this.time + k * TIMING.REFILL_STAGGER;
      k++;
    }
    return this._after(TIMING.REFILL);
  }

  /** 'No space!' + tray shake, then the board greys out bottom → top. ≤ 1.0 s. */
  animateGameOver() {
    this._gameOver = true;
    this.invalidate();
    if (this.timeScale <= 0) {
      this._greyStart.fill(NEVER / 2);
      this._gameOverStart = NEVER / 2;
      return Promise.resolve();
    }
    const T = this.time;
    this._gameOverStart = T;
    this._ungreyStart = NEVER;
    for (let r = 0; r < N; r++) this._greyStart[r] = T + TIMING.GREY_START + (N - 1 - r) * TIMING.GREY_ROW;
    this._trayShakeStart = T;
    const L = this.layout;
    this._spawnText(TK_NOSPACE, this._sprite('nospace', this._tr('nospace'), 'nospace', this._bigFont(0.95)),
      L.boardX + L.boardPx / 2, L.boardY + L.boardPx * 0.45, TIMING.NOSPACE, 0);
    return this._after(TIMING.GAME_OVER);
  }

  /** Removes the game-over grey (fades the colors back) and the 'No space!' text. */
  clearGameOver() {
    if (!this._gameOver) return;
    this._gameOver = false;
    this._ungreyStart = this.time;
    this._greyStart.fill(NEVER);
    for (let i = 0; i < MAX_TEXTS; i++) if (this._texts[i].kind === TK_NOSPACE) this._texts[i].active = false;
    this._extend(TIMING.UNGREY);
    this.invalidate();
  }

  /**
   * Revive blast: cleared rows/cols explode from the board centre, new tray bounces in.
   * @param {{ cleared: Array<{r,c,color,gem}> }} rr ReviveResult
   */
  animateRevive(rr) {
    this.clearGameOver();
    this._refreshPlaceable(rr && rr.placeable);
    if (!rr || this.timeScale <= 0) return Promise.resolve();
    const L = this.layout;
    const T = this.time;
    const cx = L.boardX + L.boardPx / 2;
    const cy = L.boardY + L.boardPx / 2;
    const cleared = rr.cleared || [];
    for (let k = 0; k < cleared.length; k++) {
      const cl = cleared[k];
      const d = Math.max(Math.abs(cl.r - 3.5), Math.abs(cl.c - 3.5)) - 0.5;
      this._addDying(cl.r, cl.c, cl.color, cl.color, cl.gem, T, TIMING.FLASH + Math.round(d) * TIMING.STEP, cx, cy, DK_BLAST);
    }
    this._addRing(cx, cy, L.boardPx * 0.75, 520);
    this._flash(320);
    this._shake(4, 160);
    this._sparkleBurst(cx, cy, 14, L.boardPx * 0.35);
    this.animateTrayRefill();
    return this._after(TIMING.REVIVE);
  }

  /**
   * Hammer booster: the 3x3 area shatters with a shockwave.
   * @param {{ cleared: Array<{r,c,color,gem}> }} br BoosterResult
   */
  animateBlast(br) {
    this._refreshPlaceable(br && br.placeable);
    this.invalidate();
    if (!br || this.timeScale <= 0) return Promise.resolve();
    const cleared = br.cleared || [];
    if (!cleared.length) return Promise.resolve();
    const L = this.layout;
    const T = this.time;
    let sr = 0;
    let sc = 0;
    for (let k = 0; k < cleared.length; k++) {
      sr += cleared[k].r;
      sc += cleared[k].c;
    }
    const mr = sr / cleared.length;
    const mc = sc / cleared.length;
    const cx = L.boardX + (mc + 0.5) * L.cell;
    const cy = L.boardY + (mr + 0.5) * L.cell;
    for (let k = 0; k < cleared.length; k++) {
      const cl = cleared[k];
      const d = Math.round(Math.max(Math.abs(cl.r - mr), Math.abs(cl.c - mc)));
      this._addDying(cl.r, cl.c, cl.color, cl.color, cl.gem, T, 40 + d * 40, cx, cy, DK_BLAST);
    }
    this._addRing(cx, cy, L.cell * 2.6, 380);
    this._shake(5, 170);
    this._sparkleBurst(cx, cy, 8, L.cell);
    return this._after(TIMING.BLAST);
  }

  /** Shuffle booster: the (already replaced) tray pieces spin in. */
  animateShuffle() {
    this._refreshPlaceable();
    this.invalidate();
    if (this.timeScale <= 0 || !this.session) return Promise.resolve();
    let k = 0;
    for (let i = 0; i < SLOTS; i++) {
      if (!this.session.tray[i]) continue;
      this._shuffleStart[i] = this.time + k * TIMING.SHUFFLE_STAGGER;
      const R = this.layout.trayRects[i];
      this._sparkleBurst(R.x + R.w / 2, R.cy, 6, this.layout.trayCell * 2, k * TIMING.SHUFFLE_STAGGER);
      k++;
    }
    return this._after(TIMING.SHUFFLE);
  }

  /**
   * Generic floating text (e.g. "+60" coins, goal hints).
   * @param {string} text
   * @param {number} x centre, CSS px
   * @param {number} y
   * @param {{ size?: number, duration?: number, rise?: number, kind?: 'info'|'points'|'combo'|'praise', level?: string }} [opts]
   * @returns {Promise<void>}
   */
  floatText(text, x, y, opts = {}) {
    if (this.timeScale <= 0) return Promise.resolve();
    const dur = opts.duration || TIMING.POINTS;
    const size = opts.size || this._smallFont(0.6);
    const slot = this._spawnText(opts.kind === 'praise' ? TK_PRAISE : TK_INFO, null, x, y, dur, opts.rise ?? this.layout.cell);
    const { w, h } = renderTextSprite(slot.own, String(text), {
      kind: opts.kind || 'info', level: opts.level, size, dpr: this.dpr, theme: this.theme, maxWidth: this.layout.width * 0.92,
    });
    slot.img = slot.own;
    slot.w = w;
    slot.h = h;
    return this._after(dur);
  }

  /**
   * Celebrations (non-blocking): 'newBest' banner + confetti (1.2 s), 'win' confetti shower,
   * 'allClear' board flash + ring + confetti. animatePlace() already triggers 'allClear' itself.
   * @param {'newBest'|'win'|'allClear'} kind
   */
  celebrate(kind) {
    this.invalidate();
    if (this.timeScale <= 0) return Promise.resolve();
    const L = this.layout;
    if (kind === 'newBest') {
      const s = this._sprite('newbest', this._tr('newbest'), 'newbest', this._bigFont(0.9));
      const bxm = L.boardX + L.boardPx / 2;
      const bym = L.boardY + L.cell * 1.1;
      this._spawnText(TK_BANNER, s, bxm, bym, TIMING.NEW_BEST, 0);
      this._confetti(bxm - s.w * 0.45, bym, 26, -2.5, 60);
      this._confetti(bxm + s.w * 0.45, bym, 26, -0.64, 60);
      this._sparkleBurst(bxm, bym, 8, s.w * 0.5, 60);
      return this._after(TIMING.NEW_BEST);
    }
    if (kind === 'win') {
      const w = L.width;
      for (let i = 0; i < 5; i++) this._confetti(w * (0.1 + 0.2 * i), -L.cell * 0.5, 18, Math.PI / 2, i * 90, true);
      this._sparkleBurst(L.boardX + L.boardPx / 2, L.boardY + L.boardPx / 2, 16, L.boardPx * 0.45);
      this._addRing(L.boardX + L.boardPx / 2, L.boardY + L.boardPx / 2, L.boardPx * 0.8, 700);
      this._flash(260);
      return this._after(TIMING.WIN);
    }
    if (kind === 'allClear') {
      if (this.time - this._allClearAt < 400) return this._after(TIMING.ALL_CLEAR);
      this._allClearFx();
      return this._after(TIMING.ALL_CLEAR);
    }
    return Promise.resolve();
  }

  /** Tutorial hand: drags a ghost of tray piece `hint.trayIndex` to (r, c), looping. */
  showHint(hint) {
    if (!hint) {
      this.hideHint();
      return;
    }
    const H = this._hint;
    if (!H.active || H.trayIndex !== hint.trayIndex || H.r !== hint.r || H.c !== hint.c) H.start = this.time;
    H.active = true;
    H.trayIndex = hint.trayIndex;
    H.r = hint.r;
    H.c = hint.c;
    this.invalidate();
  }

  hideHint() {
    this._hint.active = false;
    this.invalidate();
  }

  /** @param {null|'hammer'} mode booster target mode: board pulses, 3x3 under the pointer */
  setTargetMode(mode) {
    this.targetMode = mode || null;
    if (!this.targetMode) this._target.active = false;
    this.invalidate();
  }

  /** Cell under the pointer in target mode (DragController drives it). Extra. */
  setTargetCell(r, c) {
    const T = this._target;
    if (r === null || r === undefined || r < 0 || c < 0 || r >= N || c >= N) T.active = false;
    else {
      T.active = true;
      T.r = r | 0;
      T.c = c | 0;
    }
    this.invalidate();
  }

  /** Dims tray pieces that fit nowhere (default on). */
  setPieceDimming(on) {
    this._dimming = !!on;
    this._refreshPlaceable();
    this.invalidate();
  }

  // -------------------------------------------------------------------------------------------
  // Internals – bookkeeping
  // -------------------------------------------------------------------------------------------

  _tr(key, params) {
    let s = this._t ? this._t(key, params) : null;
    if (!s || s === key) s = FALLBACK_TEXT[key] || key;
    if (params && params.n !== undefined) s = s.replace('{n}', String(params.n));
    return s;
  }

  _bigFont(k) {
    return Math.max(26, Math.min(88, this.layout.cell * k));
  }

  _smallFont(k) {
    return Math.max(16, Math.min(48, this.layout.cell * k));
  }

  /** Cached text sprite. */
  _sprite(key, text, kind, size, level) {
    return this.sprites.text(`${key}|${size}`, text, { kind, size, level, maxWidth: this.layout.boardPx * 0.98 });
  }

  /** Pre-renders the fixed texts so the first big clear does not stall. */
  _warmTexts() {
    if (!this._fontsReady || !this.sprites.theme) return;
    setTimeout(() => {
      for (const key of Object.keys(PRAISE_STYLES)) this._sprite(`praise.${key}`, this._tr(`praise.${key}`), 'praise', this._bigFont(1.0), key);
      this._sprite('nospace', this._tr('nospace'), 'nospace', this._bigFont(0.95));
      this._sprite('newbest', this._tr('newbest'), 'newbest', this._bigFont(0.9));
      for (let n = 2; n <= 5; n++) this._sprite(`combo.${n}`, this._tr('combo', { n }), 'combo', this._smallFont(0.62));
    }, 0);
  }

  _rebuildSprites() {
    const L = this.layout;
    if (!(L.cell > 0) || !(L.width > 0)) return;
    this.sprites.build(this.theme, L, this.dpr, L.width, L.height);
    this._warmTexts();
  }

  _scheduleResize() {
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.resize();
    });
  }

  _resetEffects() {
    this._drag.active = false;
    this._setHighlight(null, null);
    this._popStart.fill(NEVER);
    this._greyStart.fill(NEVER);
    this._gameOver = false;
    this._ungreyStart = NEVER;
    this._refillStart.fill(NEVER);
    this._shuffleStart.fill(NEVER);
    for (let i = 0; i < SLOTS; i++) this._finishReturn(i);
    this._trayShakeStart = NEVER;
    this._dyN = 0;
    this._swN = 0;
    this._rgN = 0;
    for (let i = 0; i < MAX_TEXTS; i++) this._texts[i].active = false;
    this.particles.clear();
    this._shakeStart = NEVER;
    this._flashStart = NEVER;
    this._hint.active = false;
    this.targetMode = null;
    this._target.active = false;
    this._twinkleIdx = -1;
    this._fadeStart = NEVER;
  }

  _refreshPlaceable(list) {
    const s = this.session;
    for (let i = 0; i < SLOTS; i++) {
      if (Array.isArray(list) && list.length === SLOTS) this._placeable[i] = !!list[i] || !(s && s.tray[i]);
      else this._placeable[i] = !s || !s.tray[i] || (typeof s.isPiecePlaceable === 'function' ? s.isPiecePlaceable(i) : true);
    }
  }

  _setHighlight(rows, cols) {
    this._hl.fill(0);
    this._hlRows = rows || [];
    this._hlCols = cols || [];
    if (rows) for (let k = 0; k < rows.length; k++) for (let c = 0; c < N; c++) this._hl[rows[k] * N + c] = 1;
    if (cols) for (let k = 0; k < cols.length; k++) for (let r = 0; r < N; r++) this._hl[r * N + cols[k]] = 1;
  }

  /** Keeps the loop running for at least `ms` more effect time. */
  _extend(ms) {
    const end = this.time + ms;
    if (end > this._busyUntil) this._busyUntil = end;
    this.invalidate();
  }

  /**
   * Promise that resolves when the effect clock reached now + ms, or by wall clock
   * (ms / timeScale + 250 ms), or immediately at timeScale 0.
   */
  _after(ms) {
    if (this.timeScale <= 0) return Promise.resolve();
    this._extend(ms);
    return new Promise((resolve) => {
      const p = { end: this.time + ms, resolve, timer: 0 };
      p.timer = setTimeout(() => this._settle(p), ms / this.timeScale + 250);
      this._pending.push(p);
    });
  }

  _settle(p) {
    const i = this._pending.indexOf(p);
    if (i >= 0) {
      this._pending[i] = this._pending[this._pending.length - 1];
      this._pending.pop();
    }
    clearTimeout(p.timer);
    p.resolve();
  }

  _finishReturn(i) {
    this._retActive[i] = 0;
    this._retDone[i] = null;
  }

  _shake(px, ms) {
    this._shakeStart = this.time;
    this._shakeDur = ms;
    this._shakeAmp = px;
    this._extend(ms);
  }

  _flash(ms) {
    this._flashStart = this.time;
    this._flashDur = ms;
    this._extend(ms);
  }

  _addDying(r, c, color, shardColor, gem, start, delay, ox, oy, kind) {
    if (this._dyN >= MAX_DYING) return;
    const k = this._dyN++;
    this._dyIdx[k] = r * N + c;
    this._dyColor[k] = color;
    this._dyShard[k] = shardColor;
    this._dyGem[k] = gem || 0;
    this._dyKind[k] = kind;
    this._dySpawned[k] = 0;
    this._dyStart[k] = start;
    this._dyDelay[k] = delay;
    this._dyOx[k] = ox;
    this._dyOy[k] = oy;
    this._extend(delay + TIMING.BURST);
  }

  _addSweep(isRow, idx, origin, start) {
    if (this._swN >= MAX_SWEEPS) return;
    const k = this._swN++;
    this._swRow[k] = isRow ? 1 : 0;
    this._swIdx[k] = idx;
    this._swStart[k] = start;
    this._swOrigin[k] = origin;
    this._extend(TIMING.SWEEP);
  }

  _addRing(x, y, radius, dur) {
    if (this._rgN >= MAX_RINGS) return;
    const k = this._rgN++;
    this._rgX[k] = x;
    this._rgY[k] = y;
    this._rgR[k] = radius;
    this._rgStart[k] = this.time;
    this._rgDur[k] = dur;
    this._extend(dur);
  }

  /** Claims a text slot (the oldest one if all are busy). */
  _spawnText(kind, sprite, x, y, dur, rise) {
    let slot = null;
    let oldest = Infinity;
    for (let i = 0; i < MAX_TEXTS; i++) {
      const s = this._texts[i];
      if (!s.active) {
        slot = s;
        break;
      }
      if (s.start < oldest) {
        oldest = s.start;
        slot = s;
      }
    }
    slot.active = true;
    slot.kind = kind;
    slot.img = sprite ? sprite.img : null;
    slot.w = sprite ? sprite.w : 0;
    slot.h = sprite ? sprite.h : 0;
    slot.x = x;
    slot.y = y;
    slot.start = this.time;
    slot.dur = dur;
    slot.rise = rise;
    this._extend(dur);
    return slot;
  }

  _spawnClearTexts(result, cx, cy) {
    const L = this.layout;
    const midX = L.boardX + L.boardPx / 2;
    let praiseY = L.boardY + L.boardPx * 0.4;
    // keep the praise away from the piece centre where the points rise
    if (Math.abs(cy - praiseY) < L.cell * 1.2) praiseY = cy > L.boardY + L.boardPx / 2 ? cy - L.cell * 2.1 : cy + L.cell * 2.1;
    let comboY = praiseY;
    if (result.praise) {
      const s = this._sprite(`praise.${result.praise}`, this._tr(`praise.${result.praise}`), 'praise', this._bigFont(1.0), result.praise);
      this._spawnText(TK_PRAISE, s, midX, praiseY, TIMING.PRAISE, L.cell * 0.6);
      comboY = praiseY + s.h * 0.62;
    }
    if (result.combo >= 2) {
      // cached per combo value (the glow blur is the expensive part of text rendering)
      const s = this._sprite(`combo.${result.combo}`, this._tr('combo', { n: result.combo }), 'combo', this._smallFont(0.62));
      this._spawnText(TK_COMBO, s, midX, result.praise ? comboY : cy - L.cell * 1.1, TIMING.PRAISE, L.cell * 0.6);
    }
    const pts = result.totalPoints || 0;
    if (pts > 0) {
      const slot = this._spawnText(TK_POINTS, null, cx, cy, TIMING.POINTS, L.cell * 1.1);
      const { w, h } = renderTextSprite(slot.own, `+${pts}`, {
        kind: 'points', size: this._smallFont(0.66), dpr: this.dpr, theme: this.theme,
      });
      slot.img = slot.own;
      slot.w = w;
      slot.h = h;
    }
  }

  _allClearFx() {
    const L = this.layout;
    this._allClearAt = this.time;
    const cx = L.boardX + L.boardPx / 2;
    const cy = L.boardY + L.boardPx / 2;
    this._flash(420);
    this._addRing(cx, cy, L.boardPx * 0.85, 600);
    this._confetti(cx, cy, 50, -Math.PI / 2, 120, false, true);
    this._sparkleBurst(cx, cy, 16, L.boardPx * 0.4, 100);
  }

  // -------------------------------------------------------------------------------------------
  // Particles helpers
  // -------------------------------------------------------------------------------------------

  /** Shards + glow + sparkle for one bursting cell. */
  _burstCell(x, y, color, shardColor, ox, oy, count, power) {
    const P = this.particles;
    const cell = this.layout.cell;
    const rnd = this._rnd;
    const base = Math.atan2(y - oy, x - ox);
    const centred = Math.abs(x - ox) + Math.abs(y - oy) < cell * 0.4;
    for (let i = 0; i < count; i++) {
      const a = centred ? rnd() * Math.PI * 2 : base + (rnd() - 0.5) * 2.4;
      const sp = cell * (3.5 + rnd() * 6.5) * power;
      P.spawn(P_SHARD, i % 2 ? color : shardColor, x + (rnd() - 0.5) * cell * 0.5, y + (rnd() - 0.5) * cell * 0.5,
        Math.cos(a) * sp, Math.sin(a) * sp - cell * (3 + rnd() * 4) * power,
        cell * (0.28 + rnd() * 0.3), 480 + rnd() * 360, rnd() * 6.28, (rnd() - 0.5) * 16);
    }
    if (rnd() < 0.5) P.spawn(P_DOT, color, x, y, 0, 0, cell * 1.15, 260);
    if (rnd() < 0.5) {
      P.spawn(P_SPARKLE, 0, x + (rnd() - 0.5) * cell, y + (rnd() - 0.5) * cell, (rnd() - 0.5) * cell * 2, -cell * (1 + rnd() * 2),
        cell * (0.5 + rnd() * 0.5), 380 + rnd() * 240);
    }
  }

  _sparkleBurst(x, y, count, radius, delay = 0) {
    const P = this.particles;
    const cell = this.layout.cell;
    for (let i = 0; i < count; i++) {
      const a = this._rnd() * Math.PI * 2;
      const r = radius * (0.2 + this._rnd() * 0.8);
      P.spawn(P_SPARKLE, 0, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, Math.cos(a) * r * 2, Math.sin(a) * r * 2,
        cell * (0.5 + this._rnd() * 0.7), 420 + this._rnd() * 400, 0, 0, delay + this._rnd() * 120);
    }
  }

  /**
   * Confetti burst at (x, y) toward angle `dir` (radians) – or a shower falling from y when `rain`.
   */
  _confetti(x, y, count, dir, delay = 0, rain = false, radial = false) {
    const P = this.particles;
    const cell = this.layout.cell;
    const colors = this.sprites.confetti.length || 1;
    for (let i = 0; i < count; i++) {
      const rnd = this._rnd;
      let vx;
      let vy;
      let px = x;
      if (rain) {
        px = x + (rnd() - 0.5) * this.layout.width * 0.25;
        vx = (rnd() - 0.5) * cell * 2;
        vy = cell * (2 + rnd() * 4);
      } else {
        const a = radial ? rnd() * Math.PI * 2 : dir + (rnd() - 0.5) * 1.1;
        const sp = cell * (8 + rnd() * 12);
        vx = Math.cos(a) * sp;
        vy = Math.sin(a) * sp - (radial ? cell * 6 : 0);
      }
      P.spawn(P_CONFETTI, i % colors, px, y, vx, vy, cell * (0.24 + rnd() * 0.14), 1400 + rnd() * 900, rnd() * 6.28,
        (rnd() - 0.5) * 12, delay + rnd() * 160);
    }
    this._extend(delay + 2400);
  }

  _spawnBurstFor(k) {
    const L = this.layout;
    const idx = this._dyIdx[k];
    const r = idx >> 3;
    const c = idx & 7;
    const x = L.boardX + (c + 0.5) * L.cell;
    const y = L.boardY + (r + 0.5) * L.cell;
    const many = this._dyN > 40 ? 2 : this._dyN > 20 ? 3 : 4;
    const blast = this._dyKind[k] === DK_BLAST;
    this._burstCell(x, y, this._dyColor[k], this._dyShard[k], this._dyOx[k], this._dyOy[k], blast ? many + 1 : many, blast ? 1.25 : 1);
    const gem = this._dyGem[k];
    if (gem) {
      const target = this.gemTarget;
      const tx = target ? target.x : L.boardX + L.boardPx / 2;
      const ty = target ? target.y : -L.cell;
      const i = this.particles.spawn(P_GEM, gem, x, y, 0, 0, L.cell * 1.05, 700);
      this.particles.setTarget(i, tx, ty);
      this._sparkleBurst(x, y, 3, L.cell * 0.6);
      this._extend(720);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------------------------

  _onFrame(now) {
    this._raf = 0;
    const animatedBefore = this._last !== 0;
    const raw = animatedBefore ? now - this._last : 16.7;
    this._last = now;
    const t0 = this.perf.enabled ? performance.now() : 0;
    const dt = this._frozen ? 0 : Math.min(raw, 50) * this.timeScale;
    this.time += dt;
    if (this._frameHook) this._frameHook();
    this._update(dt);
    this._draw();
    if (this.perf.enabled) {
      // interval = wall time between frame callbacks (RAF timestamps can repeat when frames are skipped)
      const t1 = performance.now();
      if (animatedBefore && this.perf.lastT) {
        const i = this.perf.n % this.perf.work.length;
        this.perf.work[i] = t1 - t0;
        this.perf.interval[i] = t0 - this.perf.lastT;
        this.perf.n++;
      }
      this.perf.lastT = t0;
    }
    const more = this._needsFrame();
    if (more && animatedBefore) this._sampleDpr(raw);
    // effects started during this frame may already have requested the next one (invalidate)
    if (more && this._running) {
      if (!this._raf) this._raf = requestAnimationFrame(this._onFrame);
    } else if (!this._raf) {
      this._last = 0;
      this._scheduleAmbient();
    }
  }

  _needsFrame() {
    if (this._frozen || !this._running) return false;
    return this.time < this._busyUntil
      || this._pending.length > 0
      || this.particles.n > 0
      || this._dyN > 0
      || this._drag.active
      || this._hint.active
      || this.targetMode !== null
      || this.time < this._twinkleStart + TIMING.TWINKLE;
  }

  /** Auto-drops the pixel ratio to 1.5 when the median animated frame time exceeds 22 ms. */
  _sampleDpr(raw) {
    if (!this.autoDpr || this._dprCap <= 1.5 || this.dpr <= 1.5) return;
    this._dprSamples[this._dprN++] = raw;
    if (this._dprN < this._dprSamples.length) return;
    this._dprN = 0;
    this._dprScratch.set(this._dprSamples);
    this._dprScratch.sort();
    const median = this._dprScratch[this._dprScratch.length >> 1];
    if (median > 22) {
      this._dprCap = 1.5;
      this._scheduleResize();
    }
  }

  /** While idle, occasionally wakes up for a gem twinkle (only if gems are on the board). */
  _scheduleAmbient() {
    clearTimeout(this._ambientTimer);
    if (!this._running || this._frozen || !this.session || !this._hasGems()) return;
    this._ambientTimer = setTimeout(() => {
      if (this._raf || !this._running) return;
      this._startTwinkle();
      this.invalidate();
    }, 2600 + this._rnd() * 1800);
  }

  _hasGems() {
    const g = this.session && this.session.board && this.session.board.gems;
    if (!g) return false;
    for (let i = 0; i < g.length; i++) if (g[i]) return true;
    return false;
  }

  _startTwinkle() {
    const g = this.session && this.session.board && this.session.board.gems;
    if (!g) return;
    const off = (this._rnd() * 64) | 0;
    for (let k = 0; k < 64; k++) {
      const i = (k + off) & 63;
      if (g[i] && this.session.board.cells[i]) {
        this._twinkleIdx = i;
        this._twinkleStart = this.time;
        return;
      }
    }
  }

  _update(dt) {
    const T = this.time;
    const L = this.layout;
    this.particles.update(dt, L.cell * 30);

    // dying cells: spawn shards at burst start, drop when done
    for (let k = 0; k < this._dyN; k++) {
      const age = T - this._dyStart[k];
      if (!this._dySpawned[k] && age >= this._dyDelay[k]) {
        this._dySpawned[k] = 1;
        this._spawnBurstFor(k);
      }
      if (age >= this._dyDelay[k] + TIMING.BURST) {
        this._removeDying(k);
        k--;
      }
    }
    for (let k = 0; k < this._swN; k++) {
      if (T - this._swStart[k] >= TIMING.SWEEP) {
        const j = --this._swN;
        this._swRow[k] = this._swRow[j];
        this._swIdx[k] = this._swIdx[j];
        this._swStart[k] = this._swStart[j];
        this._swOrigin[k] = this._swOrigin[j];
        k--;
      }
    }
    for (let k = 0; k < this._rgN; k++) {
      if (T - this._rgStart[k] >= this._rgDur[k]) {
        const j = --this._rgN;
        this._rgX[k] = this._rgX[j];
        this._rgY[k] = this._rgY[j];
        this._rgR[k] = this._rgR[j];
        this._rgStart[k] = this._rgStart[j];
        this._rgDur[k] = this._rgDur[j];
        k--;
      }
    }
    for (let i = 0; i < MAX_TEXTS; i++) {
      const s = this._texts[i];
      if (s.active && T - s.start >= s.dur) s.active = false;
    }
    for (let i = 0; i < SLOTS; i++) {
      if (this._retActive[i] && T - this._retStart[i] >= TIMING.RETURN) this._retActive[i] = 0;
    }
    // twinkle cadence while the loop runs anyway
    if (this._twinkleIdx >= 0 && T - this._twinkleStart >= TIMING.TWINKLE) this._twinkleIdx = -1;
    if (this._twinkleIdx < 0 && T >= this._nextTwinkle && this._hasGems()) {
      this._startTwinkle();
      this._nextTwinkle = T + 1500 + this._rnd() * 1500;
    }
    // promises
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      if (T >= p.end) {
        this._pending[i] = this._pending[this._pending.length - 1];
        this._pending.pop();
        clearTimeout(p.timer);
        p.resolve();
      }
    }
  }

  _removeDying(k) {
    const j = --this._dyN;
    if (k === j) return;
    this._dyIdx[k] = this._dyIdx[j];
    this._dyColor[k] = this._dyColor[j];
    this._dyShard[k] = this._dyShard[j];
    this._dyGem[k] = this._dyGem[j];
    this._dyKind[k] = this._dyKind[j];
    this._dySpawned[k] = this._dySpawned[j];
    this._dyStart[k] = this._dyStart[j];
    this._dyDelay[k] = this._dyDelay[j];
    this._dyOx[k] = this._dyOx[j];
    this._dyOy[k] = this._dyOy[j];
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  /** Top-left of tray piece `i` at tray scale, centred in its slot (device-pixel aligned). */
  _slotTopLeft(i, shape, out) {
    const R = this.layout.trayRects[i];
    const tc = this.layout.trayCell;
    const d = this.dpr;
    out.x = Math.round((R.x + (R.w - shape.w * tc) / 2) * d) / d;
    out.y = Math.round((R.cy - (shape.h * tc) / 2) * d) / d;
    return out;
  }

  /** Current position (top-left) and scale of a returning piece. */
  _returnPos(i, out) {
    const piece = this.session && this.session.tray[i];
    const shape = piece ? getShape(piece.shapeId) : null;
    const k = easeOutCubic(clamp01((this.time - this._retStart[i]) / TIMING.RETURN));
    const s0 = 1;
    const s1 = this.layout.trayCell / this.layout.cell;
    let tx = this._retX[i];
    let ty = this._retY[i];
    if (shape) {
      this._slotTopLeft(i, shape, out);
      tx = out.x;
      ty = out.y;
    }
    out.x = this._retX[i] + (tx - this._retX[i]) * k;
    out.y = this._retY[i] + (ty - this._retY[i]) * k;
    out.s = s0 + (s1 - s0) * k;
    return out;
  }

  _draw() {
    const ctx = this.ctx;
    const sp = this.sprites;
    if (!sp.background) return;
    const L = this.layout;
    const dpr = this.dpr;
    const T = this.time;
    const cell = L.cell;
    const bx = L.boardX;
    const by = L.boardY;
    const session = this.session;
    const D = this._drag;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sp.background, 0, 0);

    // screen shake (whole scene except the background)
    let ox = 0;
    let oy = 0;
    const sk = (T - this._shakeStart) / this._shakeDur;
    if (sk >= 0 && sk < 1) {
      // whole device pixels keep every sprite on the fast (non-resampling) blit path
      const a = this._shakeAmp * (1 - sk);
      ox = Math.round(Math.sin(T * 0.11) * a * dpr) / dpr;
      oy = Math.round(Math.cos(T * 0.083) * a * 0.75 * dpr) / dpr;
    }

    // board panel (frame + empty cells, one sprite) – blitted 1:1 in device pixels
    const br = sp.boardRect;
    const bdx = Math.round((br.x + ox) * dpr);
    const bdy = Math.round((br.y + oy) * dpr);
    ctx.drawImage(sp.board, bdx, bdy);
    if (this.targetMode) {
      // pulsing frame: "tap a block"
      ctx.globalAlpha = 0.45 + 0.4 * Math.sin(T * 0.008);
      ctx.drawImage(sp.frame, bdx, bdy);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

    // game-over grey factor per row
    const ungrey = this._ungreyStart > NEVER ? 1 - clamp01((T - this._ungreyStart) / TIMING.UNGREY) : 0;
    for (let r = 0; r < N; r++) {
      this._greyK[r] = this._gameOver ? clamp01((T - this._greyStart[r]) / TIMING.GREY_FADE) : ungrey;
    }

    if (session) this._drawCells(ctx, sp, T, cell, bx, by);

    // drop preview: ghost + glowing lines
    if (D.active && D.hasSnap && D.shape) {
      const pulse = 0.5 + 0.5 * Math.sin(T * 0.012);
      const cells = D.shape.cells;
      const img = sp.block[D.color];
      for (let k = 0; k < cells.length; k++) {
        const r = D.snapR + cells[k][0];
        const c = D.snapC + cells[k][1];
        ctx.globalAlpha = this._hl[r * N + c] ? 0.92 : this.theme.ghostAlpha + 0.1 * pulse;
        ctx.drawImage(img, bx + c * cell, by + r * cell, cell, cell);
      }
      ctx.globalAlpha = 1;
      if (this._hlRows.length || this._hlCols.length) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.28 + 0.22 * pulse) * (this.theme.fxGlow ?? 1);
        const th = sp.glowThick;
        for (let k = 0; k < this._hlRows.length; k++) {
          ctx.drawImage(sp.lineGlow(D.color, false), bx, by + (this._hlRows[k] + 0.5) * cell - th / 2, L.boardPx, th);
        }
        for (let k = 0; k < this._hlCols.length; k++) {
          ctx.drawImage(sp.lineGlow(D.color, true), bx + (this._hlCols[k] + 0.5) * cell - th / 2, by, th, L.boardPx);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }

    this._drawDying(ctx, sp, T, cell, bx, by);
    this._drawSweeps(ctx, sp, T, cell, bx, by);

    // board flash (all clear / revive)
    const fk = (T - this._flashStart) / this._flashDur;
    if (fk >= 0 && fk < 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32 * (1 - fk) * (1 - fk) * (this.theme.fxGlow ?? 1);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(bx, by, L.boardPx, L.boardPx);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    this._drawRings(ctx, sp, T);

    // particles under the tray / floating piece
    this.particles.draw(ctx, sp, dpr, ox, oy, LAYER_BOARD);
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);

    if (session) {
      this._drawTray(ctx, sp, T, dpr, ox, oy);
      this._drawReturning(ctx, sp);
      if (this.targetMode && this._target.active) this._drawTarget(ctx, sp, T, cell, bx, by);
      if (D.active && D.shape) this._drawFloating(ctx, sp, T, cell);
      if (this._hint.active) this._drawHint(ctx, sp, T, cell, bx, by);
    }

    this.particles.draw(ctx, sp, dpr, ox, oy, LAYER_TOP);
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    this._drawTexts(ctx, T, dpr, ox, oy);

    // cross-fade from the previous state (sync)
    const sf = (T - this._fadeStart) / TIMING.SYNC_FADE;
    if (this._fadeCanvas && sf >= 0 && sf < 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - sf;
      ctx.drawImage(this._fadeCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawCells(ctx, sp, T, cell, bx, by) {
    const board = this.session.board;
    const cells = board.cells;
    const gems = board.gems;
    const D = this._drag;
    const hover = D.active && D.hasSnap;
    for (let i = 0; i < 64; i++) {
      const v = cells[i];
      if (!v) continue;
      const r = i >> 3;
      const c = i & 7;
      let x = bx + c * cell;
      let y = by + r * cell;
      let s = cell;
      const pk = (T - this._popStart[i]) / TIMING.POP;
      const popping = pk >= 0 && pk < 1;
      if (popping) {
        const g = Math.sin(pk * Math.PI) * 0.1;
        s = cell * (1 + g);
        x -= (s - cell) / 2;
        y -= (s - cell) / 2;
      }
      const color = hover && this._hl[i] ? D.color : v - 1;
      const gk = this._greyK[r];
      if (gk < 1) ctx.drawImage(sp.block[color], x, y, s, s);
      if (gk > 0) {
        ctx.globalAlpha = gk;
        ctx.drawImage(sp.grey[color], x, y, s, s);
        ctx.globalAlpha = 1;
      }
      const gem = gems[i];
      if (gem) ctx.drawImage(sp.gem[gem], x, y, s, s);
      if (popping) {
        ctx.globalAlpha = 0.6 * (1 - pk);
        ctx.drawImage(sp.flash, x, y, s, s);
        ctx.globalAlpha = 1;
      }
    }
    // twinkle on a gem
    if (this._twinkleIdx >= 0) {
      const k = (T - this._twinkleStart) / TIMING.TWINKLE;
      const i = this._twinkleIdx;
      if (k >= 0 && k < 1 && gems[i] && cells[i]) {
        const s = cell * 0.75 * Math.sin(k * Math.PI);
        const x = bx + (i & 7) * cell + cell * 0.72;
        const y = by + (i >> 3) * cell + cell * 0.28;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(sp.sparkle, x - s / 2, y - s / 2, s, s);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  _drawDying(ctx, sp, T, cell, bx, by) {
    const glow = this.theme.fxGlow ?? 1;
    for (let k = 0; k < this._dyN; k++) {
      const age = T - this._dyStart[k];
      const idx = this._dyIdx[k];
      const x = bx + (idx & 7) * cell;
      const y = by + (idx >> 3) * cell;
      const img = sp.block[this._dyColor[k]];
      const gem = this._dyGem[k];
      const delay = this._dyDelay[k];
      if (age < delay) {
        // lit-up phase: the block glows (additive copy of itself + a light white flash) until
        // the burst wave arrives – stays saturated instead of washing out to white
        ctx.drawImage(img, x, y, cell, cell);
        const flash = age < TIMING.FLASH ? age / TIMING.FLASH : 1 - clamp01((age - TIMING.FLASH) / 90);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3 * glow;
        ctx.drawImage(img, x, y, cell, cell);
        ctx.globalCompositeOperation = 'source-over';
        if (flash > 0) {
          ctx.globalAlpha = 0.6 * flash * (0.5 + 0.5 * glow);
          ctx.drawImage(sp.flash, x, y, cell, cell);
        }
        ctx.globalAlpha = 1;
        if (gem) ctx.drawImage(sp.gem[gem], x, y, cell, cell);
      } else {
        const b = clamp01((age - delay) / TIMING.BURST);
        const s = cell * (1 + 0.35 * easeOutCubic(b)) * (1 - 0.25 * b * b);
        const o = (cell - s) / 2;
        ctx.globalAlpha = 1 - b;
        ctx.drawImage(img, x + o, y + o, s, s);
        ctx.globalAlpha = (1 - b) * 0.35 * glow;
        ctx.drawImage(sp.flash, x + o, y + o, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawSweeps(ctx, sp, T, cell, bx, by) {
    if (!this._swN) return;
    const glow = this.theme.fxGlow ?? 1;
    const dpr = this.dpr;
    const cellPx = cell * dpr;
    const th = sp.sweepThick;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < this._swN; k++) {
      const age = T - this._swStart[k];
      if (age < 0) continue;
      // the bar grows from the placed piece to both ends, then fades; drawn as a 1:1 slice
      const grow = easeOutCubic(clamp01(age / 170));
      const fade = age < 170 ? 1 : 1 - clamp01((age - 170) / (TIMING.SWEEP - 170));
      const o = this._swOrigin[k];
      const a = Math.round(Math.max(0, o - grow * N) * cellPx);
      const b = Math.round(Math.min(N, o + grow * N) * cellPx);
      if (b - a < 1) continue;
      ctx.globalAlpha = 0.6 * fade * glow;
      if (this._swRow[k]) {
        const yy = Math.round((by + (this._swIdx[k] + 0.5) * cell - th / 2) * dpr) / dpr;
        ctx.drawImage(sp.sweepH, a, 0, b - a, sp.sweepH.height, bx + a / dpr, yy, (b - a) / dpr, th);
      } else {
        const xx = Math.round((bx + (this._swIdx[k] + 0.5) * cell - th / 2) * dpr) / dpr;
        ctx.drawImage(sp.sweepV, 0, a, sp.sweepV.width, b - a, xx, by + a / dpr, th, (b - a) / dpr);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawRings(ctx, sp, T) {
    if (!this._rgN) return;
    const glow = Math.max(0.6, this.theme.fxGlow ?? 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < this._rgN; k++) {
      const t = clamp01((T - this._rgStart[k]) / this._rgDur[k]);
      const r = this._rgR[k] * easeOutCubic(t);
      ctx.globalAlpha = 0.85 * (1 - t) * (1 - t) * glow;
      ctx.drawImage(sp.ring, this._rgX[k] - r, this._rgY[k] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draws a piece centred at (cx, cy) with cells of size cs.
   * @param {boolean} tray use the tray-size sprites
   */
  _drawPiece(ctx, sp, shape, color, cx, cy, cs, rot, alpha, grey, tray, dpr, ox, oy) {
    const imgs = grey ? (tray ? sp.greyTray : sp.grey) : tray ? sp.blockTray : sp.block;
    const img = imgs[color];
    const cells = shape.cells;
    const hw = (shape.w * cs) / 2;
    const hh = (shape.h * cs) / 2;
    ctx.globalAlpha = alpha;
    if (rot !== 0) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, (cx + ox) * dpr, (cy + oy) * dpr);
      for (let k = 0; k < cells.length; k++) ctx.drawImage(img, cells[k][1] * cs - hw, cells[k][0] * cs - hh, cs, cs);
      ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    } else {
      const x0 = Math.round((cx - hw) * dpr) / dpr;
      const y0 = Math.round((cy - hh) * dpr) / dpr;
      for (let k = 0; k < cells.length; k++) ctx.drawImage(img, x0 + cells[k][1] * cs, y0 + cells[k][0] * cs, cs, cs);
    }
    ctx.globalAlpha = 1;
  }

  _drawTray(ctx, sp, T, dpr, ox, oy) {
    const L = this.layout;
    const tray = this.session.tray;
    const D = this._drag;
    const tc = L.trayCell;
    const playing = this.session.status === 'playing';
    let shakeX = 0;
    const tk = (T - this._trayShakeStart) / TIMING.TRAY_SHAKE;
    if (tk >= 0 && tk < 1) shakeX = Math.sin(tk * Math.PI * 7) * L.cell * 0.18 * (1 - tk);
    const greyAll = this._gameOver && T >= this._gameOverStart + TIMING.GREY_START;
    for (let i = 0; i < SLOTS; i++) {
      const piece = tray[i];
      if (!piece) continue;
      if (D.active && D.trayIndex === i) continue;
      if (this._retActive[i]) continue;
      const shape = getShape(piece.shapeId);
      if (!shape) continue;
      const R = L.trayRects[i];
      let cx = R.x + R.w / 2 + shakeX;
      const cy = R.cy;
      let scale = 1;
      let rot = 0;
      let alpha = 1;
      const rk = (T - this._refillStart[i]) / (TIMING.REFILL - 2 * TIMING.REFILL_STAGGER);
      if (rk < 0 && this._refillStart[i] > NEVER) continue;
      if (rk >= 0 && rk < 1) {
        scale = 0.25 + 0.75 * backOut(rk);
        alpha = clamp01(rk * 3);
      }
      const sk = (T - this._shuffleStart[i]) / (TIMING.SHUFFLE - 2 * TIMING.SHUFFLE_STAGGER);
      if (sk < 0 && this._shuffleStart[i] > NEVER) continue;
      if (sk >= 0 && sk < 1) {
        scale *= backOut(sk);
        rot = -(1 - easeOutCubic(sk)) * Math.PI * 1.5;
      }
      let grey = greyAll;
      if (!grey && this._dimming && playing && !this._placeable[i]) {
        grey = true;
        alpha *= 0.7;
      }
      if (shakeX !== 0) cx = Math.round(cx * dpr) / dpr;
      this._drawPiece(ctx, sp, shape, piece.color, cx, cy, tc * scale, rot, alpha, grey, true, dpr, ox, oy);
    }
  }

  _drawReturning(ctx, sp) {
    const tray = this.session.tray;
    for (let i = 0; i < SLOTS; i++) {
      if (!this._retActive[i] || !tray[i]) continue;
      const shape = getShape(tray[i].shapeId);
      const p = this._returnPos(i, this._tmp);
      const cs = this.layout.cell * p.s;
      const img = sp.block[tray[i].color];
      const cells = shape.cells;
      for (let k = 0; k < cells.length; k++) ctx.drawImage(img, p.x + cells[k][1] * cs, p.y + cells[k][0] * cs, cs, cs);
    }
  }

  _drawFloating(ctx, sp, T, cell) {
    const D = this._drag;
    const k = easeOutCubic(clamp01((T - D.pickupStart) / TIMING.PICKUP));
    const s = D.fromScale + (1 - D.fromScale) * k;
    const x = D.fromX + (D.x - D.fromX) * k;
    const y = D.fromY + (D.y - D.fromY) * k;
    const cs = cell * s;
    const cells = D.shape.cells;
    // soft shadow below the lifted piece
    const pad = cs * sp.shadowPad;
    const sw = cs + 2 * pad;
    const offX = cell * 0.06 * k;
    const offY = cell * 0.2 * k;
    ctx.globalAlpha = 0.32 * k;
    for (let i = 0; i < cells.length; i++) {
      ctx.drawImage(sp.shadow, x + cells[i][1] * cs - pad + offX, y + cells[i][0] * cs - pad + offY, sw, sw);
    }
    ctx.globalAlpha = 1;
    const img = sp.block[D.color];
    for (let i = 0; i < cells.length; i++) ctx.drawImage(img, x + cells[i][1] * cs, y + cells[i][0] * cs, cs, cs);
  }

  _drawTarget(ctx, sp, T, cell, bx, by) {
    const tg = this._target;
    const pulse = 0.5 + 0.5 * Math.sin(T * 0.014);
    const L = this.layout;
    // 3x3 target, clipped to the board
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, L.boardPx, L.boardPx);
    ctx.clip();
    ctx.globalAlpha = 0.75 + 0.25 * pulse;
    const m = sp.targetPad;
    ctx.drawImage(sp.target, bx + (tg.c - 1) * cell - m, by + (tg.r - 1) * cell - m, cell * 3 + 2 * m, cell * 3 + 2 * m);
    ctx.restore();
    ctx.globalAlpha = 1;
    const hs = cell * 1.3;
    const bob = Math.sin(T * 0.012) * cell * 0.08;
    ctx.drawImage(sp.hammer, bx + (tg.c + 0.5) * cell - hs / 2, by + (tg.r - 0.95) * cell - hs / 2 + bob, hs, hs);
  }

  _drawHint(ctx, sp, T, cell, bx, by) {
    const H = this._hint;
    const piece = this.session.tray[H.trayIndex];
    if (!piece || this._drag.active) return;
    const shape = getShape(piece.shapeId);
    const L = this.layout;
    // pulsing target ghost
    const pulse = 0.5 + 0.5 * Math.sin(T * 0.009);
    const img = sp.block[piece.color];
    const cells = shape.cells;
    ctx.globalAlpha = 0.58 + 0.22 * pulse;
    for (let k = 0; k < cells.length; k++) ctx.drawImage(img, bx + (H.c + cells[k][1]) * cell, by + (H.r + cells[k][0]) * cell, cell, cell);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 * pulse * (this.theme.fxGlow ?? 1);
    for (let k = 0; k < cells.length; k++) ctx.drawImage(sp.flash, bx + (H.c + cells[k][1]) * cell, by + (H.r + cells[k][0]) * cell, cell, cell);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const t = (T - H.start) % TIMING.HINT_CYCLE;
    const R = L.trayRects[H.trayIndex];
    const sx = R.x + R.w / 2;
    const sy = R.cy;
    const ex = bx + (H.c + shape.w / 2) * cell;
    const ey = by + (H.r + shape.h / 2) * cell;
    let k;
    let alpha;
    let press = 0;
    if (t < 280) {
      k = 0;
      alpha = t / 280;
      press = t / 280;
    } else if (t < 1180) {
      k = easeInOut((t - 280) / 900);
      alpha = 1;
      press = 1;
    } else if (t < 1580) {
      k = 1;
      alpha = 1;
      press = 1 - (t - 1180) / 400;
    } else if (t < 1880) {
      k = 1;
      alpha = 1 - (t - 1580) / 300;
    } else return;
    const px = sx + (ex - sx) * k;
    const py = sy + (ey - sy) * k;
    // carried ghost piece
    if (press > 0 && t >= 120) {
      const scale = L.trayCell / cell + (1 - L.trayCell / cell) * k;
      const cs = cell * scale;
      const hw = (shape.w * cs) / 2;
      const hh = (shape.h * cs) / 2;
      ctx.globalAlpha = 0.85 * alpha * Math.min(1, press * 1.5);
      for (let q = 0; q < cells.length; q++) ctx.drawImage(img, px - hw + cells[q][1] * cs, py - hh + cells[q][0] * cs, cs, cs);
    }
    // glow ring at the fingertip
    const ringR = cell * (0.55 + 0.25 * Math.sin(T * 0.012));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * alpha;
    ctx.drawImage(sp.ring, px - ringR, py - ringR, ringR * 2, ringR * 2);
    ctx.globalCompositeOperation = 'source-over';
    // hand (fingertip hotspot at 0.34, 0.04 of the sprite)
    const hs = sp.handSize * (1 - 0.08 * press);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.hand, px - hs * 0.34 + cell * 0.1, py - hs * 0.04 + cell * 0.12, hs, hs);
    ctx.globalAlpha = 1;
  }

  _drawTexts(ctx, T, dpr, ox, oy) {
    for (let i = 0; i < MAX_TEXTS; i++) {
      const s = this._texts[i];
      if (!s.active || !s.img) continue;
      const k = clamp01((T - s.start) / s.dur);
      let scale = 1;
      let alpha = 1;
      let y = s.y;
      switch (s.kind) {
        case TK_POINTS:
        case TK_INFO:
          scale = k < 0.2 ? 0.5 + 0.5 * backOut(k / 0.2) : 1;
          y -= s.rise * easeOutCubic(k);
          alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
          break;
        case TK_PRAISE:
        case TK_COMBO: {
          const d = s.kind === TK_COMBO ? 0.08 : 0;
          const kk = clamp01((k - d) / (1 - d));
          if (k < d) continue;
          scale = kk < 0.32 ? elasticOut(kk / 0.32) : 1;
          alpha = kk > 0.8 ? 1 - (kk - 0.8) / 0.2 : 1;
          if (kk > 0.8) y -= s.rise * ((kk - 0.8) / 0.2);
          break;
        }
        case TK_NOSPACE:
          scale = k < 0.18 ? backOut(k / 0.18) : 1;
          alpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
          break;
        case TK_BANNER:
          y -= (1 - backOut(clamp01(k / 0.22))) * this.layout.cell * 0.9;
          alpha = k < 0.12 ? k / 0.12 : k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
          break;
        default:
          break;
      }
      if (scale <= 0.01 || alpha <= 0) continue;
      const w = s.w * scale;
      const h = s.h * scale;
      ctx.globalAlpha = alpha;
      let x0 = s.x - w / 2;
      let y0 = y - h / 2;
      if (scale === 1) {
        x0 = Math.round((x0 + ox) * dpr) / dpr - ox;
        y0 = Math.round((y0 + oy) * dpr) / dpr - oy;
      }
      ctx.drawImage(s.img, x0, y0, w, h);
    }
    ctx.globalAlpha = 1;
  }
}
