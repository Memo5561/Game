// Journey and daily-challenge levels (see docs/ARCHITECTURE.md §4.6).
//
// Levels are deterministic functions of their number / day key. The prefilled blocks come from a
// library of hand-made 8x8 pattern templates (shapes, symbols, letters, frames…) which are varied
// with seeded rotation/mirroring, a small shift on the board and color schemes, so every level
// looks designed rather than random. Journey levels never reuse a template within a few levels
// (hard / super hard: within their last picks) and never repeat an exact board layout shortly
// after it was used. Journey difficulty follows a sawtooth (every 5th level hard, every 10th super hard,
// a breather after each peak); harder levels get denser patterns and gems that need more pieces.
// Star thresholds (`par`) come from an effort model calibrated with tools/simulate.mjs.

import { CONFIG } from '../config.js';
import { RNG, hashString } from './rng.js';

/**
 * @typedef {'normal'|'hard'|'superhard'} LevelTag
 * @typedef {Object} LevelDef
 * @property {string} id            'L12' | 'D2026-10-18'
 * @property {'journey'|'daily'} kind
 * @property {number} number        journey: level number; daily: YYYYMMDD as integer
 * @property {number} seed          uint32 derived from the id
 * @property {number} difficulty    0..1, used by the piece generator
 * @property {LevelTag} tag
 * @property {Array<{r:number,c:number,color:number}>} prefilled   color = palette index 0..7
 * @property {Array<{r:number,c:number,type:number}>} gems   always on prefilled cells
 * @property {{ gems?: Object<number, number>, score?: number }} goals
 * @property {[number, number]} par  [par3, par2] pieces placed for 3★ / 2★
 * @property {number} rewardCoins
 * @property {string} pattern       extra: name of the pattern template (debugging/analytics)
 */

/**
 * @typedef {Object} Template
 * @property {string} name
 * @property {1|2|3} tier    1 = easy (nearly full lines), 2 = medium, 3 = hard
 * @property {boolean} fixed letters/symbols that must not be rotated or mirrored
 * @property {string[]} rows 8 strings of 8 chars: '.' = empty, 'a'..'e' = color group
 * @property {number} size   number of filled cells
 * @property {number} borders fragmentation (see bordersOf)
 */

const N = CONFIG.BOARD_SIZE;
const PALETTE_SIZE = 8;

/** Journey difficulty sawtooth (§4.6). */
const DIFFICULTY = Object.freeze({
  base: 0.15, perLevel: 0.012, max: 0.85, hard: 0.12, superhard: 0.25, afterPeak: -0.1, firstHard: 10,
});

/**
 * Level content per tag, each [at progress 0, at progress 1]: expected pieces to collect all gems
 * (`effort`), template fragmentation (`borders`) and prefilled cells (`cells`); plus extra gems
 * and template tier weights (index 1..3, null = by level number).
 */
const CONTENT = Object.freeze({
  normal: Object.freeze({ effort: [8.5, 21], borders: [16, 27], cells: [11, 22], extraGems: 0, tiers: null }),
  hard: Object.freeze({ effort: [16, 26], borders: [28, 38], cells: [18, 26], extraGems: 1, tiers: [0, 0.2, 1, 1] }),
  superhard: Object.freeze({ effort: [24, 38], borders: [38, 50], cells: [22, 30], extraGems: 2, tiers: [0, 0, 0.5, 1] }),
});
/** Seeded gem layouts tried per journey level (closest to the effort target wins). */
const GEM_LAYOUT_TRIES = 10;
/** A journey template is not reused within this many consecutive levels. */
const TEMPLATE_WINDOW = 4;
/**
 * Hard / super hard levels additionally avoid the templates of their last PEAK_WINDOW picks of the
 * same tag and of the last PEAK_WINDOW_OTHER picks of the other peak tag (the level window alone
 * only ever sees normal levels there, so peaks used to repeat every 10 levels).
 */
const PEAK_WINDOW = 4;
const PEAK_WINDOW_OTHER = 2;
/**
 * Soft repeat penalty on top of the hard windows: every use of a template among the last
 * SOFT_WINDOW levels (peaks: SOFT_WINDOW_PEAKS peak picks) multiplies its weight by SOFT_FACTOR,
 * so the templates close to the content target don't take turns with only a handful of others.
 */
const SOFT_WINDOW = 10;
const SOFT_WINDOW_PEAKS = 12;
const SOFT_FACTOR = 0.4;
/** Journey levels below this number keep their template unshifted (first-session tuning). */
const SHIFT_FROM_LEVEL = 10;
/** Shifted layouts keep at least this share of the template's fragmentation (`borders`). */
const SHIFT_MIN_BORDERS = 0.85;
const MAX_SHIFT = 2;
/** Coins for completing a journey level, as a multiple of LEVEL_COMPLETE_COINS. */
const REWARD_FACTOR = Object.freeze({ normal: 1, hard: 1.5, superhard: 2 });

/** Star threshold model, calibrated with tools/simulate.mjs (greedy reference bot). */
const PAR = Object.freeze({
  // expected pieces to collect all gems = base + Σ feature·weight (see gemClearCost)
  base: 4.5,
  perCell: 0.85,
  perSegment: 0.3,
  perHole: 6,
  par3Factor: 0.8,
  par2Factor: 1.5,
  par2Extra: 2,
  // expected pieces to reach a daily score goal = dailyBase + goal / dailyPointsPerPiece
  dailyBase: 13,
  dailyPointsPerPiece: 62,
  dailyPar3Factor: 0.88,
  dailyPar2Factor: 1.25,
});

/**
 * Pattern templates: '.' = empty, letters = color groups. `tier`: 1 = easy (nearly full lines),
 * 2 = medium, 3 = hard (sparse diagonals, checkers, dense frames). `fixed`: letters/symbols that
 * must not be rotated or mirrored. No template may contain a full row or column.
 */
