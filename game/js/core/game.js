// One run of the game (see docs/ARCHITECTURE.md §4.7): board, tray, scoring, goals, boosters,
// revive, tutorial script and exact save/resume.

import { CONFIG } from '../config.js';
import { RNG, randomSeed } from './rng.js';
import { getShape } from './shapes.js';
import { Board, OUT_OF_BOUNDS } from './board.js';
import { placementPoints, clearPoints, praiseFor } from './scoring.js';
import { PieceGenerator } from './generator.js';

/**
 * @typedef {import('./generator.js').Piece} Piece
 * @typedef {import('./levels.js').LevelDef} LevelDef
 * @typedef {import('./board.js').ClearedCell} ClearedCell
 * @typedef {'classic'|'journey'|'daily'|'tutorial'} Mode
 * @typedef {'playing'|'over'|'won'} Status
 * @typedef {{ gems?: Object<number, {need:number, have:number}>, score?: {need:number, have:number} }} Goals
 *
 * @typedef {Object} PlaceResult
 * @property {number} trayIndex
 * @property {Piece} piece
 * @property {number} r
 * @property {number} c
 * @property {Array<[number, number]>} placedCells
 * @property {number} placePoints
 * @property {{ rows: number[], cols: number[] }} lines
 * @property {number} linesCount
 * @property {ClearedCell[]} cleared
 * @property {{1:number, 2:number, 3:number}} gemsCollected
 * @property {number} combo
 * @property {number} clearPoints
 * @property {boolean} allClear
 * @property {number} allClearBonus
 * @property {null|string} praise
 * @property {number} totalPoints
 * @property {number} score         score after this placement
 * @property {boolean} newBest      score passed bestScore (> 0) for the first time this run
 * @property {boolean} trayRefilled
 * @property {Array<Piece|null>} tray current tray (after a refill)
 * @property {Status} status
 * @property {number} tutorialStep  extra: current tutorial step (tutorial mode, else 0)
 */

export const MODES = Object.freeze(['classic', 'journey', 'daily', 'tutorial']);
const BOOSTER_MODES = new Set(['journey', 'daily']);
const SAVE_VERSION = 1;
const N = CONFIG.BOARD_SIZE;
const TRAY_SIZE = CONFIG.TRAY_SIZE;
const { COMBO_KEEP_MOVES, ALL_CLEAR_BONUS } = CONFIG.SCORING;

/**
 * Scripted tutorial steps. Board rows: '.' = empty, digit = color index. The single tray piece
 * sits in the middle slot; `hint` is the move that clears: 1 line, then 2 lines at once, then a
 * row and a column together – an all-clear finale with the combo built up by the earlier steps.
 */
const TUTORIAL = Object.freeze([
  {
    board: ['........', '........', '........', '........', '012..567', '..2345..', '........', '........'],
    piece: { shapeId: 'I2h', color: 3 },
    hint: { trayIndex: 1, r: 4, c: 3 },
  },
  {
    board: ['........', '........', '........', '........', '........', '...33...', '445..667', '445..667'],
    piece: { shapeId: 'O2', color: 1 },
    hint: { trayIndex: 1, r: 6, c: 3 },
  },
  {
    board: ['6.......', '6.......', '6.......', '6.......', '6.......', '........', '........', '...22222'],
    piece: { shapeId: 'L5a', color: 4 },
    hint: { trayIndex: 1, r: 5, c: 0 },
  },
]);

/** Number of scripted tutorial steps. */
export const TUTORIAL_STEP_COUNT = TUTORIAL.length;

export class GameSession {
  /** Use `GameSession.create()` or `GameSession.fromJSON()`. */
  constructor() {
    /** @type {Mode} */
    this.mode = 'classic';
    /** @type {number} uint32 seed of this run */
    this.seed = 0;
    /** @type {LevelDef|null} */
    this.level = null;
    /** @type {Board} */
    this.board = new Board(N);
    /** @type {Array<Piece|null>} */
    this.tray = [];
    this.score = 0;
    this.combo = 0;
    this.movesSinceClear = 0;
    this.piecesPlaced = 0;
    this.linesCleared = 0;
    this.maxCombo = 0;
    /** extra: number of all-clears this run */
    this.allClears = 0;
    /** index of the current tray (0 = first) */
    this.trayIndex = 0;
    /** extra: completed trays in a row without any clear */
    this.traysSinceClear = 0;
    /** extra: whether the current tray produced a clear so far */
    this.clearedThisTray = false;
    this.reviveUsed = false;
    /** @type {Status} */
    this.status = 'playing';
    /** best score before this run (unchanged during the run) */
    this.bestScore = 0;
    /** extra: true once the score passed bestScore in this run */
    this.newBestReached = false;
    /** @type {Goals} */
    this.goals = {};
    /** extra: tutorial step 0..TUTORIAL_STEP_COUNT-1 (tutorial mode) */
    this.tutorialStep = 0;
    /** @type {RNG} */
    this.rng = new RNG(0);
    /** @type {PieceGenerator} */
    this.generator = new PieceGenerator({ rng: this.rng });
  }

