// Adaptive piece generation (see docs/ARCHITECTURE.md §4.5) – the key to "one more game".
//
// Every tray is chosen among CONFIG.GENERATOR.CANDIDATES random candidate trays (family weights
// depend on the difficulty). Candidates are evaluated with `analyzeTray`, a node-limited
// depth-first search over piece orders and positions that applies line clears between
// placements. The choice depends on the phase:
//   - early (start of a classic run, longer for new players): the solvable candidate that allows
//     the most line clears → quick, satisfying first clears; never a dead end. With probability
//     EARLY_MULTI_P candidates offering a multi-line clear right away (one piece on the current
//     board clears >= 2 lines) come first, so "wow" moments come early
//   - mercy (crowded board, no clear for a while, right after a revive): a random solvable
//     candidate that allows a clear (journey/daily: preferably one that collects gems)
//   - otherwise: a random solvable candidate, or – with probability RAW_P_MAX × difficulty
//     (classic; journey/daily: RAW_P_MAX_LEVELS × difficulty) – the first sample unfiltered, so
//     that runs eventually end
// The generator never looks at the best score and never picks a tray because it is unsolvable.
// Everything is deterministic: the search is bounded by a node budget (never by time) and the rng
// is consumed in a fixed order.
//
// The search runs on 64-bit bitboards split into two int32 halves (rows 0–3 → `lo`, rows 4–7 →
// `hi`, bit index (r % 4) * 8 + c), so a placement test is two ANDs and the search allocates
// nothing per node.

import { CONFIG } from '../config.js';
import { SHAPES, getShape, shapeWeight } from './shapes.js';

/**
 * @typedef {import('./shapes.js').Shape} Shape
 * @typedef {import('./board.js').Board} Board
 * @typedef {import('./rng.js').RNG} RNG
 * @typedef {import('./levels.js').LevelDef} LevelDef
 * @typedef {Readonly<{ uid: number, shapeId: string, color: number }>} Piece
 * @typedef {'classic'|'journey'|'daily'|'tutorial'} Mode
 * @typedef {Object} TrayContext
 * @property {number} [score]
 * @property {number} [trayIndex]       index of the tray being dealt (0 = first)
 * @property {number} [traysSinceClear] completed trays in a row without any clear
 * @property {number} [combo]
 * @property {number} [fill]            board fill ratio 0..1
 * @property {number} [experience]      finished games of the player
 * @property {number} [mercyTrays]      remaining mercy trays (after a revive)
 * @property {LevelDef} [level]         journey/daily level (its difficulty is used)
 * @property {Object} [goals]           goal progress
 * @typedef {Object} TrayAnalysis
 * @property {boolean} solvable  all pieces can be placed in some order
 * @property {number} maxLines   most lines cleared in total by one (possibly partial) sequence
 * @property {number} maxSingle  most lines cleared by a single placement
 * @property {number} firstSingle extra: most lines one piece clears right now, on the current board
 *                               (what the player can see; exact, not limited by the node budget)
 * @property {number} maxGems    extra: most gems collected by one sequence
 * @property {boolean} complete  extra: false if the node limit stopped the search early
 *                               (`solvable === false` then means "no solution found")
 */

const PALETTE_SIZE = 8;
const MAX_BITBOARD_SIZE = 8;
/** Smallest shapes first: used when nothing else fits or is solvable. */
const BY_SIZE = SHAPES.slice().sort((a, b) => a.size - b.size);
/** Shapes for revive trays (small/medium) and rescue trays (small). */
const SMALL_SHAPES = SHAPES.filter((s) => s.tier <= 2);
const TINY_SHAPES = SHAPES.filter((s) => s.tier === 1);
/** Rescue attempts with tiny shapes before falling back to the smallest shapes that fit. */
const RESCUE_TRIES = 12;

// ---------------------------------------------------------------------------------------------
// Bitboard search engine
// ---------------------------------------------------------------------------------------------