const TEMPLATE_DEFS = [
  // --- tier 1: close to full lines, quick first clears -----------------------------------
  { name: 'bars', tier: 1, rows: ['........', '........', 'aaaaaa..', '........', '........', '..bbbbbb', '........', '........'] },
  { name: 'floor', tier: 1, rows: ['........', '........', '........', '........', '........', '........', 'aaaaaaa.', '.bbbbbbb'] },
  { name: 'pyramid', tier: 1, rows: ['........', '........', '........', '........', '...aa...', '..bbbb..', '.cccccc.', '........'] },
  { name: 'walls', tier: 1, rows: ['a.......', 'a......b', 'a......b', 'a......b', 'a......b', 'a......b', 'a......b', '.......b'] },
  { name: 'cross', tier: 1, rows: ['...a....', '...a....', '...a....', 'bbb.bbbb', '...a....', '...a....', '...a....', '........'] },
  { name: 'stairs', tier: 1, rows: ['........', '........', '........', '........', 'a.......', 'aa......', 'aaa.....', 'aaaa....'] },
  { name: 'hill', tier: 1, rows: ['........', '........', '........', '........', '........', '...a....', '..aaa...', 'bbbb.bbb'] },
  { name: 'shield', tier: 1, rows: ['aaaaaaa.', '.bbbbb..', '..ccc...', '...d....', '........', '........', '........', '........'] },
  { name: 'cup', tier: 1, rows: ['........', '........', '.a....a.', '.a....a.', '.a....a.', '.bbbbbb.', '........', '........'] },
  { name: 'tower', tier: 1, rows: ['........', '..aa....', '..aa....', '..bb....', '..bb....', '..cc....', '..cc....', '........'] },

  // --- tier 2: symbols and shapes ----------------------------------------------------------
  { name: 'corners', tier: 2, rows: ['aa....bb', 'a......b', '........', '........', '........', '........', 'c......d', 'cc....dd'] },
  { name: 'diamond', tier: 2, rows: ['........', '........', '...aa...', '..abba..', '..abba..', '...aa...', '........', '........'] },
  { name: 'plus', tier: 2, rows: ['........', '...aa...', '...aa...', '.aabbaa.', '.aabbaa.', '...aa...', '...aa...', '........'] },
  { name: 'heart', tier: 2, rows: ['........', '........', '..a.a...', '.aaaaa..', '.abbba..', '..aaa...', '...a....', '........'] },
  { name: 'smile', tier: 2, rows: ['........', '.a....a.', '.a....a.', '........', 'b......b', '.b....b.', '..bbbb..', '........'] },
  { name: 'arrow', tier: 2, rows: ['...a....', '..aaa...', '.a.a.a..', '...b....', '...b....', '...b....', '........', '........'] },
  { name: 'ring', tier: 2, rows: ['........', '..aaaa..', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '..aaaa..', '........'] },
  { name: 'squares', tier: 2, rows: ['........', '.aa..bb.', '.aa..bb.', '........', '........', '.cc..dd.', '.cc..dd.', '........'] },
  { name: 'flower', tier: 2, rows: ['........', '...a....', '..aba...', '.abcba..', '..aba...', '...a....', '...d....', '..dd....'] },
  { name: 'moon', tier: 2, rows: ['........', '...aaa..', '..aa....', '..a.....', '..a.....', '..aa....', '...aaa..', '........'] },
  { name: 'bricks', tier: 2, rows: ['........', '........', '........', 'aaa.bbb.', '.ccc.ddd', 'aaa.bbb.', '........', '........'] },
  { name: 'tree', tier: 2, rows: ['...a....', '..aaa...', '.aaaaa..', 'aaaaaaa.', '...b....', '...b....', '........', '........'] },
  { name: 'crown', tier: 2, rows: ['........', '.a.a.a..', '.aaaaa..', '.abbba..', '.aaaaa..', '........', '........', '........'] },
  { name: 'stack', tier: 2, rows: ['........', '........', '........', '........', 'a.....b.', 'aa..c.bb', 'aaccc.bb', '.dddd.ee'] },
  { name: 'hook', tier: 2, rows: ['aaaa....', 'a.......', 'a.......', 'a.......', '........', '.......b', '.......b', '....bbbb'] },
  { name: 'boat', tier: 2, rows: ['........', '...a....', '...aa...', '...aaa..', '...a....', 'bbbbbbb.', '.bbbbb..', '........'] },
  { name: 'letterH', tier: 2, fixed: true, rows: ['........', '.a....a.', '.a....a.', '.aaaaaa.', '.a....a.', '.a....a.', '........', '........'] },
  { name: 'letterT', tier: 2, fixed: true, rows: ['........', '.aaaaaa.', '...aa...', '...aa...', '...aa...', '...aa...', '........', '........'] },
  { name: 'letterL', tier: 2, fixed: true, rows: ['........', '.a......', '.a......', '.a......', '.a......', '.aaaaa..', '........', '........'] },
  { name: 'letterE', tier: 2, fixed: true, rows: ['........', '.aaaaa..', '.a......', '.aaaa...', '.a......', '.aaaaa..', '........', '........'] },
  { name: 'letterU', tier: 2, fixed: true, rows: ['........', '.a....a.', '.a....a.', '.a....a.', '.a....a.', '..aaaa..', '........', '........'] },
  { name: 'hash', tier: 2, rows: ['.....a..', '..a..a..', 'aaaaaaa.', '..a..a..', '..a..a..', 'aaaaaaa.', '..a..a..', '..a.....'] },
  { name: 'rocket', tier: 2, rows: ['...a....', '..aaa...', '..aba...', '..aaa...', '..aaa...', '.aaaaa..', '.a.a.a..', '........'] },
  { name: 'cactus', tier: 2, rows: ['....a...', '.a..a...', '.a..a.a.', '.aaaa.a.', '..aaaaa.', '....a...', '....a...', '........'] },
  { name: 'lamp', tier: 2, rows: ['..aaaa..', '.aaaaaa.', '..aaaa..', '...bb...', '...bb...', '...bb...', '..cccc..', '........'] },
  { name: 'flag', tier: 2, rows: ['.aaaa...', '.aaaa...', '.a......', '.a......', '.a......', '.a......', '.a......', '........'] },

  // --- tier 3: sparse diagonals, checkers, dense designs -----------------------------------
  { name: 'letterX', tier: 3, fixed: true, rows: ['a......a', '.a....a.', '..a..a..', '...bb...', '...bb...', '..a..a..', '.a....a.', 'a......a'] },
  { name: 'letterZ', tier: 3, fixed: true, rows: ['........', '.aaaaaa.', '.....a..', '....a...', '...a....', '..a.....', '.aaaaaa.', '........'] },
  { name: 'letterS', tier: 3, fixed: true, rows: ['........', '..aaaa..', '.a......', '..aaa...', '.....a..', '.....a..', '.aaaa...', '........'] },
  { name: 'diagonal', tier: 3, rows: ['aa......', '.aa.....', '..aa....', '...bb...', '....bb..', '.....bb.', '......b.', '........'] },
  { name: 'checker', tier: 3, rows: ['aa..aa..', 'aa..aa..', '..bb..bb', '..bb..bb', 'aa..aa..', 'aa..aa..', '........', '........'] },
  { name: 'halo', tier: 3, rows: ['...aa...', '..a..a..', '.a....a.', 'a......a', 'a......a', '.a....a.', '..a..a..', '...aa...'] },
  { name: 'gate', tier: 3, rows: ['........', '..aaaa..', '.aaaaaa.', '.bb..bb.', '.bb..bb.', '.bb..bb.', '........', '........'] },
  { name: 'invader', tier: 3, rows: ['........', '..a..a..', '...aa...', '..aaaa..', '.aabbaa.', '.aaaaaa.', '.a....a.', '........'] },
  { name: 'fortress', tier: 3, rows: ['aaa.aaaa', 'a......a', 'a.bbbb.a', '..b..b..', 'a.b..b.a', 'a.bbbb.a', 'a......a', 'aaaa.aaa'] },
  { name: 'zigzag', tier: 3, rows: ['a...a...', '.a.a.a.a', '..a...a.', '........', '........', 'b...b...', '.b.b.b.b', '..b...b.'] },
  { name: 'spiral', tier: 3, rows: ['aaaaaa..', '.......a', '.bbbb..a', '.b..b..a', '.b.....a', '.bbbbbb.', '........', '..aaaa..'] },
  { name: 'wave', tier: 3, rows: ['aa......', '..aa....', '....aa..', '......aa', 'bb......', '..bb....', '....bb..', '......bb'] },
  { name: 'target', tier: 3, rows: ['........', '.aaaaaa.', '.a....a.', '.a.bb.a.', '.a.bb.a.', '.a....a.', '.aaaaaa.', '........'] },
  { name: 'anchor', tier: 3, rows: ['...aa...', '..a..a..', '...aa...', '...aa...', 'b..aa..b', 'bb.aa.bb', '.bbbbbb.', '........'] },
  { name: 'castle', tier: 3, rows: ['a.a..a.a', 'aaa..aaa', '.a....a.', '.a.bb.a.', '.a.bb.a.', '.a....a.', 'aaa..aaa', '........'] },
  { name: 'butterfly', tier: 3, rows: ['a......a', 'aa....aa', 'aaa..aaa', '.aabbaa.', '.aabbaa.', 'aaa..aaa', 'aa....aa', 'a......a'] },
  { name: 'maze', tier: 3, rows: ['aaaaaa.a', 'a......a', 'a.bbbb.a', 'a.b....a', 'a.b.bbbb', 'a.b.....', 'a.bbbbb.', '........'] },
  { name: 'bigheart', tier: 3, rows: ['........', '.aa..aa.', 'abbaabb.', 'abbbbba.', '.abbba..', '..aba...', '...a....', '........'] },
  { name: 'gem', tier: 3, rows: ['...aa...', '..abba..', '.abccba.', 'abccccb.', '.abccba.', '..abba..', '...aa...', '........'] },
  { name: 'skull', tier: 3, rows: ['..aaaa..', '.aaaaaa.', '.a.aa.a.', '.aaaaaa.', '..a..a..', '..bbbb..', '........', '........'] },
  { name: 'stripes', tier: 3, rows: ['aa..bb..', '.aa..bb.', '..aa..bb', 'b..aa..b', 'bb..aa..', '.bb..aa.', '..bb..aa', '........'] },
  { name: 'ladder', tier: 3, rows: ['......a.', 'abbbbba.', 'a.....a.', 'a.....a.', 'abbbbba.', 'a.....a.', 'a.....a.', 'abbbbb..'] },

  // --- more tier 3: dense designs for the hard / super hard pools (fragmented, spread over all rows) ---
  { name: 'nestedV', tier: 3, rows: ['a......a', 'aa....aa', '.aa..aa.', '..aaaa..', '...bb...', '..b..b..', '.b....b.', 'b......b'] },
  { name: 'comb', tier: 3, rows: ['aaaaaaa.', 'a.a.a.a.', 'a.a.a.a.', '........', '.b.b.b.b', '.b.b.b.b', '.bbbbbbb', '........'] },
  { name: 'snake', tier: 3, rows: ['aaaaaaa.', '......a.', '.aaaa.a.', '.a..a.a.', '.a.aa.a.', '.a....a.', '.aaaaaa.', '........'] },
  { name: 'pinwheel', tier: 3, rows: ['aaa.....', 'a..b....', 'a..b..cc', '...bbb.c', 'd.bbb...', 'dd..b..a', '....b..a', '.....aaa'] },
  { name: 'knot', tier: 3, rows: ['.aaaa...', '.a..a...', '.a.bbbb.', '.aab..b.', '...b.aa.', '.bbbb.a.', '...aaaa.', '........'] },
  { name: 'lanterns', tier: 3, rows: ['.aaaaaa.', '.a....a.', '.aaaaaa.', '..a..a..', '..aaaa..', '..a..a..', '.aaaaaa.', '........'] },
  { name: 'lightning', tier: 3, rows: ['....aaaa', '...aa...', '..aa....', '.aaaaaa.', '....aa..', '...aa...', '..aa....', 'aaa.....'] },
  { name: 'maze2', tier: 3, rows: ['a.aaaaa.', 'a.....a.', 'aaaaa.a.', '....a.a.', '.bb.a.aa', '.b..a...', '.b.aaaa.', '.b......'] },
  { name: 'cathedral', tier: 3, rows: ['a..aa..a', 'aa.aa.aa', 'aa....aa', 'a.bbbb.a', '..b..b..', 'a.b..b.a', 'aa....aa', 'aaa..aaa'] },
  { name: 'dna', tier: 3, rows: ['aa....bb', '.aa..bb.', '..aabb..', '...bb...', '..bbaa..', '.bb..aa.', 'bb....aa', 'b......a'] },
  { name: 'ziggurat', tier: 3, rows: ['...aa...', '..a..a..', '..a..a..', '.aa..aa.', '.a....a.', 'aa....aa', 'a......a', 'aaaaaaa.'] },
  { name: 'tangram', tier: 3, rows: ['aaa.....', 'aaa..bb.', '.....bb.', 'ccc.....', '.cc..ddd', '.....ddd', 'ee....f.', 'ee...fff'] },
  { name: 'hourglass', tier: 3, rows: ['.aaaaaa.', '..a..a..', '...aa...', '...bb...', '...bb...', '...aa...', '..a..a..', '.aaaaaa.'] },
  { name: 'islands', tier: 3, rows: ['aa....bb', 'aaa..bbb', '.aa...b.', '........', '........', '.c...dd.', 'ccc..ddd', 'cc....dd'] },
  { name: 'steps3', tier: 3, rows: ['aa......', 'aaa.....', '.aaa....', '..aaa...', '...bbb..', '....bbb.', '.....bbb', '......bb'] },
  { name: 'tiles', tier: 3, rows: ['aa.bb.aa', 'aa.bb.aa', '........', 'cc.dd.cc', 'cc.dd.cc', '........', 'aa.bb.aa', '........'] },
  { name: 'domino', tier: 3, rows: ['aa.bb.cc', '...bb...', 'dd....ee', 'dd.ff.ee', '...ff...', 'gg.hh.ii', '...hh...', 'jj....kk'] },
  { name: 'frames2', tier: 3, rows: ['aaaa....', 'a..a....', 'aaaa....', '........', '....bbbb', '....b..b', '....bbbb', '........'] },
  { name: 'bridge', tier: 3, rows: ['........', 'aaaaaaa.', 'a.a.a.a.', 'a.a.a.a.', '........', '.bbbbbbb', '.b.b.b.b', '.b.b.b.b'] },
];