  /**
   * Starts a new run.
   * @param {Object} opts
   * @param {Mode} [opts.mode='classic']
   * @param {number} [opts.seed] uint32; random if omitted
   * @param {LevelDef} [opts.level] required for journey/daily
   * @param {number} [opts.bestScore=0] best score so far (for `newBest`)
   * @returns {GameSession}
   */
  static create({ mode = 'classic', seed, level = null, bestScore = 0 } = {}) {
    if (!MODES.includes(mode)) throw new Error(`GameSession.create: unknown mode ${mode}`);
    const needsLevel = mode === 'journey' || mode === 'daily';
    if (needsLevel && !level) throw new Error(`GameSession.create: mode ${mode} needs a level`);
    const s = new GameSession();
    s.mode = mode;
    s.seed = (seed === undefined || seed === null ? randomSeed() : seed) >>> 0;
    s.rng = new RNG(s.seed);
    s.level = needsLevel ? level : null;
    s.bestScore = Math.max(0, bestScore || 0);
    s.generator = new PieceGenerator({ rng: s.rng, mode, difficulty: needsLevel ? level.difficulty || 0 : 0 });

    if (mode === 'tutorial') {
      s.loadTutorialStep();
      return s;
    }
    if (s.level) {
      for (const { r, c, color } of s.level.prefilled) s.board.cells[r * N + c] = color + 1;
      for (const { r, c, type } of s.level.gems) {
        if (s.board.cells[r * N + c] !== 0) s.board.gems[r * N + c] = type;
      }
      const { gems, score } = s.level.goals || {};
      if (gems) {
        s.goals.gems = {};
        for (const type of Object.keys(gems)) s.goals.gems[type] = { need: gems[type], have: 0 };
      }
      if (score) s.goals.score = { need: score, have: 0 };
    }
    s.tray = s.generator.nextTray(s.board, s.trayContext());
    s.updateStatus();
    return s;
  }

  /**
   * Restores a run saved with `toJSON()`. Continuing produces exactly the same future trays.
   * @param {Object} json
   * @returns {GameSession}
   * @throws {Error} on missing or corrupted data
   */
  static fromJSON(json) {
    if (!json || json.v !== SAVE_VERSION || !MODES.includes(json.mode)) {
      throw new Error('GameSession.fromJSON: unsupported save data');
    }
    const s = new GameSession();
    s.mode = json.mode;
    s.seed = json.seed >>> 0;
    s.level = json.level ? structuredCloneJSON(json.level) : null;
    s.board = Board.fromJSON(json.board);
    s.tray = json.tray.map((p) => {
      if (p === null) return null;
      if (!getShape(p.shapeId)) throw new Error(`GameSession.fromJSON: unknown shape ${p.shapeId}`);
      return { uid: p.uid, shapeId: p.shapeId, color: p.color };
    });
    if (s.tray.length !== TRAY_SIZE) throw new Error('GameSession.fromJSON: invalid tray');
    for (const key of COUNTER_KEYS) s[key] = Number(json[key]) || 0;
    s.tutorialStep = Math.min(Math.max(0, s.tutorialStep), TUTORIAL.length - 1);
    s.clearedThisTray = !!json.clearedThisTray;
    s.reviveUsed = !!json.reviveUsed;
    s.newBestReached = !!json.newBestReached;
    s.status = ['playing', 'over', 'won'].includes(json.status) ? json.status : 'playing';
    s.goals = structuredCloneJSON(json.goals || {});
    s.rng = new RNG(0);
    s.rng.setState(json.rng);
    s.generator = PieceGenerator.fromJSON(json.generator, s.rng);
    return s;
  }