/**
 * Precomputed masks for one board size.
 * @typedef {Object} Engine
 * @property {number} size
 * @property {Int32Array} rowLo
 * @property {Int32Array} rowHi
 * @property {Int32Array} colLo
 * @property {Int32Array} colHi
 * @property {Map<string, Int32Array>} placements shape id → flat [lo, hi, r, c, …] of in-bounds positions
 */

/** @type {Map<number, Engine>} */
const ENGINES = new Map();

/**
 * Sets bit (r, c) in a [lo, hi] pair.
 * @param {number[]} out
 * @param {number} r
 * @param {number} c
 */
function setBit(out, r, c) {
  const idx = r * 8 + c;
  if (idx < 32) out[0] |= 1 << idx;
  else out[1] |= 1 << (idx - 32);
}

/**
 * @param {number} size
 * @returns {Engine}
 */
function engineFor(size) {
  let engine = ENGINES.get(size);
  if (engine) return engine;
  if (size > MAX_BITBOARD_SIZE) throw new Error(`analyzeTray supports boards up to ${MAX_BITBOARD_SIZE}x${MAX_BITBOARD_SIZE}`);
  const rowLo = new Int32Array(size);
  const rowHi = new Int32Array(size);
  const colLo = new Int32Array(size);
  const colHi = new Int32Array(size);
  const tmp = [0, 0];
  for (let r = 0; r < size; r++) {
    tmp[0] = 0; tmp[1] = 0;
    for (let c = 0; c < size; c++) setBit(tmp, r, c);
    rowLo[r] = tmp[0]; rowHi[r] = tmp[1];
  }
  for (let c = 0; c < size; c++) {
    tmp[0] = 0; tmp[1] = 0;
    for (let r = 0; r < size; r++) setBit(tmp, r, c);
    colLo[c] = tmp[0]; colHi[c] = tmp[1];
  }
  engine = { size, rowLo, rowHi, colLo, colHi, placements: new Map() };
  ENGINES.set(size, engine);
  return engine;
}

/**
 * @param {Engine} engine
 * @param {Shape} shape
 * @returns {Int32Array} flat [lo, hi, r, c, …] for every in-bounds top-left position
 */
function placementsFor(engine, shape) {
  let list = engine.placements.get(shape.id);
  if (list) return list;
  const n = engine.size;
  const out = [];
  const m = [0, 0];
  for (let r = 0; r + shape.h <= n; r++) {
    for (let c = 0; c + shape.w <= n; c++) {
      m[0] = 0; m[1] = 0;
      for (const [dr, dc] of shape.cells) setBit(m, r + dr, c + dc);
      out.push(m[0], m[1], r, c);
    }
  }
  list = Int32Array.from(out);
  engine.placements.set(shape.id, list);
  return list;
}

/** @param {number} x int32 @returns {number} number of set bits */
function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/**
 * Reusable depth-first tray search. Holds its working state in fields so that the recursion
 * allocates nothing. Not re-entrant (JS is single threaded and the search never calls out).
 */
class TraySearch {
  constructor() {
    /** @type {Engine} */
    this.engine = engineFor(MAX_BITBOARD_SIZE);
    /** @type {Int32Array[]} placements per (sorted) piece */
    this.pl = [];
    this.h = new Int32Array(3);
    this.w = new Int32Array(3);
    /** index of an identical earlier piece, or -1 */
    this.dup = new Int32Array(3);
    this.count = 0;
    this.nodes = 0;
    this.nodeLimit = 0;
    this.aborted = false;
    this.solvable = false;
    this.maxLines = 0;
    this.maxSingle = 0;
    this.maxGems = 0;
    this.targetLines = 0;
    this.targetSingle = 0;
    this.targetGems = 0;
  }

