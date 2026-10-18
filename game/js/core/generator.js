// Adaptive piece generation (see docs/ARCHITECTURE.md §4.5) – the key to "one more game".
//
// Every tray is chosen from several random candidate trays. Each candidate is evaluated with
// `analyzeTray`, an exhaustive (node limited) depth-first search over piece orders and positions
// that applies line clears between placements. The policy then prefers candidates depending on
// the situation:
//   - early game: always solvable, strongly prefers trays that allow (multi-)line clears
//   - difficulty ramps with score: bigger shapes, fewer candidates, less help, and from mid game
//     on a growing chance that solvability is not enforced, so runs eventually end
//   - mercy: crowded board (> 55 %) or no clear for 2+ trays → prefer trays that enable a clear
//   - journey/daily: prefer trays that can clear lines containing gems when the player struggles
//
// The search runs on 64-bit bitboards split into two int32 halves (rows 0–3 → `lo`, rows 4–7 →
// `hi`, bit index (r % 4) * 8 + c), so a placement test is two ANDs and the search allocates
// nothing per node.

import { SHAPES, getShape } from './shapes.js';

/**
 * @typedef {import('./shapes.js').Shape} Shape
 * @typedef {import('./board.js').Board} Board
 * @typedef {import('./rng.js').RNG} RNG
 * @typedef {{ uid: number, shapeId: string, color: number }} Piece
 * @typedef {'classic'|'journey'|'daily'|'tutorial'} Mode
 * @typedef {{ score?: number, trayIndex?: number, traysSinceClear?: number, combo?: number,
 *   goals?: { gems?: Object, score?: Object } }} TrayContext
 * @typedef {Object} TrayAnalysis
 * @property {boolean} solvable  all pieces can be placed in some order
 * @property {number} maxLines   most lines cleared in total by one (possibly partial) sequence
 * @property {number} maxBurst   most lines cleared by a single placement
 * @property {number} firstBurst most lines cleared by a single placement on the current board
 * @property {number} maxGems    most gems collected by one sequence (0 without gems on the board)
 * @property {number} nodes      placements examined
 * @property {boolean} complete  false if the node limit stopped the search (values are lower bounds)
 */

const PALETTE_SIZE = 8;
const MAX_BITBOARD_SIZE = 8;