/**
 * Fragmentation of a template: number of filled/empty borders between neighbouring cells. The
 * more fragmented the free space, the harder the board is to survive on (measured with
 * tools/simulate.mjs: strongest predictor of bot failures). Invariant under rotation/mirroring.
 * @param {string[]} rows
 * @returns {number}
 */
function bordersOf(rows) {
  let borders = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const filled = rows[r][c] !== '.';
      if (c + 1 < N && filled !== (rows[r][c + 1] !== '.')) borders++;
      if (r + 1 < N && filled !== (rows[r + 1][c] !== '.')) borders++;
    }
  }
  return borders;
}

/** @type {ReadonlyArray<Readonly<Template>>} */
const TEMPLATES = Object.freeze(TEMPLATE_DEFS.map((t) => Object.freeze({
  name: t.name,
  tier: t.tier,
  fixed: !!t.fixed,
  rows: Object.freeze(t.rows.slice()),
  size: t.rows.join('').replace(/\./g, '').length,
  borders: bordersOf(t.rows),
})));

/** Template names (for tests and debugging). */
export const PATTERN_NAMES = Object.freeze(TEMPLATES.map((t) => t.name));

/** The template library (extra export for tests): `{ name, tier, fixed, rows, size, borders }`. */
export const PATTERN_TEMPLATES = TEMPLATES;