  /**
   * Most lines a single piece clears when placed on the board as it is (depth 0 only).
   * @param {number} lo
   * @param {number} hi
   * @returns {number}
   */
  firstSingle(lo, hi) {
    const { rowLo, rowHi, colLo, colHi } = this.engine;
    let best = 0;
    for (let k = 0; k < this.count; k++) {
      const pl = this.pl[k];
      const h = this.h[k];
      const w = this.w[k];
      for (let p = 0; p < pl.length; p += 4) {
        if ((lo & pl[p]) !== 0 || (hi & pl[p + 1]) !== 0) continue;
        const nlo = lo | pl[p];
        const nhi = hi | pl[p + 1];
        const r = pl[p + 2];
        const c = pl[p + 3];
        let cnt = 0;
        for (let rr = r; rr < r + h; rr++) if ((nlo & rowLo[rr]) === rowLo[rr] && (nhi & rowHi[rr]) === rowHi[rr]) cnt++;
        for (let cc = c; cc < c + w; cc++) if ((nlo & colLo[cc]) === colLo[cc] && (nhi & colHi[cc]) === colHi[cc]) cnt++;
        if (cnt > best) best = cnt;
      }
    }
    return best;
  }

  /** @returns {boolean} true when every requested target is reached (search can stop) */
  satisfied() {
    return this.solvable && this.maxLines >= this.targetLines && this.maxSingle >= this.targetSingle
      && this.maxGems >= this.targetGems;
  }

  /**
   * @param {number} lo board bits rows 0–3
   * @param {number} hi board bits rows 4–7
   * @param {number} glo gem bits rows 0–3
   * @param {number} ghi gem bits rows 4–7
   * @param {number} used bit mask of placed pieces
   * @param {number} depth pieces placed so far
   * @param {number} prev index of the previous piece if its placement cleared nothing, else -1
   * @param {number} lines lines cleared so far
   * @param {number} gems gems collected so far
   * @returns {boolean} true = stop the whole search
   */
  dfs(lo, hi, glo, ghi, used, depth, prev, lines, gems) {
    const { rowLo, rowHi, colLo, colHi } = this.engine;
    const last = depth + 1 === this.count;
    for (let k = 0; k < this.count; k++) {
      if (used & (1 << k)) continue;
      // Identical shapes are interchangeable: always use the earlier one first.
      const d = this.dup[k];
      if (d >= 0 && (used & (1 << d)) === 0) continue;
      const pl = this.pl[k];
      const h = this.h[k];
      const w = this.w[k];
      for (let p = 0; p < pl.length; p += 4) {
        const ml = pl[p];
        const mh = pl[p + 1];
        if ((lo & ml) !== 0 || (hi & mh) !== 0) continue;
        if (++this.nodes > this.nodeLimit) {
          this.aborted = true;
          return true;
        }
        let nlo = lo | ml;
        let nhi = hi | mh;
        const r = pl[p + 2];
        const c = pl[p + 3];
        let clo = 0;
        let chi = 0;
        let cnt = 0;
        for (let rr = r; rr < r + h; rr++) {
          const a = rowLo[rr];
          const b = rowHi[rr];
          if ((nlo & a) === a && (nhi & b) === b) { clo |= a; chi |= b; cnt++; }
        }
        for (let cc = c; cc < c + w; cc++) {
          const a = colLo[cc];
          const b = colHi[cc];
          if ((nlo & a) === a && (nhi & b) === b) { clo |= a; chi |= b; cnt++; }
        }
        // Consecutive placements that clear nothing commute (same resulting board), so only
        // the ascending piece order is explored for them.
        if (cnt === 0 && k < prev) continue;
        let nglo = glo;
        let nghi = ghi;
        let ng = gems;
        if (cnt > 0) {
          nlo &= ~clo;
          nhi &= ~chi;
          ng += popcount(glo & clo) + popcount(ghi & chi);
          nglo &= ~clo;
          nghi &= ~chi;
          if (cnt > this.maxSingle) this.maxSingle = cnt;
        }
        const nl = lines + cnt;
        if (nl > this.maxLines) this.maxLines = nl;
        if (ng > this.maxGems) this.maxGems = ng;
        if (last) {
          this.solvable = true;
          if (this.satisfied()) return true;
        } else if ((cnt > 0 && this.satisfied())
          || this.dfs(nlo, nhi, nglo, nghi, used | (1 << k), depth + 1, cnt > 0 ? -1 : k, nl, ng)) {
          return true;
        }
      }
    }
    return false;
  }
}

