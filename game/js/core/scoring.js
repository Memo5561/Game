// Score and praise rules (see docs/ARCHITECTURE.md §4.4). Constants live in CONFIG.SCORING.
//
// Combo rules (applied by GameSession):
//   - combo starts at 0; a clearing placement: combo += 1, movesSinceClear = 0,
//     points = clearPoints(lines, combo)
//   - a non-clearing placement: movesSinceClear += 1; when movesSinceClear >= COMBO_KEEP_MOVES the
//     combo breaks (combo = 0)
//   - board completely empty after a clear: + ALL_CLEAR_BONUS

import { CONFIG } from '../config.js';

const { LINE_POINTS, PRAISE } = CONFIG.SCORING;
/** Extra points per line beyond the end of the LINE_POINTS table. */
const EXTRA_LINE_POINTS = 140;
/** Highest line count with its own praise entry. */
const MAX_PRAISE_LINES = 6;

/** Praise keys in ascending order of excitement (i18n: t('praise.' + key), Sfx level = index + 1). */
export const PRAISE_LEVELS = Object.freeze(['good', 'great', 'excellent', 'amazing', 'unbelievable']);

/**
 * @param {number} cellCount cells of the placed piece
 * @returns {number} points for placing a piece
 */
export function placementPoints(cellCount) {
  return cellCount;
}

/**
 * Points for clearing `lines` lines at once with the given combo (combo already incremented).
 * @param {number} lines
 * @param {number} combo
 * @returns {number}
 */
export function clearPoints(lines, combo) {
  if (lines <= 0) return 0;
  const last = LINE_POINTS.length - 1;
  const base = lines <= last ? LINE_POINTS[lines] : LINE_POINTS[last] + (lines - last) * EXTRA_LINE_POINTS;
  return base * Math.max(1, combo);
}

/**
 * Praise for a placement: the higher of the line praise (CONFIG.SCORING.PRAISE.LINES) and the combo
 * milestone reached exactly on this placement (PRAISE.COMBO_MILESTONES); an all-clear is always
 * 'unbelievable'. A plain 1-line clear without a milestone gets no praise.
 * @param {number} lines lines cleared by this placement
 * @param {number} comboBefore combo before this placement
 * @param {number} comboAfter combo after this placement
 * @param {boolean} [allClear] the board is empty after the clear
 * @returns {null | 'good' | 'great' | 'excellent' | 'amazing' | 'unbelievable'}
 */
export function praiseFor(lines, comboBefore, comboAfter, allClear = false) {
  if (lines <= 0) return null;
  if (allClear) return PRAISE_LEVELS[PRAISE_LEVELS.length - 1];
  const linePraise = PRAISE.LINES[Math.min(lines, MAX_PRAISE_LINES)] || null;
  const comboPraise = comboAfter > comboBefore ? PRAISE.COMBO_MILESTONES[comboAfter] || null : null;
  const rank = (key) => (key ? PRAISE_LEVELS.indexOf(key) : -1);
  return rank(comboPraise) > rank(linePraise) ? comboPraise : linePraise;
}