/** The 8 symmetries of the square: [swap axes, flip rows, flip cols]. */
const TRANSFORMS = [
  [false, false, false], [false, false, true], [false, true, false], [false, true, true],
  [true, false, false], [true, false, true], [true, true, false], [true, true, true],
];

/**
 * Template cells with the given symmetry and shift.
 * @param {Template} tpl
 * @param {readonly [boolean, boolean, boolean]} sym [swap axes, flip rows, flip cols]
 * @param {number} [dr] rows to move down
 * @param {number} [dc] columns to move right
 * @returns {Array<{r:number, c:number, group:number}>}
 */
function variantCells(tpl, sym, dr = 0, dc = 0) {
  const [swap, flipR, flipC] = sym;
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const ch = tpl.rows[r][c];
      if (ch === '.') continue;
      let rr = flipR ? N - 1 - r : r;
      let cc = flipC ? N - 1 - c : c;
      if (swap) [rr, cc] = [cc, rr];
      out.push({ r: rr + dr, c: cc + dc, group: ch.charCodeAt(0) - 97 });
    }
  }
  return out;
}

/**
 * Template cells (with a seeded symmetry for non-fixed templates).
 * @param {Template} tpl
 * @param {RNG} rng
 * @returns {Array<{r:number, c:number, group:number}>}
 */
function templateCells(tpl, rng) {
  return variantCells(tpl, tpl.fixed ? TRANSFORMS[0] : rng.pick(TRANSFORMS));
}

/**
 * @typedef {Object} Variant
 * @property {readonly [boolean, boolean, boolean]} sym
 * @property {number} dr
 * @property {number} dc
 * @property {string} key  occupancy of the 64 cells ('#' / '.'), equal keys = identical board layout
 */