const SEARCH = new TraySearch();
/** scratch [lo, hi] pairs for board → bitboard conversion */
const BOARD_BITS = [0, 0];
const GEM_BITS = [0, 0];

/**
 * Depth-first search (bounded by `nodeLimit` placements, never by time) over piece orders and
 * positions, applying line clears between placements.
 *
 * @param {Board} board current board (up to 8x8); not modified
 * @param {Array<Shape|string>} shapes 1–3 shapes (or shape ids) to place
 * @param {Object} [opts]
 * @param {number} [opts.nodeLimit=CONFIG.GENERATOR.NODE_LIMIT] max placements examined; if the
 *   limit hits before a full sequence was found the result is conservative (`solvable` false)
 * @param {number} [opts.targetLines=Infinity] extra: stop once solvable and this many lines found
 * @param {number} [opts.targetSingle=0] extra: … and a single placement clearing this many lines
 * @param {number} [opts.targetGems=0] extra: … and this many collectable gems
 * @returns {TrayAnalysis}
 */
export function analyzeTray(board, shapes, opts = {}) {
  const {
    nodeLimit = CONFIG.GENERATOR.NODE_LIMIT,
    targetLines = Infinity,
    targetSingle = 0,
    targetGems = 0,
  } = opts;
  const list = [];
  for (const s of shapes) {
    const shape = typeof s === 'string' ? getShape(s) : s;
    if (!shape) throw new Error(`analyzeTray: unknown shape ${s}`);
    list.push(shape);
  }
  if (list.length === 0 || list.length > 3) throw new Error('analyzeTray: expects 1–3 shapes');
  // Biggest pieces first: on crowded boards the most constrained piece prunes the tree fastest.
  list.sort((a, b) => b.size - a.size);

  const s = SEARCH;
  s.engine = engineFor(board.size);
  s.count = list.length;
  for (let k = 0; k < list.length; k++) {
    s.pl[k] = placementsFor(s.engine, list[k]);
    s.h[k] = list[k].h;
    s.w[k] = list[k].w;
    s.dup[k] = -1;
    for (let j = k - 1; j >= 0; j--) {
      if (list[j].id === list[k].id) { s.dup[k] = j; break; }
    }
  }
  s.nodes = 0;
  s.nodeLimit = nodeLimit;
  s.aborted = false;
  s.solvable = false;
  s.maxGems = 0;
  s.targetLines = targetLines;
  s.targetSingle = targetSingle;
  s.targetGems = targetGems;

  boardBits(board, BOARD_BITS, GEM_BITS);
  // A single placement is a (partial) sequence too, so it seeds the line counts.
  const firstSingle = s.firstSingle(BOARD_BITS[0], BOARD_BITS[1]);
  s.maxLines = firstSingle;
  s.maxSingle = firstSingle;
  s.dfs(BOARD_BITS[0], BOARD_BITS[1], GEM_BITS[0], GEM_BITS[1], 0, 0, -1, 0, 0);
  return {
    solvable: s.solvable,
    maxLines: s.maxLines,
    maxSingle: s.maxSingle,
    firstSingle,
    maxGems: s.maxGems,
    complete: !s.aborted,
  };
}

/**
 * @param {Board} board
 * @param {number[]} cellsOut [lo, hi] of filled cells
 * @param {number[]} gemsOut [lo, hi] of gem cells
 */
