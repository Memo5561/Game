// The playing field (see docs/ARCHITECTURE.md §3 and §4.3).
// Cells store `colorIndex + 1` (0 = empty); gems sit on filled cells and are removed with them.

import { CONFIG } from '../config.js';

/**
 * @typedef {import('./shapes.js').Shape} Shape
 * @typedef {{ r: number, c: number, color: number, gem: number }} ClearedCell
 *   `color` is the palette color index (0..7) the cell had, `gem` its gem type (0 = none)
 * @typedef {{ cells: ClearedCell[], gems: { 1: number, 2: number, 3: number } }} ClearResult
 * @typedef {{ rows: number[], cols: number[] }} Lines
 */

/** Value returned by `get()` for coordinates outside the board (treated as blocked). */
export const OUT_OF_BOUNDS = 255;

export class Board {
  /** @param {number} [size] edge length in cells */
  constructor(size = CONFIG.BOARD_SIZE) {
    /** @type {number} */
    this.size = size;
    /** @type {Uint8Array} 0 empty, 1..8 = colorIndex + 1 */
    this.cells = new Uint8Array(size * size);
    /** @type {Uint8Array} 0 none, 1..3 gem type (only on filled cells) */
    this.gems = new Uint8Array(size * size);
    /** @type {Uint8Array | null} scratch buffer for previewLines (lazily created) */
    this._scratch = null;
  }

  /**
   * @param {number} r
   * @param {number} c
   * @returns {number} 0 (empty), colorIndex + 1, or OUT_OF_BOUNDS (255)
   */
  get(r, c) {
    const n = this.size;
    if (r < 0 || c < 0 || r >= n || c >= n) return OUT_OF_BOUNDS;
    return this.cells[r * n + c];
  }

  /** @returns {boolean} true if (r, c) is on the board and empty */
  isEmpty(r, c) {
    return this.get(r, c) === 0;
  }