/** @param {Uint8Array} grid N×N occupancy @returns {string} equal strings = identical board layouts */
function occupancyKey(grid) {
  let key = '';
  for (let i = 0; i < N * N; i++) key += grid[i] ? '#' : '.';
  return key;
}

/** Fragmentation (`bordersOf`) of an N×N occupancy grid. */
function bordersOfGrid(grid) {
  let borders = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = grid[r * N + c];
      if (c + 1 < N && v !== grid[r * N + c + 1]) borders++;
      if (r + 1 < N && v !== grid[(r + 1) * N + c]) borders++;
    }
  }
  return borders;
}

/** @type {Map<string, Variant[]>} */
const VARIANT_CACHE = new Map();

/**
 * All distinct board layouts of a template: its symmetries (none for letters/symbols) combined
 * with shifts of up to MAX_SHIFT cells that keep every cell on the board and the template's
 * fragmentation (a shift towards an edge lowers it). Shifts preserve every row/column count as a
 * multiset, so a shifted layout never has a full line either. Index 0 is the unshifted layout.
 * @param {Template} tpl
 * @returns {Variant[]}
 */
function variantsOf(tpl) {
  let list = VARIANT_CACHE.get(tpl.name);
  if (list) return list;
  list = [];
  const seen = new Set();
  const bases = (tpl.fixed ? [TRANSFORMS[0]] : TRANSFORMS).map((sym) => {
    const cells = variantCells(tpl, sym);
    const rs = cells.map((p) => p.r);
    const cs = cells.map((p) => p.c);
    return { sym, cells, minR: Math.min(...rs), maxR: Math.max(...rs), minC: Math.min(...cs), maxC: Math.max(...cs) };
  });
  const grid = new Uint8Array(N * N);
  for (let dist = 0; dist <= MAX_SHIFT; dist++) {
    for (let dr = -dist; dr <= dist; dr++) {
      for (let dc = -dist; dc <= dist; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== dist) continue;
        for (const base of bases) {
          if (base.minR + dr < 0 || base.maxR + dr >= N || base.minC + dc < 0 || base.maxC + dc >= N) continue;
          grid.fill(0);
          for (const { r, c } of base.cells) grid[(r + dr) * N + c + dc] = 1;
          const key = occupancyKey(grid);
          if (seen.has(key)) continue;
          if (dist > 0 && bordersOfGrid(grid) < SHIFT_MIN_BORDERS * tpl.borders) continue;
          seen.add(key);
          list.push({ sym: base.sym, dr, dc, key });
        }
      }
    }
  }
  VARIANT_CACHE.set(tpl.name, list);
  return list;
}

/**
 * Assigns palette colors to template groups with a seeded scheme.
 * @param {Array<{r:number, c:number, group:number}>} cells
 * @param {RNG} rng
 * @returns {Array<{r:number, c:number, color:number}>}
 */
function colorize(cells, rng) {
  const palette = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const scheme = rng.weighted(['groups', 'mono', 'rows'], (s) => (s === 'groups' ? 2 : 1));
  const base = palette[0];
  return cells.map(({ r, c, group }) => {
    let color;
    if (scheme === 'groups') color = palette[group % PALETTE_SIZE];
    else if (scheme === 'mono') color = base;
    else color = (base + r) % PALETTE_SIZE;
    return { r, c, color };
  });
}

/**
 * Removes cells until no row/column is full (defensive; the templates are designed without full
 * lines, this keeps that guarantee for any future template).
 * @param {Array<{r:number, c:number, color:number}>} cells
 * @returns {Array<{r:number, c:number, color:number}>}
 */
function breakFullLines(cells) {
  let list = cells;
  for (let line = 0; line < 2 * N; line++) {
    const isRow = line < N;
    const idx = isRow ? line : line - N;
    const inLine = list.filter((p) => (isRow ? p.r : p.c) === idx);
    if (inLine.length === N) {
      const victim = inLine[(N >> 1) - 1 + (idx & 1)];
      list = list.filter((p) => p !== victim);
    }
  }
  return list;
}

/**
 * Picks `count` gem cells among the prefilled cells. `hardness` 0..1: 0 prefers cells in nearly
 * full lines (quick to clear), 1 prefers cells in sparse lines and corners/edges.
 * @param {Array<{r:number, c:number}>} cells
 * @param {number} count
 * @param {number} hardness
 * @param {RNG} rng
 * @returns {Array<{r:number, c:number}>}
 */
function pickGemCells(cells, count, hardness, rng) {
  const rowFill = new Array(N).fill(0);
  const colFill = new Array(N).fill(0);
  for (const { r, c } of cells) { rowFill[r]++; colFill[c]++; }
  const scored = cells.map((p) => {
    const ease = Math.max(rowFill[p.r], colFill[p.c]) / N; // ~1 = line almost full
    const edge = (p.r === 0 || p.r === N - 1 ? 1 : 0) + (p.c === 0 || p.c === N - 1 ? 1 : 0);
    const easyW = ease ** 3;
    const hardW = (1 - ease) * 0.6 + edge * 0.35;
    return { p, w: 0.02 + (1 - hardness) * easyW + hardness * hardW };
  });
  const out = [];
  while (out.length < count && scored.length > 0) {
    const pick = rng.weighted(scored, (s) => s.w);
    out.push(pick.p);
    scored.splice(scored.indexOf(pick), 1);
  }
  return out;
}

/**
 * Distributes `count` gems over gem types (each used type gets at least one).
 * @param {number} count
 * @param {number} typesAvailable 1..3
 * @param {RNG} rng
 * @returns {number[]} gem type per gem
 */
function gemTypes(count, typesAvailable, rng) {
  const types = rng.shuffle([1, 2, 3]).slice(0, Math.max(1, Math.min(typesAvailable, count)));
  const out = types.slice();
  while (out.length < count) out.push(rng.pick(types));
  return rng.shuffle(out);
}