/** Trays at the start of a classic run that are always solvable and generous. */
export const EARLY_TRAYS = 8;
/** Board fill ratio above which the mercy rule kicks in. */
const MERCY_FILL = 0.55;
/** Trays in a row without any clear after which the mercy rule kicks in. */
const MERCY_TRAYS_WITHOUT_CLEAR = 2;
/** Default node limit for `analyzeTray`. */
const DEFAULT_NODE_LIMIT = 20000;
/** Node limit per candidate inside the generator (keeps nextTray well below 8 ms on phones). */
const CANDIDATE_NODE_LIMIT = 1500;
/** Balancing knobs (tuned with tools/simulate.mjs). */
const TUNING = Object.freeze({
  /** classic: score that adds +1 difficulty */
  classicScoreRamp: 25000,
  /** classic: trays that add +1 difficulty */
  classicTrayRamp: 100,
  /** journey/daily: trays that add +1 difficulty */
  levelTrayRamp: 150,
  /** journey/daily: trays at the start that are always solvable and generous */
  levelEarlyTrays: 3,
  /** candidate trays in the early game, and at full help later on */
  earlyCandidates: 16,
  maxCandidates: 10,
  /** utility per extra line of a multi-line clear: early game / scaled by help later */
  earlyBurstWeight: 30,
  burstWeight: 25,
  /** help at difficulty 0 and 1, and the mercy floor at difficulty 1 */
  helpStart: 0.9,
  helpEnd: 0.1,
  mercyHelpEnd: 0.3,
  /** probability that solvability is enforced at zero help */
  solvableAtNoHelp: 0.5,
  /** late-game pressure (classic): rises with the unclamped difficulty from `pressureFrom` to
   *  `pressureFull`, where `maxPressure` of the trays are the least helpful of a few candidates */
  pressureFrom: 0.6,
  pressureFull: 2.2,
  maxPressure: 0.9,
  pressureCandidates: 4,
  /** chance that a pressure tray must still be solvable: at the start / at full pressure */
  pressureSolvableStart: 0.7,
  pressureSolvableEnd: 0.25,
  /** board fill above which generous trays prefer small pieces, and the utility per cell·fill */
  crowdedFill: 0.3,
  crowdedSizePenalty: 10,
  /** journey/daily: utility per collectable gem (normal / when the player struggles) */
  gemWeight: 4,
  gemWeightStruggling: 12,
});

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
 * @param {Int32Array | number[]} out
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
    this.maxBurst = 0;
    this.firstBurst = 0;
    this.maxGems = 0;
    this.targetLines = 0;
    this.targetBurst = 0;
    this.targetGems = 0;
  }

  /** @returns {boolean} true when every requested target is reached (search can stop) */
  satisfied() {
    return this.solvable && this.maxLines >= this.targetLines && this.maxBurst >= this.targetBurst
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
          if (cnt > this.maxBurst) this.maxBurst = cnt;
          if (depth === 0 && cnt > this.firstBurst) this.firstBurst = cnt;
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
 * Exhaustive search (up to `nodeLimit` placements) over piece orders and positions, applying
 * line clears between placements.
 *
 * @param {Board} board current board (up to 8x8); not modified
 * @param {Array<Shape|string>} shapes 1–3 shapes (or shape ids) to place
 * @param {Object} [opts]
 * @param {number} [opts.nodeLimit=20000] max placements examined; the result is conservative
 *   (`solvable` false) if the limit hits before a full sequence was found
 * @param {number} [opts.targetLines=Infinity] stop early once solvable and this many lines found
 * @param {number} [opts.targetBurst=0] … and a single placement clearing this many lines found
 * @param {number} [opts.targetGems=0] … and this many gems collectable
 * @returns {TrayAnalysis}
 */
export function analyzeTray(board, shapes, opts = {}) {
  const {
    nodeLimit = DEFAULT_NODE_LIMIT,
    targetLines = Infinity,
    targetBurst = 0,
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
  s.maxLines = 0;
  s.maxBurst = 0;
  s.firstBurst = 0;
  s.maxGems = 0;
  s.targetLines = targetLines;
  s.targetBurst = targetBurst;
  s.targetGems = targetGems;

  boardBits(board, BOARD_BITS, GEM_BITS);
  s.dfs(BOARD_BITS[0], BOARD_BITS[1], GEM_BITS[0], GEM_BITS[1], 0, 0, -1, 0, 0);
  return {
    solvable: s.solvable,
    maxLines: s.maxLines,
    maxBurst: s.maxBurst,
    firstBurst: s.firstBurst,
    maxGems: s.maxGems,
    nodes: Math.min(s.nodes, nodeLimit),
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

/** Shapes used when nothing else is solvable (smallest pieces). */
const RESCUE_SHAPES = SHAPES.filter((s) => s.size <= 2);
const SMALL_TIER_MULT = Object.freeze([0, 1, 0.8, 0, 0]);
const RESCUE_TIER_MULT = Object.freeze([0, 1, 0, 0, 0]);
const HELP_TIER_MULT = Object.freeze([0, 1, 1.1, 0.5, 0.1]);

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} x */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** @param {number} a @param {number} b @param {number} x → 0..1 (smooth) */
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Tier multipliers for a difficulty in 0..1 (index = tier).
 * @param {number} d
 * @returns {number[]}
 */
function tierMultipliers(d) {
  return [0, lerp(0.6, 0.45, d), lerp(1.0, 1.0, d), lerp(1.05, 1.3, d), lerp(0.45, 0.8, d)];
}

/**
 * Selection policy for one tray.
 * @typedef {Object} Policy
 * @property {number} candidates   number of random candidate trays
 * @property {ArrayLike<number>} tierMult multipliers per tier (index 1..4)
 * @property {boolean} requireSolvable fall back to rescue trays if no candidate is solvable
 * @property {number} solvableWeight  utility of a solvable tray
 * @property {number} clearWeight     utility if at least one line can be cleared (< 0: avoid)
 * @property {number} lineWeight      utility per clearable line (max 4 counted)
 * @property {number} burstWeight     utility per extra line of the best single multi-line clear
 *   (counted again if that clear is possible right away, which every player notices)
 * @property {number} gemWeight       utility per collectable gem
 * @property {number} sizeWeight      utility per cell of the tray (< 0: prefer small pieces)
 * @property {boolean} singleHuge     at most one tier-4 shape per tray
 */

export class PieceGenerator {
  /**
   * @param {Object} opts
   * @param {RNG} opts.rng shared, saveable random source
   * @param {Mode} [opts.mode]
   * @param {number} [opts.difficulty] base difficulty 0..1 (journey/daily levels set this)
   */
  constructor({ rng, mode = 'classic', difficulty = 0 }) {
    if (!rng) throw new Error('PieceGenerator: rng is required');
    /** @type {RNG} */
    this.rng = rng;
    /** @type {Mode} */
    this.mode = mode;
    /** @type {number} */
    this.difficulty = clamp01(difficulty);
    /** @type {number} next piece uid */
    this.uid = 1;
  }

  /**
   * Unclamped difficulty for a tray context (values above 1 only raise the late-game pressure).
   * Classic ramps with score (skilled players get harder trays sooner) and with the number of
   * trays; levels start at their base difficulty and creep up the longer they take.
   * @param {TrayContext} ctx
   * @returns {number}
   */
  rawDifficulty(ctx) {
    const score = ctx.score || 0;
    const trayIndex = ctx.trayIndex || 0;
    if (this.mode === 'classic') {
      return this.difficulty + score / TUNING.classicScoreRamp + trayIndex / TUNING.classicTrayRamp;
    }
    return this.difficulty + trayIndex / TUNING.levelTrayRamp;
  }

  /**
   * Current difficulty 0..1 for a tray context.
   * @param {TrayContext} ctx
   * @returns {number}
   */
  difficultyFor(ctx) {
    return clamp01(this.rawDifficulty(ctx));
  }

  /**
   * Deals the next tray of 3 pieces.
   * @param {Board} board
   * @param {TrayContext} [ctx]
   * @returns {Piece[]}
   */
  nextTray(board, ctx = {}) {
    const policy = this.policyFor(board, ctx);
    const gemTarget = policy.gemWeight > 0 ? gemTotal(board) : 0;
    const shapes = this.chooseShapes(board, 3, policy, gemTarget);
    return this.toPieces(shapes);
  }

  /**
   * Builds the selection policy for the next tray.
   * @param {Board} board
   * @param {TrayContext} ctx
   * @returns {Policy}
   */
  policyFor(board, ctx) {
    const raw = this.rawDifficulty(ctx);
    const d = clamp01(raw);
    const fill = board.filledCount() / (board.size * board.size);
    const traysSinceClear = ctx.traysSinceClear || 0;
    const trayIndex = ctx.trayIndex || 0;
    const early = trayIndex < (this.mode === 'classic' ? EARLY_TRAYS : TUNING.levelEarlyTrays);
    const mercy = !early && (fill > MERCY_FILL || traysSinceClear >= MERCY_TRAYS_WITHOUT_CLEAR);
    const hasGemGoal = this.mode !== 'classic' && !!(ctx.goals && ctx.goals.gems);
    const struggling = mercy || traysSinceClear >= 1 || fill >= 0.45;
    const gemWeight = hasGemGoal ? (struggling ? TUNING.gemWeightStruggling : TUNING.gemWeight) : 0;
    const tierMult = tierMultipliers(d);

    // On a crowded board, generous trays also keep the pieces small (fewer dead ends).
    const crowding = Math.max(0, fill - TUNING.crowdedFill);
    if (early) {
      return {
        candidates: TUNING.earlyCandidates,
        tierMult,
        requireSolvable: true,
        solvableWeight: 100,
        clearWeight: 20,
        lineWeight: 6,
        burstWeight: TUNING.earlyBurstWeight,
        gemWeight,
        sizeWeight: -TUNING.crowdedSizePenalty * crowding,
        singleHuge: true,
      };
    }

    // Late game pressure (classic): more and more often the least helpful of a few trays is
    // dealt, so that even strong players eventually run out of space. Never under mercy.
    const pressure = this.mode === 'classic' && !mercy ? smoothstep(TUNING.pressureFrom, TUNING.pressureFull, raw) : 0;
    if (pressure > 0 && this.rng.chance(pressure * TUNING.maxPressure)) {
      const requireSolvable = this.rng.chance(lerp(TUNING.pressureSolvableStart, TUNING.pressureSolvableEnd, pressure));
      return {
        candidates: TUNING.pressureCandidates,
        tierMult,
        requireSolvable,
        solvableWeight: requireSolvable ? 100 : 0,
        clearWeight: -30,
        lineWeight: -6,
        burstWeight: 0,
        gemWeight: 0,
        sizeWeight: 0,
        singleHuge: false,
      };
    }

    // help: 1 = maximally generous … 0 = plain random tray
    let help = lerp(TUNING.helpStart, TUNING.helpEnd, d);
    if (mercy) help = Math.max(help, lerp(1, TUNING.mercyHelpEnd, d));
    const requireSolvable = this.rng.chance(lerp(TUNING.solvableAtNoHelp, 1, help));
    return {
      candidates: Math.max(1, Math.round(1 + help * (TUNING.maxCandidates - 1))),
      tierMult,
      requireSolvable,
      solvableWeight: requireSolvable ? 100 : 0,
      clearWeight: 20 * help,
      lineWeight: 6 * help,
      burstWeight: TUNING.burstWeight * help,
      gemWeight,
      sizeWeight: -TUNING.crowdedSizePenalty * crowding * help,
      singleHuge: mercy,
    };
  }

  /**
   * 3 small/medium pieces that can be placed together (after a revive).
   * @param {Board} board
   * @returns {Piece[]}
   */
  reviveTray(board) {
    const shapes = this.chooseShapes(board, 3, {
      candidates: 14,
      tierMult: SMALL_TIER_MULT,
      requireSolvable: true,
      solvableWeight: 100,
      clearWeight: 12,
      lineWeight: 4,
      burstWeight: 4,
      gemWeight: 0,
      sizeWeight: 0,
      singleHuge: true,
    }, 0);
    return this.toPieces(shapes);
  }

  /**
   * `count` (1..3) fresh pieces, solvable together if at all possible (shuffle booster).
   * @param {Board} board
   * @param {number} count
   * @returns {Piece[]}
   */
  shuffleTray(board, count) {
    const n = Math.max(1, Math.min(3, count | 0));
    const shapes = this.chooseShapes(board, n, {
      candidates: 12,
      tierMult: HELP_TIER_MULT,
      requireSolvable: true,
      solvableWeight: 100,
      clearWeight: 14,
      lineWeight: 4,
      burstWeight: 4,
      gemWeight: this.mode === 'classic' ? 0 : TUNING.gemWeight,
      sizeWeight: 0,
      singleHuge: true,
    }, gemTotal(board));
    return this.toPieces(shapes);
  }

  /**
   * Samples candidate trays and returns the shapes of the best one according to `policy`.
   * @param {Board} board
   * @param {number} count pieces per tray
   * @param {Policy} policy
   * @param {number} gemTarget gems on the board (early-exit target for the gem search)
   * @returns {Shape[]}
   */
  chooseShapes(board, count, policy, gemTarget) {
    const searchOpts = {
      nodeLimit: CANDIDATE_NODE_LIMIT,
      targetLines: policy.lineWeight > 0 ? 4 : policy.clearWeight !== 0 ? 1 : 0,
      targetBurst: policy.burstWeight > 0 ? 2 : 0,
      targetGems: policy.gemWeight > 0 ? gemTarget : 0,
    };
    let best = null;
    let bestUtility = -Infinity;
    let bestSolvable = false;
    for (let i = 0; i < policy.candidates; i++) {
      const shapes = this.sampleShapes(count, policy.tierMult, policy.singleHuge);
      const a = analyzeTray(board, shapes, searchOpts);
      const utility = this.utility(a, shapes, policy);
      if (utility > bestUtility) {
        best = shapes;
        bestUtility = utility;
        bestSolvable = a.solvable;
      }
    }
    if (policy.requireSolvable && !bestSolvable) {
      const rescue = this.rescueShapes(board, count);
      if (rescue) return rescue;
    }
    return best;
  }

  /**
   * @param {TrayAnalysis} a
   * @param {Shape[]} shapes
   * @param {Policy} policy
   * @returns {number}
   */
  utility(a, shapes, policy) {
    let cells = 0;
    for (const s of shapes) cells += s.size;
    return (a.solvable ? policy.solvableWeight : 0)
      + cells * policy.sizeWeight
      + (a.maxLines > 0 ? policy.clearWeight : 0)
      + Math.min(a.maxLines, 4) * policy.lineWeight
      + Math.max(0, a.maxBurst - 1) * policy.burstWeight
      + Math.max(0, a.firstBurst - 1) * policy.burstWeight
      + a.maxGems * policy.gemWeight
      + this.rng.next() * 6; // variety among similarly good trays
  }

  /**
   * Last resort when no sampled candidate is solvable: the smallest pieces (1–2 cells).
   * @param {Board} board
   * @param {number} count
   * @returns {Shape[] | null} a solvable tray, or null if even the smallest pieces do not fit
   */
  rescueShapes(board, count) {
    for (let i = 0; i < 12; i++) {
      const shapes = this.sampleShapes(count, RESCUE_TIER_MULT);
      if (analyzeTray(board, shapes, { nodeLimit: CANDIDATE_NODE_LIMIT, targetLines: 0 }).solvable) return shapes;
    }
    const dots = new Array(count).fill(RESCUE_SHAPES[0]);
    return analyzeTray(board, dots, { targetLines: 0 }).solvable ? dots : null;
  }

  /**
   * Random shapes weighted by base weight × tier multiplier; never three identical shapes.
   * @param {number} count
   * @param {ArrayLike<number>} tierMult
   * @param {boolean} [singleHuge] at most one tier-4 shape
   * @returns {Shape[]}
   */
  sampleShapes(count, tierMult, singleHuge = false) {
    const out = [];
    const weightOf = (s) => {
      if (s.tier === 4 && singleHuge && out.some((x) => x.tier === 4)) return 0;
      if (out.length === 2 && s === out[0] && s === out[1]) return 0;
      return s.weight * tierMult[s.tier];
    };
    for (let i = 0; i < count; i++) out.push(this.rng.weighted(SHAPES, weightOf));
    return out;
  }

  /**
   * A single piece with a fresh uid (scripted trays, e.g. the tutorial).
   * @param {string} shapeId
   * @param {number} color palette color index 0..7
   * @returns {Piece}
   */
  createPiece(shapeId, color) {
    return { uid: this.uid++, shapeId, color };
  }

  /**
   * Wraps shapes into tray pieces with fresh uids and pairwise different colors.
   * @param {Shape[]} shapes
   * @returns {Piece[]}
   */
  toPieces(shapes) {
    const colors = [];
    return shapes.map((shape) => {
      let color = this.rng.int(PALETTE_SIZE);
      while (colors.includes(color)) color = (color + 1) % PALETTE_SIZE;
      colors.push(color);
      return this.createPiece(shape.id, color);
    });
  }

  /** @returns {{ mode: Mode, difficulty: number, uid: number }} generator state (rng saved separately) */
  toJSON() {
    return { mode: this.mode, difficulty: this.difficulty, uid: this.uid };
  }

  /**
   * @param {{ mode: Mode, difficulty: number, uid: number }} obj
   * @param {RNG} rng the restored session rng
   * @returns {PieceGenerator}
   */
  static fromJSON(obj, rng) {
    const gen = new PieceGenerator({ rng, mode: obj.mode, difficulty: obj.difficulty });
    gen.uid = Number.isInteger(obj.uid) && obj.uid > 0 ? obj.uid : 1;
    return gen;
  }
}

/**
 * @param {Board} board
 * @returns {number} gems on the board
 */
function gemTotal(board) {
  let n = 0;
  for (let i = 0; i < board.gems.length; i++) if (board.gems[i] !== 0) n++;
  return n;
}