  /**
   * Whether `shape` fits with its top-left corner at (r, c). Allocation free (hot path).
   * @param {Shape} shape
   * @param {number} r
   * @param {number} c
   * @returns {boolean}
   */
  canPlace(shape, r, c) {
    const n = this.size;
    if (r < 0 || c < 0 || r + shape.h > n || c + shape.w > n) return false;
    const cells = shape.cells;
    const grid = this.cells;
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k];
      if (grid[(r + cell[0]) * n + c + cell[1]] !== 0) return false;
    }
    return true;
  }

  /**
   * Writes the shape onto the board (caller must have checked `canPlace`).
   * @param {Shape} shape
   * @param {number} r
   * @param {number} c
   * @param {number} color palette color index 0..7
   * @returns {Array<[number, number]>} the board cells that were filled
   */
  place(shape, r, c, color) {
    const n = this.size;
    const placed = [];
    for (const [dr, dc] of shape.cells) {
      const rr = r + dr;
      const cc = c + dc;
      this.cells[rr * n + cc] = color + 1;
      placed.push([rr, cc]);
    }
    return placed;
  }

  /** @returns {Lines} all rows and columns that are completely filled */
  findFullLines() {
    return fullLinesOf(this.cells, this.size, 0, this.size, 0, this.size);
  }

  /**
   * Lines that would be full after placing `shape` at (r, c), without mutating the board.
   * Returns empty lists when the shape does not fit.
   * @param {Shape} shape
   * @param {number} r
   * @param {number} c
   * @returns {Lines}
   */
  previewLines(shape, r, c) {
    if (!this.canPlace(shape, r, c)) return { rows: [], cols: [] };
    const n = this.size;
    if (!this._scratch) this._scratch = new Uint8Array(n * n);
    const tmp = this._scratch;
    tmp.set(this.cells);
    for (let k = 0; k < shape.cells.length; k++) {
      const cell = shape.cells[k];
      tmp[(r + cell[0]) * n + c + cell[1]] = 1;
    }
    // Only lines crossing the shape's bounding box can have become full.
    return fullLinesOf(tmp, n, r, r + shape.h, c, c + shape.w);
  }

  /**
   * Clears all cells of the given rows and columns at once. A cell at a row/column intersection
   * is reported once.
   * @param {number[]} rows
   * @param {number[]} cols
   * @returns {ClearResult}
   */
  clearLines(rows, cols) {
    const n = this.size;
    const list = [];
    for (const r of rows) for (let c = 0; c < n; c++) list.push([r, c]);
    for (const c of cols) for (let r = 0; r < n; r++) list.push([r, c]);
    return this.clearCells(list);
  }

  /**
   * Generic removal (boosters, revive). Empty, out-of-bounds and duplicate cells are skipped, so
   * only cells that actually held a block are reported.
   * @param {Array<[number, number]>} list
   * @returns {ClearResult}
   */
  clearCells(list) {
    const n = this.size;
    const cells = [];
    const gems = { 1: 0, 2: 0, 3: 0 };
    for (const [r, c] of list) {
      if (r < 0 || c < 0 || r >= n || c >= n) continue;
      const i = r * n + c;
      const v = this.cells[i];
      if (v === 0) continue; // empty or already cleared by this call (dedupes intersections)
      const gem = this.gems[i];
      cells.push({ r, c, color: v - 1, gem });
      if (gem) gems[gem]++;
      this.cells[i] = 0;
      this.gems[i] = 0;
    }
    return { cells, gems };
  }

  /**
   * @param {Shape} shape
   * @returns {boolean} true if the shape fits somewhere
   */
  anyPlacement(shape) {
    const maxR = this.size - shape.h;
    const maxC = this.size - shape.w;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (this.canPlace(shape, r, c)) return true;
      }
    }
    return false;
  }

  /**
   * @param {Shape} shape
   * @returns {Array<[number, number]>} every top-left position where the shape fits (row-major)
   */
  placements(shape) {
    const out = [];
    const maxR = this.size - shape.h;
    const maxC = this.size - shape.w;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (this.canPlace(shape, r, c)) out.push([r, c]);
      }
    }
    return out;
  }

  /** @returns {number} number of filled cells */
  filledCount() {
    let count = 0;
    const grid = this.cells;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== 0) count++;
    return count;
  }

  /** @returns {number} filled cells / all cells (0..1) */
  fillRatio() {
    return this.filledCount() / this.cells.length;
  }

  /** @returns {boolean} true if no cell is filled */
  isBoardEmpty() {
    const grid = this.cells;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== 0) return false;
    return true;
  }

  /** @returns {{ 1: number, 2: number, 3: number }} remaining gems per type */
  gemCount() {
    const out = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      if (g) out[g]++;
    }
    return out;
  }

  /** @returns {Board} deep copy */
  clone() {
    const b = new Board(this.size);
    b.cells.set(this.cells);
    b.gems.set(this.gems);
    return b;
  }

  /** @returns {{ size: number, cells: number[], gems: number[] }} */
  toJSON() {
    return { size: this.size, cells: Array.from(this.cells), gems: Array.from(this.gems) };
  }

  /**
   * @param {{ size: number, cells: number[], gems?: number[] }} obj
   * @returns {Board}
   */
  static fromJSON(obj) {
    const size = obj.size;
    if (!Number.isInteger(size) || size <= 0 || !Array.isArray(obj.cells) || obj.cells.length !== size * size) {
      throw new Error('Board.fromJSON: invalid board data');
    }
    const b = new Board(size);
    b.cells.set(obj.cells);
    if (Array.isArray(obj.gems) && obj.gems.length === size * size) b.gems.set(obj.gems);
    // A gem can only exist on a filled cell.
    for (let i = 0; i < b.gems.length; i++) if (b.cells[i] === 0) b.gems[i] = 0;
    return b;
  }
}

/**
 * Full rows within [r0, r1) and full columns within [c0, c1) of a size×size grid.
 * @param {Uint8Array} grid
 * @param {number} n
 * @param {number} r0
 * @param {number} r1
 * @param {number} c0
 * @param {number} c1
 * @returns {Lines}
 */
function fullLinesOf(grid, n, r0, r1, c0, c1) {
  const rows = [];
  const cols = [];
  for (let r = r0; r < r1; r++) {
    let full = true;
    for (let c = 0; c < n; c++) {
      if (grid[r * n + c] === 0) { full = false; break; }
    }
    if (full) rows.push(r);
  }
  for (let c = c0; c < c1; c++) {
    let full = true;
    for (let r = 0; r < n; r++) {
      if (grid[r * n + c] === 0) { full = false; break; }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}