/**
 * Effort to collect all gems: over every set of rows/columns that covers all gems (exhaustive
 * over row subsets, columns cover the rest) the one with the least estimated effort is used.
 * `cells` = empty cells in those lines, `segments` = runs of empty cells along them (each needs at
 * least one piece; scattered holes are much harder than one gap), `holes` = enclosed single empty
 * cells (only a 1x1 piece fits), `lines` = number of lines.
 * @param {Array<{r:number, c:number}>} prefilled
 * @param {Array<{r:number, c:number}>} gems
 * @returns {{ cells: number, segments: number, holes: number, lines: number, pieces: number }}
 *   `pieces` = estimated pieces the reference bot needs (model calibrated with the simulator)
 */
function gemClearCost(prefilled, gems) {
  if (gems.length === 0) return { cells: 0, segments: 0, holes: 0, lines: 0, pieces: 0 };
  const filled = new Uint8Array(N * N);
  for (const { r, c } of prefilled) filled[r * N + c] = 1;
  const blocked = (r, c) => r < 0 || c < 0 || r >= N || c >= N || filled[r * N + c] === 1;
  const hole = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      hole[r * N + c] = !filled[r * N + c] && blocked(r - 1, c) && blocked(r + 1, c)
        && blocked(r, c - 1) && blocked(r, c + 1) ? 1 : 0;
    }
  }
  // Per line (rows 0..N-1, then columns): empty cells, runs of empty cells, enclosed holes.
  const lineCells = [];
  const lineRuns = [];
  const lineHoles = [];
  for (let line = 0; line < 2 * N; line++) {
    let cells = 0;
    let runs = 0;
    let holes = 0;
    let prevEmpty = false;
    for (let k = 0; k < N; k++) {
      const i = line < N ? line * N + k : k * N + line - N;
      const empty = !filled[i];
      if (empty) { cells++; holes += hole[i]; if (!prevEmpty) runs++; }
      prevEmpty = empty;
    }
    lineCells.push(cells);
    lineRuns.push(runs);
    lineHoles.push(holes);
  }
  let best = null;
  for (let rowSet = 0; rowSet < 1 << N; rowSet++) {
    let colSet = 0;
    for (const g of gems) if (!(rowSet & (1 << g.r))) colSet |= 1 << g.c;
    let cells = 0;
    let segments = 0;
    let holes = 0;
    let lines = 0;
    for (let i = 0; i < 2 * N; i++) {
      if (!((i < N ? rowSet >> i : colSet >> (i - N)) & 1)) continue;
      lines++;
      cells += lineCells[i];
      segments += lineRuns[i];
      holes += lineHoles[i];
    }
    // Empty cells where a chosen row meets a chosen column were counted twice.
    for (let r = 0; r < N; r++) {
      if (!(rowSet & (1 << r))) continue;
      for (let c = 0; c < N; c++) {
        if (colSet & (1 << c) && !filled[r * N + c]) { cells--; holes -= hole[r * N + c]; }
      }
    }
    const pieces = PAR.base + cells * PAR.perCell + segments * PAR.perSegment + holes * PAR.perHole;
    if (!best || pieces < best.pieces) best = { cells, segments, holes, lines, pieces };
  }
  return best;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Sawtooth tag of journey level n: every 10th level from 10 on is super hard, every other 5th
 * level hard, everything else (incl. levels 1–9) normal.
 * @param {number} n
 * @returns {LevelTag}
 */
export function levelKind(n) {
  if (n < DIFFICULTY.firstHard) return 'normal';
  if (n % 10 === 0) return 'superhard';
  if (n % 5 === 0) return 'hard';
  return 'normal';
}

/**
 * Journey difficulty: min(0.85, 0.15 + 0.012 n), +0.12 hard, +0.25 super hard, -0.1 for the level
 * after a peak; clamped to 0..1.
 * @param {number} n
 * @returns {number}
 */
function journeyDifficulty(n) {
  const tag = levelKind(n);
  let d = Math.min(DIFFICULTY.max, DIFFICULTY.base + DIFFICULTY.perLevel * n);
  if (tag === 'superhard') d += DIFFICULTY.superhard;
  else if (tag === 'hard') d += DIFFICULTY.hard;
  else if (n > 1 && levelKind(n - 1) !== 'normal') d += DIFFICULTY.afterPeak;
  return round2(clamp01(d));
}

/**
 * Template tier weights for a normal journey level.
 * @param {number} n
 * @returns {number[]} weight per tier (index 1..3)
 */
function normalTierWeights(n) {
  if (n <= 8) return [0, 1, 0, 0];
  if (n <= 16) return [0, 1, 1, 0];
  if (n <= 32) return [0, 0.5, 1, 0.4];
  return [0, 0.3, 1, 0.8];
}

/**
 * Gem count range for journey level n: 2–3 at level 1, 8–12 from level ~30, then a plateau
 * with variety (6–12); harder tags add gems.
 * @param {number} n
 * @param {LevelTag} tag
 * @returns {[number, number]}
 */
function gemRangeFor(n, tag) {
  const extra = CONTENT[tag].extraGems;
  if (n > 50) return [6 + extra, 12];
  const lo = Math.min(10, 2 + Math.floor(n * 0.2) + extra);
  return [lo, Math.min(12, lo + 1 + Math.floor(n / 25))];
}

/** @param {number} n @returns {number} 0 at level 1 … 1 from level 50 */
function progressOf(n) {
  return clamp01((n - 1) / 49);
}

/**
 * Seeded template choice for journey level n.
 * @param {number} n
 * @param {Template[]} avoid templates that must not be reused (see `recentTemplates`)
 * @param {Template[]} soft templates whose weight is reduced per use
 * @returns {Template}
 */
