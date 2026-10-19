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
 * @property {ClearedCell[]} cleared       color = palette index 0..7
 * @property {{1:number, 2:number, 3:number}} gemsCollected
 * @property {number} combo               after this placement
 * @property {number} comboBefore
 * @property {boolean} comboBroken        a combo >= 1 broke on this placement
 * @property {number} movesSinceClear
 * @property {number} comboMovesLeft      combo > 0 ? COMBO_KEEP_MOVES - movesSinceClear : 0
 * @property {number} clearPoints
 * @property {boolean} allClear
 * @property {number} allClearBonus
 * @property {null|string} praise
 * @property {number} totalPoints
 * @property {number} score               score after this placement
 * @property {boolean} newBest            classic: score passed bestScore (> 0) for the first time this run
 * @property {boolean} trayRefilled
 * @property {Array<Piece|null>} tray     current tray (after a refill)
 * @property {boolean[]} placeable        per tray slot: the piece fits somewhere
 * @property {Goals} goals
 * @property {Status} status
 * @property {{ done: boolean, hasNext: boolean } | null} tutorialStep tutorial only
 *
 * @typedef {{ cleared: ClearedCell[], gemsCollected: Object, tray: Array<Piece|null>,
 *   placeable: boolean[], goals: Goals, status: Status }} ReviveResult
 * @typedef {{ cleared: ClearedCell[], gemsCollected: Object, placeable: boolean[], goals: Goals,
 *   status: Status }} BoosterResult
 */

/** Version of the toJSON() format; fromJSON() rejects other versions. */
export const SESSION_VERSION = 1;
export const MODES = Object.freeze(['classic', 'journey', 'daily', 'tutorial']);
const LEVEL_MODES = new Set(['journey', 'daily']);
const BOOSTERS = new Set(['hammer', 'shuffle']);
const STATUSES = new Set(['playing', 'over', 'won']);
const N = CONFIG.BOARD_SIZE;
const TRAY_SIZE = CONFIG.TRAY_SIZE;
const { COMBO_KEEP_MOVES, ALL_CLEAR_BONUS } = CONFIG.SCORING;
const { MERCY_AFTER_REVIVE, ASSIST } = CONFIG.GENERATOR;

/**
 * Scripted tutorial steps. Board rows: '.' = empty, digit = color index. The single tray piece
 * sits in the slot of `hint`, and only the hinted move is accepted. Step 1 clears a row, step 2 a
 * column, step 3 a row and a column at once; step 3 keeps the combo of step 2 → "Combo x2".
 */
const TUTORIAL = Object.freeze([
  {
    board: ['........', '........', '........', '........', '012..567', '..2345..', '........', '........'],
    piece: { shapeId: 'I2h', color: 3 },
    hint: { trayIndex: 1, r: 4, c: 3 },
    keepCombo: false,
  },
  {
    board: ['...5....', '...5....', '........', '........', '........', '...5....', '..15....', '..15....'],
    piece: { shapeId: 'I3v', color: 2 },
    hint: { trayIndex: 1, r: 2, c: 3 },
    keepCombo: false,
  },
  {
    board: ['6....33.', '6....33.', '6.......', '6.......', '6.......', '........', '........', '...22222'],
    piece: { shapeId: 'L5a', color: 4 },
    hint: { trayIndex: 1, r: 5, c: 0 },
    keepCombo: true,
  },
]);

/** Number of scripted tutorial steps. */
export const TUTORIAL_STEP_COUNT = TUTORIAL.length;

/** Numeric run state saved 1:1 by toJSON/fromJSON. */
const COUNTER_KEYS = Object.freeze([
  'score', 'combo', 'movesSinceClear', 'traysSinceClear', 'trayIndex', 'piecesPlaced', 'linesCleared',
  'maxCombo', 'allClears', 'experience', 'bestScore', 'mercyTrays', 'tutorialStep',
]);
/** Counters added later: older saves lack them (default 0 instead of rejecting the run). */
const OPTIONAL_COUNTER_KEYS = Object.freeze(['shortRunStreak']);
/** Boolean run state saved 1:1 by toJSON/fromJSON. */
const FLAG_KEYS = Object.freeze(['reviveUsed', 'clearedThisTray', 'newBestReached', 'tutorialStepDone']);