function boardBits(board, cellsOut, gemsOut) {
  cellsOut[0] = 0; cellsOut[1] = 0;
  gemsOut[0] = 0; gemsOut[1] = 0;
  const n = board.size;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (board.cells[i] !== 0) {
        setBit(cellsOut, r, c);
        if (board.gems[i] !== 0) setBit(gemsOut, r, c);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Generation policy
// ---------------------------------------------------------------------------------------------

/** @param {number} x */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * A candidate tray: shapes + colors (sampled together, in a fixed rng order).
 * @typedef {{ shapes: Shape[], colors: number[] }} Candidate
 */

export class PieceGenerator {
  /**
   * @param {Object} opts
   * @param {RNG} opts.rng shared, saveable random source
   * @param {Mode} [opts.mode]
   * @param {typeof CONFIG.GENERATOR} [opts.config] extra: generator constants (defaults to
   *   CONFIG.GENERATOR; tools/simulate.mjs uses it to evaluate tuning proposals)
   */
  constructor({ rng, mode = 'classic', config = CONFIG.GENERATOR }) {
    if (!rng) throw new Error('PieceGenerator: rng is required');
    /** @type {RNG} */
    this.rng = rng;
    /** @type {Mode} */
    this.mode = mode;
    this.config = config;
    /** next piece uid */
    this.uid = 1;
    /** difficulty of the last dealt tray (revive/shuffle trays use the same shape mix) */
    this.lastDifficulty = config.D_MIN;
  }

  /**
   * Difficulty 0..1: the level's difficulty (journey/daily) or the classic ramp by tray index.
   * @param {TrayContext} ctx
   * @returns {number}
   */
  difficultyFor(ctx) {
    const { D_MIN, D_MAX, RAMP_TRAYS } = this.config;
    if (this.mode === 'journey' || this.mode === 'daily') return clamp01(ctx.level ? ctx.level.difficulty : D_MIN);
    return Math.min(D_MAX, Math.max(D_MIN, D_MIN + (ctx.trayIndex || 0) / RAMP_TRAYS));
  }

  /**
   * Early phase only exists in classic runs (journey/daily difficulty comes from the level).
   * @param {TrayContext} ctx
   * @returns {'early'|'mercy'|'normal'}
   */
  phaseFor(ctx) {
    const cfg = this.config;
    const earlyTrays = (ctx.experience || 0) < cfg.NEWBIE_GAMES ? cfg.NEWBIE_EARLY_TRAYS : cfg.EARLY_TRAYS;
    if (this.mode === 'classic' && (ctx.trayIndex || 0) < earlyTrays) return 'early';
    if ((ctx.fill || 0) > cfg.MERCY_FILL || (ctx.traysSinceClear || 0) >= cfg.MERCY_TRAYS_NO_CLEAR
      || (ctx.mercyTrays || 0) > 0) return 'mercy';
    return 'normal';
  }

  /**
   * Deals the next tray of 3 pieces (§4.5).
   * @param {Board} board
   * @param {TrayContext} [ctx]
   * @returns {Piece[]}
   */
  nextTray(board, ctx = {}) {
    const cfg = this.config;
    const d = this.difficultyFor(ctx);
    this.lastDifficulty = d;
    const phase = this.phaseFor(ctx);
    const weightOf = (s) => shapeWeight(s, d, cfg.FAMILY_WEIGHTS);

    // Fixed rng order: all candidates (shapes + colors) first, then the decision rolls.
    const candidates = [];
    for (let i = 0; i < cfg.CANDIDATES; i++) candidates.push(this.sampleCandidate(3, SHAPES, weightOf));
    const rawRoll = this.rng.next();
    const pickRoll = this.rng.next();
    const gemRoll = this.rng.next();
    const multiRoll = this.rng.next();

    const fitting = candidates.filter((cand) => cand.shapes.some((s) => board.anyPlacement(s)));
    if (fitting.length === 0) return this.toPieces(smallestFitting(board, 3), candidates[0].colors);

    let chosen;
    if (phase === 'early') {
      const minFirst = multiRoll < cfg.EARLY_MULTI_P ? 2 : 0;
      chosen = this.bestForLines(board, fitting, minFirst) || this.rescue(board, 3) || fitting[0];
    } else if (phase === 'mercy') {
      const wantGems = this.mode !== 'classic' && hasGems(board) && gemRoll < 1 - d;
      const opts = { nodeLimit: cfg.NODE_LIMIT, targetLines: 1, targetGems: wantGems ? 1 : 0 };
      const solvable = [];
      const clearing = [];
      const gemClearing = [];
      for (const cand of fitting) {
        const a = analyzeTray(board, cand.shapes, opts);
        if (!a.solvable) continue;
        solvable.push(cand);
        if (a.maxLines < 1) continue;
        clearing.push(cand);
        if (wantGems && a.maxGems >= 1) gemClearing.push(cand);
      }
      chosen = pickFirstNonEmpty(pickRoll, gemClearing, clearing, solvable, fitting);
    } else if (rawRoll < (this.mode === 'classic' ? cfg.RAW_P_MAX : cfg.RAW_P_MAX_LEVELS) * d) {
      chosen = fitting[0];
    } else {
      const opts = { nodeLimit: cfg.NODE_LIMIT, targetLines: 0 };
      const solvable = fitting.filter((cand) => analyzeTray(board, cand.shapes, opts).solvable);
      chosen = pickFirstNonEmpty(pickRoll, solvable, fitting);
    }
    return this.toPieces(chosen.shapes, chosen.colors);
  }

  /**
   * 3 small/medium pieces that can be placed together (after a revive), preferring clears.
   * @param {Board} board
   * @returns {Piece[]}
   */
  reviveTray(board) {
    return this.helpfulTray(board, 3, SMALL_SHAPES);
  }

  /**
   * `count` (1..3) fresh pieces, solvable together if at all possible (shuffle booster).
   * @param {Board} board
   * @param {number} count
   * @returns {Piece[]}
   */
  shuffleTray(board, count) {
    return this.helpfulTray(board, Math.max(1, Math.min(3, count | 0)), SHAPES);
  }

  /**
   * The candidate (sampled from `pool`) that is solvable and allows the most clears; falls back
   * to rescue trays and finally to the smallest shapes that fit.
   * @param {Board} board
   * @param {number} count
   * @param {ReadonlyArray<Shape>} pool
   * @returns {Piece[]}
   */
  helpfulTray(board, count, pool) {
    const d = this.lastDifficulty;
    const candidates = [];
    for (let i = 0; i < this.config.CANDIDATES; i++) {
      candidates.push(this.sampleCandidate(count, pool, (s) => shapeWeight(s, d, this.config.FAMILY_WEIGHTS)));
    }
    const chosen = this.bestForLines(board, candidates) || this.rescue(board, count);
    return chosen
      ? this.toPieces(chosen.shapes, chosen.colors)
      : this.toPieces(smallestFitting(board, count), candidates[0].colors);
  }

  /**
   * The solvable candidate with the highest min(maxLines, 3), ties by maxSingle, then by sample
   * order. With `minFirst` >= 2, candidates where one piece clears at least that many lines right
   * away (visible to the player) are preferred; the plain rule applies if there is none.
   * @param {Board} board
   * @param {Candidate[]} candidates
   * @param {number} [minFirst=0]
   * @returns {Candidate | null}
   */
  bestForLines(board, candidates, minFirst = 0) {
    const opts = { nodeLimit: this.config.NODE_LIMIT, targetLines: 3, targetSingle: 3 };
    let best = null;
    let bestKey = -1;
    for (const cand of candidates) {
      const a = analyzeTray(board, cand.shapes, opts);
      if (!a.solvable) continue;
      const key = (a.firstSingle >= minFirst ? 100 : 0) + Math.min(a.maxLines, 3) * 10 + a.maxSingle;
      if (key > bestKey) {
        best = cand;
        bestKey = key;
      }
    }
    return best;
  }

  /**
   * Tiny-piece trays for a crowded board when no regular candidate is solvable.
   * @param {Board} board
   * @param {number} count
   * @returns {Candidate | null} a solvable candidate, or null
   */
  rescue(board, count) {
    const opts = { nodeLimit: this.config.NODE_LIMIT, targetLines: 0 };
    for (let i = 0; i < RESCUE_TRIES; i++) {
      const cand = this.sampleCandidate(count, TINY_SHAPES, () => 1);
      if (analyzeTray(board, cand.shapes, opts).solvable) return cand;
    }
    return null;
  }

  /**
   * Random shapes (weighted) with random colors; never three identical shapes or colors.
   * @param {number} count
   * @param {ReadonlyArray<Shape>} pool
   * @param {(s: Shape) => number} weightOf
   * @returns {Candidate}
   */
  sampleCandidate(count, pool, weightOf) {
    const shapes = [];
    const weight = (s) => (shapes.length === 2 && s === shapes[0] && s === shapes[1] ? 0 : weightOf(s));
    for (let i = 0; i < count; i++) shapes.push(this.rng.weighted(pool, weight));
    const colors = [];
    for (let i = 0; i < count; i++) {
      let color = this.rng.int(PALETTE_SIZE);
      if (i === 2 && color === colors[0] && color === colors[1]) color = (color + 1) % PALETTE_SIZE;
      colors.push(color);
    }
    return { shapes, colors };
  }

  /**
   * A single frozen piece with a fresh uid (also used for scripted trays, e.g. the tutorial).
   * @param {string} shapeId
   * @param {number} color palette color index 0..7
   * @returns {Piece}
   */
  createPiece(shapeId, color) {
    return Object.freeze({ uid: this.uid++, shapeId, color });
  }

  /**
   * @param {Shape[]} shapes
   * @param {number[]} colors one per shape
   * @returns {Piece[]}
   */
  toPieces(shapes, colors) {
    return shapes.map((shape, i) => this.createPiece(shape.id, colors[i]));
  }

  /** @returns {{ mode: Mode, uid: number, lastDifficulty: number }} state (rng saved separately) */
  toJSON() {
    return { mode: this.mode, uid: this.uid, lastDifficulty: this.lastDifficulty };
  }

  /**
   * @param {{ mode: Mode, uid: number, lastDifficulty?: number }} obj
   * @param {RNG} rng the restored session rng
   * @returns {PieceGenerator}
   * @throws {Error} on invalid data
   */
  static fromJSON(obj, rng) {
    if (!obj || !Number.isInteger(obj.uid) || obj.uid < 1) throw new Error('PieceGenerator.fromJSON: invalid data');
    const gen = new PieceGenerator({ rng, mode: obj.mode });
    gen.uid = obj.uid;
    if (typeof obj.lastDifficulty === 'number') gen.lastDifficulty = clamp01(obj.lastDifficulty);
    return gen;
  }
}

/**
 * A random element of the first non-empty list.
 * @template T
 * @param {number} roll uniform 0..1
 * @param {...T[]} lists
 * @returns {T}
 */
function pickFirstNonEmpty(roll, ...lists) {
  for (const list of lists) {
    if (list.length > 0) return list[Math.floor(roll * list.length)];
  }
  throw new Error('pickFirstNonEmpty: all lists are empty');
}

/**
 * The smallest shapes that fit on the board right now (no three identical ones unless only one
 * shape fits).
 * @param {Board} board
 * @param {number} count
 * @returns {Shape[]}
 */
function smallestFitting(board, count) {
  const fits = BY_SIZE.filter((s) => board.anyPlacement(s));
  if (fits.length === 0) fits.push(BY_SIZE[0]);
  const out = [];
  for (let i = 0; i < count; i++) out.push(fits[i === 2 && fits.length > 1 ? 1 : 0]);
  return out;
}

/** @param {Board} board @returns {boolean} */
function hasGems(board) {
  for (let i = 0; i < board.gems.length; i++) if (board.gems[i] !== 0) return true;
  return false;
}