function chooseTemplate(n, avoid, soft) {
  const rng = new RNG(hashString(`journey-template-${n}`));
  const tag = levelKind(n);
  const progress = progressOf(n);
  const content = CONTENT[tag];
  const tierW = content.tiers || normalTierWeights(n);
  const minCells = gemRangeFor(n, tag)[1] + 2;
  const targetCells = lerp(content.cells[0], content.cells[1], progress);
  const targetBorders = lerp(content.borders[0], content.borders[1], progress);
  // The template must allow gem layouts that need enough effort (e.g. not only nearly full lines).
  const minEffort = 0.7 * lerp(content.effort[0], content.effort[1], progress);
  const near = (x, target, width) => Math.exp(-(((x - target) / width) ** 2));
  const uses = (t) => soft.reduce((k, u) => k + (u === t ? 1 : 0), 0);
  // Templates with only a few layouts (symmetric ones) would run out of unused layouts first. A
  // template no level used yet has all of them left (its layouts are built on first use only).
  const layoutsLeft = (t) => (LAYOUTS_USED.has(t.name) ? unusedVariants(n, t).length : Infinity);
  const weight = (t) => tierW[t.tier] * (0.02 + near(t.size, targetCells, 7) * near(t.borders, targetBorders, 6))
    * SOFT_FACTOR ** uses(t) * Math.max(0.05, Math.min(1, layoutsLeft(t) / 3));
  const usable = TEMPLATES.filter((t) => tierW[t.tier] > 0 && t.size >= minCells);
  const strong = usable.filter((t) => maxEffort(t) >= minEffort);
  const allowed = (strong.length ? strong : usable).filter((t) => !avoid.includes(t));
  const fresh = allowed.filter((t) => layoutsLeft(t) > 0);
  return rng.weighted(fresh.length ? fresh : allowed.length ? allowed : usable, weight);
}

/**
 * Board layout of a journey level: a template and one of its variants.
 * @typedef {{ tpl: Template, variant: Variant }} LayoutPlan
 */

/** Layout plans of journey levels 1..k (index = level), filled on demand. */
const LAYOUT_HISTORY = [null];

/**
 * Templates journey level m must not reuse (`avoid`: the previous TEMPLATE_WINDOW levels and, for
 * hard / super hard levels, the last picks of the peak tags, PEAK_WINDOW / PEAK_WINDOW_OTHER) and
 * the ones it should rather not reuse (`soft`: SOFT_WINDOW levels, peaks: SOFT_WINDOW_PEAKS picks).
 * @param {number} m
 * @returns {{ avoid: Template[], soft: Template[] }}
 */
function recentTemplates(m) {
  const avoid = LAYOUT_HISTORY.slice(Math.max(1, m - TEMPLATE_WINDOW), m).map((p) => p.tpl);
  const tag = levelKind(m);
  if (tag === 'normal') {
    return { avoid, soft: LAYOUT_HISTORY.slice(Math.max(1, m - SOFT_WINDOW), m).map((p) => p.tpl) };
  }
  const soft = [];
  let same = 0;
  let other = 0;
  for (let k = m - 1; k >= 1 && soft.length < SOFT_WINDOW_PEAKS; k--) {
    const kind = levelKind(k);
    if (kind === 'normal') continue;
    soft.push(LAYOUT_HISTORY[k].tpl);
    if (kind === tag ? same++ < PEAK_WINDOW : other++ < PEAK_WINDOW_OTHER) avoid.push(LAYOUT_HISTORY[k].tpl);
  }
  return { avoid, soft };
}

/** Board layout key → highest journey level that used it. */
const LAYOUT_LAST_USED = new Map();
/** Names of the templates some journey level already used. */
const LAYOUTS_USED = new Set();

/** @param {number} m @param {Template} tpl @returns {Variant[]} layouts journey level m may use */
function variantPool(m, tpl) {
  const all = variantsOf(tpl);
  return m < SHIFT_FROM_LEVEL ? all.filter((v) => v.dr === 0 && v.dc === 0) : all;
}

/** @param {number} m @param {Template} tpl @returns {Variant[]} layouts of `tpl` no earlier level used */
function unusedVariants(m, tpl) {
  return variantPool(m, tpl).filter((v) => !LAYOUT_LAST_USED.has(v.key));
}

/**
 * Seeded layout variant of a template for journey level m: a layout no earlier level used (the
 * one used longest ago if the template ran out of layouts), unshifted layouts preferred.
 * @param {number} m
 * @param {Template} tpl
 * @returns {Variant}
 */
function chooseVariant(m, tpl) {
  const rng = new RNG(hashString(`journey-layout-${m}`));
  const pool = variantPool(m, tpl);
  const unused = unusedVariants(m, tpl);
  if (unused.length > 0) {
    return rng.weighted(unused, (v) => (v.dr === 0 && v.dc === 0 ? 3 : Math.abs(v.dr) + Math.abs(v.dc) <= 2 ? 1 : 0.5));
  }
  return pool.reduce((best, v) => (LAYOUT_LAST_USED.get(v.key) < LAYOUT_LAST_USED.get(best.key) ? v : best), pool[0]);
}

/**
 * @param {number} n
 * @returns {LayoutPlan} template and layout of journey level n
 */
function journeyLayout(n) {
  for (let m = LAYOUT_HISTORY.length; m <= n; m++) {
    const { avoid, soft } = recentTemplates(m);
    const tpl = chooseTemplate(m, avoid, soft);
    const variant = chooseVariant(m, tpl);
    LAYOUT_LAST_USED.set(variant.key, m);
    LAYOUTS_USED.add(tpl.name);
    LAYOUT_HISTORY.push({ tpl, variant });
  }
  return LAYOUT_HISTORY[n];
}

/** @type {Map<string, number>} */
const EFFORT_CACHE = new Map();

/**
 * Effort if every cell of the template held a gem (upper bound for any gem layout; invariant
 * under rotation/mirroring).
 * @param {Template} tpl
 * @returns {number}
 */
function maxEffort(tpl) {
  let effort = EFFORT_CACHE.get(tpl.name);
  if (effort === undefined) {
    const cells = [];
    tpl.rows.forEach((row, r) => { for (let c = 0; c < N; c++) if (row[c] !== '.') cells.push({ r, c }); });
    effort = gemClearCost(cells, cells).pieces;
    EFFORT_CACHE.set(tpl.name, effort);
  }
  return effort;
}

