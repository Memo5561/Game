// Canvas layout (docs/ARCHITECTURE.md §4.12 "Layout inside the canvas"). Pure function, no DOM.
//
// Portrait (w/h < 1): board on top, 3 tray slots in a row below.
// Landscape (w/h >= 1): board left, vertical tray column right.
// A non-interactive bottom gutter of max(16 px, 0.5 cell) sits below the tray hit rects and side
// margins of max(16 px, gesture inset) keep pickups away from the system back-gesture zones.

/** Board frame padding around the 8x8 cells, in cells (frame drawn by the sprite painter). */
export const BOARD_PAD = 0.24;
/** Preferred tray cell size relative to the board cell. */
export const TRAY_RATIO = 0.6;
/** Smallest acceptable tray/board ratio – the board shrinks rather than going below. */
export const TRAY_RATIO_MIN = 0.5;
/** Longest piece edge in cells (I5). */
const MAX_PIECE = 5;
/** Share of a slot a 5-cell piece may fill. */
const SLOT_FILL = 0.94;

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 * @typedef {Object} Layout
 * @property {number} cell        board cell size (CSS px, device-pixel aligned)
 * @property {number} boardX      left of cell (0,0)
 * @property {number} boardY      top of cell (0,0)
 * @property {number} boardPx     8 * cell
 * @property {Rect[]} trayRects   hit/draw rects of the 3 slots (exclude gutter and side margins);
 *                                each also carries `cy`, the vertical centre its piece is drawn at
 * @property {number} trayCell    tray cell size
 * @property {boolean} trayVertical
 * @property {boolean} landscape
 * @property {number} width       canvas CSS width (extra)
 * @property {number} height      canvas CSS height (extra)
 * @property {number} dpr         render pixel ratio (extra)
 * @property {number} gutter      bottom gutter height (extra)
 * @property {number} marginL     left margin (extra)
 * @property {number} marginR     right margin (extra)
 * @property {number} pad         board frame padding in CSS px (extra)
 */

/** Largest value in [lo, hi] for which fits() holds (fits is monotone decreasing). */
function maxFitting(lo, hi, fits) {
  if (fits(hi)) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Computes the layout for a canvas of w × h CSS px.
 * @param {number} w
 * @param {number} h
 * @param {number} [dpr=1] used to align sizes to device pixels
 * @param {{gestureLeft?: number, gestureRight?: number}} [insets]
 * @returns {Layout}
 */
export function computeLayout(w, h, dpr = 1, insets = {}) {
  const N = 8;
  const P = BOARD_PAD;
  const mL = Math.max(16, (insets && insets.gestureLeft) || 0);
  const mR = Math.max(16, (insets && insets.gestureRight) || 0);
  const landscape = w / Math.max(1, h) >= 1;
  const snap = (v) => Math.round(v * dpr) / dpr;
  const snapDown = (v) => Math.floor(v * dpr) / dpr;
  const availW = Math.max(40, w - mL - mR);
  const gutterOf = (c) => Math.max(16, 0.5 * c);
  const topOf = (c) => Math.max(10, 0.3 * c);
  const trayRects = [];
  let cell;
  let trayCell;
  let boardX;
  let boardY;
  let gutter;

  if (!landscape) {
    const slotW = availW / 3;
    const fitTray = (slotW * SLOT_FILL) / MAX_PIECE;
    const trayCellOf = (c) => Math.min(TRAY_RATIO * c, fitTray);
    const gapOf = (c) => 0.45 * c;
    const trayHOf = (c) => MAX_PIECE * trayCellOf(c) + 0.5 * c;
    const need = (c) => topOf(c) + c * (N + 2 * P) + gapOf(c) + trayHOf(c) + gutterOf(c);
    const fits = (c) => c * (N + 2 * P) <= availW && trayCellOf(c) >= TRAY_RATIO_MIN * c - 1e-9 && need(c) <= h;
    cell = snapDown(maxFitting(4, Math.max(4, availW / (N + 2 * P)), fits));
    trayCell = snapDown(trayCellOf(cell));
    gutter = gutterOf(cell);
    const extra = Math.max(0, h - need(cell));
    const top = topOf(cell) + extra * 0.3;
    boardX = snap(mL + (availW - N * cell) / 2);
    boardY = snap(top + P * cell);
    const trayTop = boardY + N * cell + P * cell + gapOf(cell) * 0.5 + extra * 0.12;
    const trayBottom = h - gutter;
    // pieces sit in the upper part of a tall hit rect (close to the board, hit area stays generous)
    const visualH = Math.min(trayBottom - trayTop, trayHOf(cell) + gapOf(cell) * 0.5 + extra * 0.2);
    for (let i = 0; i < 3; i++) {
      trayRects.push({ x: mL + i * slotW, y: trayTop, w: slotW, h: Math.max(1, trayBottom - trayTop), cy: trayTop + visualH / 2 });
    }
  } else {
    const gapXOf = (c) => 0.7 * c;
    const slotHOf = (c) => (h - topOf(c) - gutterOf(c)) / 3;
    const trayCellOf = (c) => Math.min(TRAY_RATIO * c, (slotHOf(c) * SLOT_FILL) / MAX_PIECE);
    const trayColWOf = (c) => MAX_PIECE * trayCellOf(c) + 0.6 * c;
    const fits = (c) => {
      const panel = c * (N + 2 * P);
      return panel + 2 * topOf(c) <= h
        && panel + gapXOf(c) + trayColWOf(c) <= availW
        && trayCellOf(c) >= TRAY_RATIO_MIN * c - 1e-9;
    };
    cell = snapDown(maxFitting(4, Math.max(4, h / (N + 2 * P)), fits));
    trayCell = snapDown(trayCellOf(cell));
    gutter = gutterOf(cell);
    const panel = cell * (N + 2 * P);
    const groupW = panel + gapXOf(cell) + trayColWOf(cell);
    const x0 = mL + (availW - groupW) / 2;
    boardX = snap(x0 + P * cell);
    boardY = snap((h - N * cell) / 2);
    const trayX = x0 + panel + gapXOf(cell) * 0.5;
    const top = topOf(cell);
    const slotH = slotHOf(cell);
    for (let i = 0; i < 3; i++) {
      trayRects.push({ x: trayX, y: top + i * slotH, w: Math.max(1, w - mR - trayX), h: slotH, cy: top + (i + 0.5) * slotH });
    }
  }

  return {
    cell,
    boardX,
    boardY,
    boardPx: N * cell,
    trayRects,
    trayCell,
    trayVertical: landscape,
    landscape,
    width: w,
    height: h,
    dpr,
    gutter,
    marginL: mL,
    marginR: mR,
    pad: P * cell,
  };
}