  /** @returns {Object} plain JSON-safe snapshot of everything needed to resume exactly */
  toJSON() {
    const out = {
      v: SAVE_VERSION,
      mode: this.mode,
      seed: this.seed,
      level: this.level ? structuredCloneJSON(this.level) : null,
      board: this.board.toJSON(),
      tray: this.tray.map((p) => (p ? { uid: p.uid, shapeId: p.shapeId, color: p.color } : null)),
      clearedThisTray: this.clearedThisTray,
      reviveUsed: this.reviveUsed,
      newBestReached: this.newBestReached,
      status: this.status,
      goals: structuredCloneJSON(this.goals),
      rng: this.rng.getState(),
      generator: this.generator.toJSON(),
    };
    for (const key of COUNTER_KEYS) out[key] = this[key];
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /**
   * @param {number} trayIndex
   * @returns {import('./shapes.js').Shape | null} shape of a tray slot (null if empty/invalid)
   */
  shapeAt(trayIndex) {
    const piece = this.tray[trayIndex];
    return piece ? getShape(piece.shapeId) : null;
  }

  /** @returns {boolean} whether tray piece `trayIndex` fits with its top-left at (r, c) */
  canPlace(trayIndex, r, c) {
    if (this.status !== 'playing') return false;
    const shape = this.shapeAt(trayIndex);
    return !!shape && this.board.canPlace(shape, r, c);
  }

  /**
   * Ghost preview for drag & drop.
   * @returns {{ valid: boolean, rows: number[], cols: number[], cells: Array<[number, number]> }}
   */
  preview(trayIndex, r, c) {
    const shape = this.shapeAt(trayIndex);
    if (!shape) return { valid: false, rows: [], cols: [], cells: [] };
    const cells = shape.cells.map(([dr, dc]) => [r + dr, c + dc]);
    if (!this.canPlace(trayIndex, r, c)) return { valid: false, rows: [], cols: [], cells };
    const { rows, cols } = this.board.previewLines(shape, r, c);
    return { valid: true, rows, cols, cells };
  }

  /** @returns {boolean} whether the tray piece fits anywhere (false for empty slots) */
  isPiecePlaceable(trayIndex) {
    const shape = this.shapeAt(trayIndex);
    return !!shape && this.board.anyPlacement(shape);
  }

  /** @returns {boolean} status 'over' && !reviveUsed && mode !== 'tutorial' */
  canRevive() {
    return this.status === 'over' && !this.reviveUsed && this.mode !== 'tutorial';
  }

  /**
   * Tutorial: the scripted move of the current step, or – if the player used the piece
   * elsewhere – any move that clears a line. Null outside the tutorial.
   * @returns {{ trayIndex: number, r: number, c: number } | null}
   */
  tutorialHint() {
    if (this.mode !== 'tutorial' || this.status !== 'playing') return null;
    const { hint } = TUTORIAL[this.tutorialStep];
    if (this.canPlace(hint.trayIndex, hint.r, hint.c)) return { ...hint };
    const move = listValidMoves(this).find((m) => m.lines > 0);
    return move ? { trayIndex: move.trayIndex, r: move.r, c: move.c } : null;
  }

  /** @returns {0|1|2|3} stars of a won journey/daily run (0 otherwise) */
  stars() {
    if (this.status !== 'won' || !this.level) return 0;
    const [par3, par2] = this.level.par;
    if (this.piecesPlaced <= par3) return 3;
    if (this.piecesPlaced <= par2) return 2;
    return 1;
  }

  // -------------------------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------------------------

  /**
   * Places tray piece `trayIndex` with its top-left cell at (r, c).
   * @returns {PlaceResult | null} null if the move is invalid
   */
  placePiece(trayIndex, r, c) {
    if (!this.canPlace(trayIndex, r, c)) return null;
    const piece = this.tray[trayIndex];
    const shape = getShape(piece.shapeId);
    const placedCells = this.board.place(shape, r, c, piece.color);
    this.tray[trayIndex] = null;
    this.piecesPlaced++;

    const lines = this.board.findFullLines();
    const linesCount = lines.rows.length + lines.cols.length;
    const { cells: cleared, gems: gemsCollected } = this.board.clearLines(lines.rows, lines.cols);
    this.collectGems(gemsCollected);

    const placePts = placementPoints(shape.size);
    let clearPts = 0;
    let allClear = false;
    if (linesCount > 0) {
      this.combo++;
      this.movesSinceClear = 0;
      this.linesCleared += linesCount;
      this.clearedThisTray = true;
      clearPts = clearPoints(linesCount, this.combo);
      allClear = this.board.isBoardEmpty();
      if (allClear) this.allClears++;
    } else {
      this.movesSinceClear++;
      if (this.movesSinceClear >= COMBO_KEEP_MOVES) this.combo = 0;
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const allClearBonus = allClear ? ALL_CLEAR_BONUS : 0;
    const totalPoints = placePts + clearPts + allClearBonus;
    this.score += totalPoints;
    if (this.goals.score) this.goals.score.have = Math.min(this.score, this.goals.score.need);

    let newBest = false;
    if (!this.newBestReached && this.bestScore > 0 && this.score > this.bestScore) {
      this.newBestReached = true;
      newBest = true;
    }

    const trayRefilled = this.mode === 'tutorial'
      ? this.advanceTutorial(linesCount > 0)
      : this.refillIfEmpty();
    if (this.mode !== 'tutorial') this.updateStatus();

    return {
      trayIndex,
      piece,
      r,
      c,
      placedCells,
      placePoints: placePts,
      lines,
      linesCount,
      cleared,
      gemsCollected,
      combo: this.combo,
      clearPoints: clearPts,
      allClear,
      allClearBonus,
      praise: praiseFor(linesCount, this.combo, allClear),
      totalPoints,
      score: this.score,
      newBest,
      trayRefilled,
      tray: this.tray.slice(),
      status: this.status,
      tutorialStep: this.tutorialStep,
    };
  }

  /**
   * Second chance after game over (once per run): clears the 2 fullest rows and the 2 fullest
   * columns and deals a tray of small/medium pieces that fit together. Gems removed this way
   * count toward the goals.
   * @returns {{ cleared: ClearedCell[], tray: Array<Piece|null>, gemsCollected: Object, status: Status } | null}
   */
  revive() {
    if (!this.canRevive()) return null;
    const rows = fullestLines(this.board, true);
    const cols = fullestLines(this.board, false);
    const { cells, gems } = this.board.clearLines(rows, cols);
    this.collectGems(gems);
    this.reviveUsed = true;
    this.trayIndex++;
    this.tray = this.generator.reviveTray(this.board);
    this.status = 'playing';
    this.updateStatus();
    return { cleared: cells, tray: this.tray.slice(), gemsCollected: gems, status: this.status };
  }

  /**
   * Hammer booster (journey/daily): clears the 3x3 area around (r, c), no score. Gems count
   * toward the goals. Also usable on a lost board (status 'over') as a rescue.
   * @returns {{ cleared: ClearedCell[], gemsCollected: Object, status: Status } | null}
   */
  useHammer(r, c) {
    if (!this.canUseBooster() || this.board.get(r, c) === OUT_OF_BOUNDS) return null;
    const area = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) area.push([r + dr, c + dc]);
    const { cells, gems } = this.board.clearCells(area);
    this.collectGems(gems);
    this.updateStatus();
    return { cleared: cells, gemsCollected: gems, status: this.status };
  }

  /**
   * Shuffle booster (journey/daily): replaces the remaining tray pieces with new ones that fit
   * together if at all possible. Also usable on a lost board (status 'over') as a rescue.
   * @returns {{ tray: Array<Piece|null>, status: Status } | null}
   */
  useShuffle() {
    if (!this.canUseBooster()) return null;
    const slots = [];
    this.tray.forEach((p, i) => { if (p) slots.push(i); });
    if (slots.length === 0) return null;
    const pieces = this.generator.shuffleTray(this.board, slots.length);
    slots.forEach((slot, k) => { this.tray[slot] = pieces[k]; });
    this.updateStatus();
    return { tray: this.tray.slice(), status: this.status };
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  /** @returns {boolean} */
  canUseBooster() {
    return BOOSTER_MODES.has(this.mode) && this.status !== 'won';
  }

  /** @returns {import('./generator.js').TrayContext} */
  trayContext() {
    return {
      score: this.score,
      trayIndex: this.trayIndex,
      traysSinceClear: this.traysSinceClear,
      combo: this.combo,
      goals: this.goals,
    };
  }

  /** @param {{1:number, 2:number, 3:number}} gems collected gems per type */
  collectGems(gems) {
    if (!this.goals.gems) return;
    for (const type of Object.keys(this.goals.gems)) {
      const g = this.goals.gems[type];
      g.have = Math.min(g.need, g.have + (gems[type] || 0));
    }
  }

  /** @returns {boolean} true if a new tray was dealt */
  refillIfEmpty() {
    if (this.tray.some((p) => p !== null)) return false;
    if (BOOSTER_MODES.has(this.mode) && this.goalsMet()) return false; // won – no new tray needed
    this.traysSinceClear = this.clearedThisTray ? 0 : this.traysSinceClear + 1;
    this.clearedThisTray = false;
    this.trayIndex++;
    this.tray = this.generator.nextTray(this.board, this.trayContext());
    return true;
  }

  /** @returns {boolean} all journey/daily goals reached */
  goalsMet() {
    const { gems, score } = this.goals;
    if (!gems && !score) return false;
    if (gems && Object.values(gems).some((g) => g.have < g.need)) return false;
    if (score && score.have < score.need) return false;
    return true;
  }

  /** Re-evaluates the status: 'won' (goals) is checked before 'over' (no piece fits). */
  updateStatus() {
    if (BOOSTER_MODES.has(this.mode) && this.goalsMet()) this.status = 'won';
    else if (!this.tray.some((p, i) => p && this.isPiecePlaceable(i))) this.status = 'over';
    else this.status = 'playing';
  }

  /** Loads the board and tray of the current tutorial step. */
  loadTutorialStep() {
    const step = TUTORIAL[this.tutorialStep];
    this.board = new Board(N);
    step.board.forEach((row, r) => {
      for (let c = 0; c < N; c++) if (row[c] !== '.') this.board.cells[r * N + c] = Number(row[c]) + 1;
    });
    this.tray = new Array(TRAY_SIZE).fill(null);
    this.tray[step.hint.trayIndex] = this.generator.createPiece(step.piece.shapeId, step.piece.color);
    this.status = 'playing';
  }

  /**
   * Tutorial progression after a placement: a clear advances to the next step (or wins after the
   * last one); if no clearing move is left the step is re-issued, so the player can't get stuck.
   * @param {boolean} cleared
   * @returns {boolean} true if a new tray (step) was loaded
   */
  advanceTutorial(cleared) {
    if (cleared) {
      if (this.tutorialStep + 1 >= TUTORIAL.length) {
        this.status = 'won';
        return false;
      }
      this.tutorialStep++;
      this.loadTutorialStep();
      return true;
    }
    if (listValidMoves(this).some((m) => m.lines > 0)) return false;
    this.loadTutorialStep();
    return true;
  }
}

/** Numeric run counters saved 1:1 by toJSON/fromJSON. */
const COUNTER_KEYS = Object.freeze([
  'score', 'combo', 'movesSinceClear', 'piecesPlaced', 'linesCleared', 'maxCombo', 'allClears',
  'trayIndex', 'traysSinceClear', 'bestScore', 'tutorialStep',
]);

/**
 * Indices of the 2 fullest rows (or columns); ties go to the lower index.
 * @param {Board} board
 * @param {boolean} rows
 * @returns {number[]}
 */
function fullestLines(board, rows) {
  const n = board.size;
  const counts = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n; j++) if (board.cells[rows ? i * n + j : j * n + i] !== 0) k++;
    counts.push({ i, k });
  }
  counts.sort((a, b) => b.k - a.k || a.i - b.i);
  return counts.slice(0, 2).map((x) => x.i);
}

/** @template T @param {T} obj @returns {T} deep copy of plain JSON data */
function structuredCloneJSON(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Every valid move of the current tray (for bots, hints and the debug API).
 * @param {GameSession} session
 * @returns {Array<{ trayIndex: number, r: number, c: number, lines: number, cells: number }>}
 *   `lines` = rows + columns that the move would clear, `cells` = piece size
 */
export function listValidMoves(session) {
  const out = [];
  if (session.status !== 'playing') return out;
  session.tray.forEach((piece, trayIndex) => {
    if (!piece) return;
    const shape = getShape(piece.shapeId);
    for (const [r, c] of session.board.placements(shape)) {
      const { rows, cols } = session.board.previewLines(shape, r, c);
      out.push({ trayIndex, r, c, lines: rows.length + cols.length, cells: shape.size });
    }
  });
  return out;
}