/**
 * Builds prefilled cells for the given template.
 * @param {Template} tpl
 * @param {RNG} rng
 * @param {Variant} [variant] layout variant; a seeded symmetry is drawn from `rng` if omitted
 */
function buildPrefilled(tpl, rng, variant) {
  const cells = variant ? variantCells(tpl, variant.sym, variant.dr, variant.dc) : templateCells(tpl, rng);
  return breakFullLines(colorize(cells, rng))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

/**
 * @param {Array<{type:number}>} gems
 * @returns {Object<number, number>} gem count per type
 */
function countByType(gems) {
  const out = {};
  for (const g of gems) out[g.type] = (out[g.type] || 0) + 1;
  return out;
}

/**
 * Journey level n (1-based), deterministic from n.
 * @param {number} n
 * @returns {LevelDef}
 */
export function generateLevel(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`generateLevel: invalid level number ${n}`);
  const id = `L${n}`;
  const seed = hashString(id);
  const rng = new RNG(seed);
  const tag = levelKind(n);
  // Endless levels after 50 vary their effort randomly in the upper range.
  const progress = n > 50 ? lerp(0.6, 1, rng.next()) : progressOf(n);

  const { tpl, variant } = journeyLayout(n);
  const prefilled = buildPrefilled(tpl, rng, variant);
  const [lo, hi] = gemRangeFor(n, tag);
  const count = Math.min(rng.range(lo, hi), prefilled.length);
  // Several seeded gem layouts; keep the one whose effort is closest to the target.
  const target = lerp(CONTENT[tag].effort[0], CONTENT[tag].effort[1], progress);
  let best = null;
  for (let i = 0; i < GEM_LAYOUT_TRIES; i++) {
    const cells = pickGemCells(prefilled, count, progress, rng);
    const cost = gemClearCost(prefilled, cells);
    const miss = Math.abs(cost.pieces - target);
    if (!best || miss < best.miss) best = { cells, cost, miss };
  }
  const types = gemTypes(best.cells.length, n < 5 ? 1 : n < 15 ? 2 : 3, rng);
  const gems = best.cells.map((p, i) => ({ r: p.r, c: p.c, type: types[i] }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
  const par3 = par3For(best.cost.pieces);

  return {
    id,
    kind: 'journey',
    number: n,
    seed,
    difficulty: journeyDifficulty(n),
    tag,
    prefilled,
    gems,
    goals: { gems: countByType(gems) },
    par: [par3, par2For(par3)],
    rewardCoins: Math.round(CONFIG.ECONOMY.LEVEL_COMPLETE_COINS * REWARD_FACTOR[tag]),
    pattern: tpl.name,
  };
}

/** @param {number} pieces expected pieces @returns {number} 3-star threshold */
function par3For(pieces) {
  return Math.max(3, Math.round(pieces * PAR.par3Factor));
}

/**
 * Estimated effort of a level (extra export for balancing tools and tests).
 * @param {LevelDef} level
 * @returns {{ cells: number, segments: number, holes: number, lines: number, pieces: number }}
 */
export function levelEffort(level) {
  return gemClearCost(level.prefilled, level.gems);
}

/** @param {number} par3 @returns {number} */
function par2For(par3) {
  return Math.round(par3 * PAR.par2Factor + PAR.par2Extra);
}

/** Daily score goals by weekday (0 = Sunday … 6 = Saturday): easy on Monday, hard on weekends. */
const DAILY_SCORE_BY_WEEKDAY = [2500, 800, 1100, 1400, 1700, 2000, 2300];
/** Daily generator difficulty on Monday and on Sunday. */
const DAILY_DIFFICULTY = [0.2, 0.5];

/**
 * Daily challenge for a local day key 'YYYY-MM-DD', deterministic from the key.
 * @param {string} dayKey
 * @returns {LevelDef}
 */
export function generateDailyLevel(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
  if (!m) throw new RangeError(`generateDailyLevel: invalid day key ${dayKey}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const id = `D${dayKey}`;
  const seed = hashString(id);
  const rng = new RNG(seed);

  const baseScore = DAILY_SCORE_BY_WEEKDAY[weekday];
  const score = Math.round((baseScore * (0.92 + rng.next() * 0.16)) / 50) * 50;
  const weekdayHardness = ((weekday + 6) % 7) / 6; // Monday 0 … Sunday 1

  const tpl = rng.weighted(TEMPLATES, (t) => (t.tier === 2 ? 2 : 1));
  const prefilled = buildPrefilled(tpl, rng);

  const gems = [];
  const goals = { score };
  if (rng.chance(0.4)) {
    const count = rng.range(2, 4);
    const cells = pickGemCells(prefilled, Math.min(count, prefilled.length), 0.3 + 0.5 * weekdayHardness, rng);
    const types = gemTypes(cells.length, 2, rng);
    cells.forEach((p, i) => gems.push({ r: p.r, c: p.c, type: types[i] }));
    gems.sort((a, b) => a.r - b.r || a.c - b.c);
    goals.gems = countByType(gems);
  }

  const cost = gemClearCost(prefilled, gems);
  const expected = Math.max(PAR.dailyBase + score / PAR.dailyPointsPerPiece, cost.pieces);
  const par3 = Math.max(3, Math.round(expected * PAR.dailyPar3Factor));

  return {
    id,
    kind: 'daily',
    number: year * 10000 + month * 100 + day,
    seed,
    difficulty: round2(lerp(DAILY_DIFFICULTY[0], DAILY_DIFFICULTY[1], weekdayHardness)),
    tag: 'normal',
    prefilled,
    gems,
    goals,
    par: [par3, Math.round(par3 * PAR.dailyPar2Factor)],
    rewardCoins: CONFIG.ECONOMY.DAILY_CHALLENGE_COINS,
    pattern: tpl.name,
  };
}