export class GameSession {
  /** Use `GameSession.create()` or `GameSession.fromJSON()`. */
  constructor() {
    /** @type {Mode} */
    this.mode = 'classic';
    /** uint32 seed of this run */
    this.seed = 0;
    /** @type {LevelDef|null} */
    this.level = null;
    /** @type {Board} */
    this.board = new Board(N);
    /** @type {Array<Piece|null>} */
    this.tray = new Array(TRAY_SIZE).fill(null);
    this.score = 0;
    this.combo = 0;
    this.movesSinceClear = 0;
    /** completed trays in a row without any clear */
    this.traysSinceClear = 0;
    /** index of the current tray (0 = first) */
    this.trayIndex = 0;
    this.piecesPlaced = 0;
    this.linesCleared = 0;
    this.maxCombo = 0;
    this.allClears = 0;
    this.reviveUsed = false;
    /** finished games of the player when the run started (longer generous phase for new players) */
    this.experience = 0;
    /** best score before this run (unchanged during the run) */
    this.bestScore = 0;
    /** very short classic runs in a row before this one (>= SHORT_RUNS_FOR_EASY_START → generous start) */
    this.shortRunStreak = 0;
    /** @type {Status} */
    this.status = 'playing';
    /** @type {Goals} */
    this.goals = {};
    /** extra: trays of mercy left (after a revive) */
    this.mercyTrays = 0;
    /** extra: whether the current tray produced a clear so far */
    this.clearedThisTray = false;
    /** extra: true once the score passed bestScore in this run */
    this.newBestReached = false;
    /** extra: tutorial step index 0..TUTORIAL_STEP_COUNT-1 */
    this.tutorialStep = 0;
    /** extra: the current tutorial step was completed (waiting for nextTutorialStep) */
    this.tutorialStepDone = false;
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
   * @param {number} [opts.bestScore=0] classic best score so far (for `newBest`)
   * @param {number} [opts.gamesPlayed=0] finished games of the player (→ `experience`)
   * @param {number} [opts.shortRunStreak=0] very short classic runs in a row (gentler start)
   * @returns {GameSession}
   */
  static create({ mode = 'classic', seed, level = null, bestScore = 0, gamesPlayed = 0, shortRunStreak = 0 } = {}) {
    if (!MODES.includes(mode)) throw new Error(`GameSession.create: unknown mode ${mode}`);
    const needsLevel = LEVEL_MODES.has(mode);
    if (needsLevel && !level) throw new Error(`GameSession.create: mode ${mode} needs a level`);
    const s = new GameSession();
    s.mode = mode;
    s.seed = (seed === undefined || seed === null ? randomSeed() : seed) >>> 0;
    s.rng = new RNG(s.seed);
    s.generator = new PieceGenerator({ rng: s.rng, mode });
    s.level = needsLevel ? cloneData(level) : null;
    s.bestScore = Math.max(0, bestScore || 0);
    s.experience = Math.max(0, gamesPlayed || 0);
    s.shortRunStreak = mode === 'classic' ? Math.max(0, shortRunStreak || 0) : 0;

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
    s.tray = s.dealTray();
    s.updateStatus();
    return s;
  }

  /**
   * Restores a run saved with `toJSON()`. Continuing produces exactly the same future trays.
   * @param {Object} json
   * @returns {GameSession}
   * @throws {Error} on incompatible or corrupted data (the caller drops the run)
   */
  static fromJSON(json) {
    if (!json || json.v !== SESSION_VERSION || !MODES.includes(json.mode)) {
      throw new Error('GameSession.fromJSON: incompatible save data');
    }
    if (LEVEL_MODES.has(json.mode) && !(json.level && Array.isArray(json.level.prefilled))) {
      throw new Error('GameSession.fromJSON: level missing');
    }
    if (!Array.isArray(json.tray) || json.tray.length !== TRAY_SIZE) throw new Error('GameSession.fromJSON: invalid tray');
    if (!STATUSES.has(json.status)) throw new Error('GameSession.fromJSON: invalid status');
    const s = new GameSession();
    s.mode = json.mode;
    s.seed = json.seed >>> 0;
    s.level = LEVEL_MODES.has(json.mode) ? cloneData(json.level) : null;
    s.board = Board.fromJSON(json.board);
    s.tray = json.tray.map((p) => {
      if (p === null) return null;
      if (!p || !getShape(p.shapeId) || !Number.isInteger(p.uid) || !Number.isInteger(p.color)) {
        throw new Error('GameSession.fromJSON: invalid piece');
      }
      return Object.freeze({ uid: p.uid, shapeId: p.shapeId, color: p.color });
    });
    for (const key of COUNTER_KEYS) {
      const v = json[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`GameSession.fromJSON: invalid ${key}`);
      s[key] = v;
    }
    for (const key of OPTIONAL_COUNTER_KEYS) {
      const v = json[key];
      s[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }
    for (const key of FLAG_KEYS) s[key] = !!json[key];
    if (s.mode === 'tutorial' && !(s.tutorialStep >= 0 && s.tutorialStep < TUTORIAL.length)) {
      throw new Error('GameSession.fromJSON: invalid tutorial step');
    }
    s.status = json.status;
    s.goals = cloneData(json.goals || {});
    s.rng = new RNG(0);
    s.rng.setState(json.rng);
    s.generator = PieceGenerator.fromJSON(json.generator, s.rng);
    return s;
  }

  /** @returns {Object} plain JSON-safe snapshot of everything needed to resume exactly */
  toJSON() {
    const out = {
      v: SESSION_VERSION,
      mode: this.mode,
      seed: this.seed,
      level: this.level ? cloneData(this.level) : null,
      board: this.board.toJSON(),
      tray: this.trayCopy(),
      status: this.status,
      goals: cloneData(this.goals),
      rng: this.rng.getState(),
      generator: this.generator.toJSON(),
    };
    for (const key of COUNTER_KEYS) out[key] = this[key];
    for (const key of OPTIONAL_COUNTER_KEYS) out[key] = this[key];
    for (const key of FLAG_KEYS) out[key] = this[key];
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

  /**
   * Whether tray piece `trayIndex` may be placed with its top-left at (r, c) right now. In the
   * tutorial only the hinted move is allowed.
   * @returns {boolean}
   */
  canPlace(trayIndex, r, c) {
    return this.status === 'playing' && this.fits(trayIndex, r, c);
  }

  /**
   * Ghost preview for drag & drop.
   * @returns {{ valid: boolean, rows: number[], cols: number[] }}
   */
  preview(trayIndex, r, c) {
    if (!this.canPlace(trayIndex, r, c)) return { valid: false, rows: [], cols: [] };
    const { rows, cols } = this.board.previewLines(this.shapeAt(trayIndex), r, c);
    return { valid: true, rows, cols };
  }

  /** @returns {boolean} whether the tray piece fits anywhere (false for empty slots) */
  isPiecePlaceable(trayIndex) {
    const shape = this.shapeAt(trayIndex);
    if (!shape) return false;
    if (this.mode === 'tutorial') {
      const { hint } = TUTORIAL[this.tutorialStep];
      return this.fits(trayIndex, hint.r, hint.c);
    }
    return this.board.anyPlacement(shape);
  }

  /** @returns {boolean[]} per tray slot: the piece fits somewhere */
  placeable() {
    return this.tray.map((_, i) => this.isPiecePlaceable(i));
  }

  /** @returns {boolean} status 'over' && !reviveUsed && mode !== 'tutorial' */
  canRevive() {
    return this.status === 'over' && !this.reviveUsed && this.mode !== 'tutorial';
  }

  /**
   * @param {'hammer'|'shuffle'} type
   * @returns {boolean} journey/daily run that is playing or lost (boosters can rescue it)
   */
  canUseBooster(type) {
    return BOOSTERS.has(type) && LEVEL_MODES.has(this.mode) && (this.status === 'playing' || this.status === 'over');
  }

  /** @returns {{ trayIndex: number, r: number, c: number } | null} the scripted tutorial move */
  tutorialHint() {
    if (this.mode !== 'tutorial' || this.status !== 'playing' || this.tutorialStepDone) return null;
    return { ...TUTORIAL[this.tutorialStep].hint };
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
   * Order: place → clear lines → score/combo → goals → won (no refill) | refill → game over.
   * @returns {PlaceResult | null} null unless status is 'playing' and the move is valid
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

    const comboBefore = this.combo;
    let comboBroken = false;
    let clearPts = 0;
    let allClear = false;
    if (linesCount > 0) {
      this.combo++;
      this.movesSinceClear = 0;
      this.traysSinceClear = 0;
      this.clearedThisTray = true;
      this.linesCleared += linesCount;
      clearPts = clearPoints(linesCount, this.combo);
      allClear = this.board.isBoardEmpty();
      if (allClear) this.allClears++;
    } else {
      this.movesSinceClear++;
      if (this.movesSinceClear >= COMBO_KEEP_MOVES && this.combo > 0) {
        this.combo = 0;
        comboBroken = true;
      }
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const placePts = placementPoints(shape.size);
    const allClearBonus = allClear ? ALL_CLEAR_BONUS : 0;
    const totalPoints = placePts + clearPts + allClearBonus;
    this.score += totalPoints;

    let newBest = false;
    if (this.mode === 'classic' && !this.newBestReached && this.bestScore > 0 && this.score > this.bestScore) {
      this.newBestReached = true;
      newBest = true;
    }

    this.collectGems(gemsCollected);
    let trayRefilled = false;
    let tutorialStep = null;
    if (this.mode === 'tutorial') {
      // Only the hinted (clearing) move is accepted, so every tutorial placement completes its step.
      this.tutorialStepDone = true;
      const hasNext = this.tutorialStep + 1 < TUTORIAL.length;
      if (!hasNext) this.status = 'won';
      tutorialStep = { done: true, hasNext };
    } else if (this.goalsMet()) {
      this.status = 'won';
    } else {
      trayRefilled = this.refillIfEmpty();
      this.updateStatus();
    }

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
      comboBefore,
      comboBroken,
      movesSinceClear: this.movesSinceClear,
      comboMovesLeft: this.comboMovesLeft(),
      clearPoints: clearPts,
      allClear,
      allClearBonus,
      praise: praiseFor(linesCount, comboBefore, this.combo, allClear),
      totalPoints,
      score: this.score,
      newBest,
      trayRefilled,
      tray: this.trayCopy(),
      placeable: this.placeable(),
      goals: cloneData(this.goals),
      status: this.status,
      tutorialStep,
    };
  }

  /**
   * Second chance after game over (once per run, not in the tutorial): clears the 2 fullest rows
   * and the 2 fullest columns (no points), resets the combo, grants MERCY_AFTER_REVIVE mercy trays
   * and deals small/medium pieces that fit together. Gems cleared count toward the goals.
   * @returns {ReviveResult | null}
   */
  revive() {
    if (!this.canRevive()) return null;
    const rows = fullestLines(this.board, true);
    const cols = fullestLines(this.board, false);
    const { cells, gems } = this.board.clearLines(rows, cols);
    this.collectGems(gems);
    this.combo = 0;
    this.movesSinceClear = 0;
    this.traysSinceClear = 0;
    this.reviveUsed = true;
    this.mercyTrays = MERCY_AFTER_REVIVE;
    this.tray = this.generator.reviveTray(this.board);
    this.updateStatus();
    return {
      cleared: cells,
      gemsCollected: gems,
      tray: this.trayCopy(),
      placeable: this.placeable(),
      goals: cloneData(this.goals),
      status: this.status,
    };
  }

  /**
   * Hammer booster (journey/daily): clears the filled cells of the 3x3 area around (r, c), no
   * score, combo untouched. Gems count toward the goals. Can rescue a lost run.
   * @returns {BoosterResult | null} null if not allowed or no filled cell in the area (the caller
   *   then does not consume the booster)
   */
  useHammer(r, c) {
    if (!this.canUseBooster('hammer') || this.board.get(r, c) === OUT_OF_BOUNDS) return null;
    const area = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const v = this.board.get(r + dr, c + dc);
        if (v !== 0 && v !== OUT_OF_BOUNDS) area.push([r + dr, c + dc]);
      }
    }
    if (area.length === 0) return null;
    const { cells, gems } = this.board.clearCells(area);
    this.collectGems(gems);
    this.updateStatus();
    return { cleared: cells, gemsCollected: gems, placeable: this.placeable(), goals: cloneData(this.goals), status: this.status };
  }

  /**
   * Shuffle booster (journey/daily): replaces the remaining tray pieces with new ones that fit
   * together if at all possible. Can rescue a lost run.
   * @returns {{ tray: Array<Piece|null>, placeable: boolean[], status: Status } | null}
   */
  useShuffle() {
    if (!this.canUseBooster('shuffle')) return null;
    const slots = [];
    this.tray.forEach((p, i) => { if (p) slots.push(i); });
    if (slots.length === 0) return null;
    const pieces = this.generator.shuffleTray(this.board, slots.length);
    slots.forEach((slot, k) => { this.tray[slot] = pieces[k]; });
    this.updateStatus();
    return { tray: this.trayCopy(), placeable: this.placeable(), status: this.status };
  }

  /**
   * Tutorial: loads the next scripted step after the current one was completed.
   * @returns {{ board: Board, tray: Array<Piece|null> } | null} copies of the new board and tray,
   *   or null if there is no next step (or the current one is not done yet)
   */
  nextTutorialStep() {
    if (this.mode !== 'tutorial' || !this.tutorialStepDone || this.tutorialStep + 1 >= TUTORIAL.length) return null;
    this.tutorialStep++;
    this.loadTutorialStep();
    return { board: this.board.clone(), tray: this.trayCopy() };
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  /**
   * Like canPlace but independent of the status (used for the game-over check).
   * @returns {boolean}
   */
  fits(trayIndex, r, c) {
    const shape = this.shapeAt(trayIndex);
    if (!shape || !this.board.canPlace(shape, r, c)) return false;
    if (this.mode !== 'tutorial') return true;
    const { hint } = TUTORIAL[this.tutorialStep];
    return !this.tutorialStepDone && hint.trayIndex === trayIndex && hint.r === r && hint.c === c;
  }

  /** @returns {number} pips left before the combo breaks */
  comboMovesLeft() {
    return this.combo > 0 ? COMBO_KEEP_MOVES - this.movesSinceClear : 0;
  }

  /** @returns {Array<Piece|null>} */
  trayCopy() {
    return this.tray.slice();
  }

  /**
   * Near-record assist: classic, a meaningful best, score within [NEAR_RECORD_FROM × best, best).
   * Ends the moment the record is broken. @returns {boolean}
   */
  isNearRecord() {
    const a = this.generator.config.ASSIST || ASSIST; // the generator's config may be overridden (tools/simulate.mjs)
    return this.mode === 'classic' && this.bestScore >= a.MIN_BEST
      && this.score >= a.NEAR_RECORD_FROM * this.bestScore && this.score < this.bestScore;
  }

  /** @returns {Piece[]} next tray from the generator (consumes one mercy tray) */
  dealTray() {
    const tray = this.generator.nextTray(this.board, {
      score: this.score,
      trayIndex: this.trayIndex,
      traysSinceClear: this.traysSinceClear,
      combo: this.combo,
      fill: this.board.fillRatio(),
      experience: this.experience,
      mercyTrays: this.mercyTrays,
      level: this.level || undefined,
      goals: this.goals,
      nearRecord: this.isNearRecord(),
      assistedStart: this.mode === 'classic' && this.shortRunStreak >= (this.generator.config.ASSIST || ASSIST).SHORT_RUNS_FOR_EASY_START,
    });
    if (this.mercyTrays > 0) this.mercyTrays--;
    return tray;
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
    if (!this.clearedThisTray) this.traysSinceClear++;
    this.clearedThisTray = false;
    this.trayIndex++;
    this.tray = this.dealTray();
    return true;
  }

  /** @returns {boolean} all journey/daily goals reached (updates the score goal first) */
  goalsMet() {
    const { gems, score } = this.goals;
    if (score) score.have = Math.min(this.score, score.need);
    if (!gems && !score) return false;
    if (gems && Object.values(gems).some((g) => g.have < g.need)) return false;
    return !score || score.have >= score.need;
  }

  /** Re-evaluates the status: 'won' (goals) before 'over' (no tray piece fits anywhere). */
  updateStatus() {
    if (LEVEL_MODES.has(this.mode) && this.goalsMet()) this.status = 'won';
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
    if (!step.keepCombo) {
      this.combo = 0;
      this.movesSinceClear = 0;
    }
    this.tutorialStepDone = false;
    this.status = 'playing';
  }
}

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
function cloneData(obj) {
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
  session.tray.forEach((piece, trayIndex) => {
    if (!piece) return;
    const shape = getShape(piece.shapeId);
    for (const [r, c] of session.board.placements(shape)) {
      if (!session.canPlace(trayIndex, r, c)) continue;
      const { rows, cols } = session.board.previewLines(shape, r, c);
      out.push({ trayIndex, r, c, lines: rows.length + cols.length, cells: shape.size });
    }
  });
  return out;
}
