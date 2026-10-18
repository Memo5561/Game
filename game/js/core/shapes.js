// Piece shapes (see docs/ARCHITECTURE.md §3 and §4.2).
//
// `tier` describes how hard a shape is to fit on a crowded board: 1 = small (1–3 cells),
// 2 = medium (4 cells), 3 = big or awkward (5–6 cells, S/Z), 4 = huge (3x3).
// `family` groups the orientations of one shape; how often a family is dealt depends on the
// difficulty (CONFIG.GENERATOR.FAMILY_WEIGHTS) and is shared evenly by its orientations.

import { CONFIG } from '../config.js';

/**
 * @typedef {Object} Shape
 * @property {string} id      readable id, e.g. 'I3h', 'O2', 'L4c'
 * @property {string} family  '1x1'|'I2'|'I3'|'L3'|'O2'|'I4'|'T'|'L4'|'SZ'|'R23'|'I5'|'L5'|'O3'
 * @property {ReadonlyArray<ReadonlyArray<number>>} cells normalized [r, c] pairs (min r = 0, min c = 0)
 * @property {number} w       width in cells
 * @property {number} h       height in cells
 * @property {number} size    number of cells
 * @property {1|2|3|4} tier   difficulty class
 */

/** [id, family, tier, pattern] – '#' = cell, '.' = gap. */
const DEFS = [
  ['I1', '1x1', 1, ['#']],
  ['I2h', 'I2', 1, ['##']],
  ['I2v', 'I2', 1, ['#', '#']],
  ['I3h', 'I3', 1, ['###']],
  ['I3v', 'I3', 1, ['#', '#', '#']],
  ['L3a', 'L3', 1, ['#.', '##']],
  ['L3b', 'L3', 1, ['##', '#.']],
  ['L3c', 'L3', 1, ['##', '.#']],
  ['L3d', 'L3', 1, ['.#', '##']],

  ['O2', 'O2', 2, ['##', '##']],
  ['I4h', 'I4', 2, ['####']],
  ['I4v', 'I4', 2, ['#', '#', '#', '#']],
  ['T4a', 'T', 2, ['###', '.#.']],
  ['T4b', 'T', 2, ['.#.', '###']],
  ['T4c', 'T', 2, ['#.', '##', '#.']],
  ['T4d', 'T', 2, ['.#', '##', '.#']],
  ['L4a', 'L4', 2, ['#.', '#.', '##']],
  ['L4b', 'L4', 2, ['###', '#..']],
  ['L4c', 'L4', 2, ['##', '.#', '.#']],
  ['L4d', 'L4', 2, ['..#', '###']],
  ['J4a', 'L4', 2, ['.#', '.#', '##']],
  ['J4b', 'L4', 2, ['#..', '###']],
  ['J4c', 'L4', 2, ['##', '#.', '#.']],
  ['J4d', 'L4', 2, ['###', '..#']],

  ['S4h', 'SZ', 3, ['.##', '##.']],
  ['S4v', 'SZ', 3, ['#.', '##', '.#']],
  ['Z4h', 'SZ', 3, ['##.', '.##']],
  ['Z4v', 'SZ', 3, ['.#', '##', '#.']],
  ['R2x3', 'R23', 3, ['###', '###']],
  ['R3x2', 'R23', 3, ['##', '##', '##']],
  ['I5h', 'I5', 3, ['#####']],
  ['I5v', 'I5', 3, ['#', '#', '#', '#', '#']],
  ['L5a', 'L5', 3, ['#..', '#..', '###']],
  ['L5b', 'L5', 3, ['###', '#..', '#..']],
  ['L5c', 'L5', 3, ['###', '..#', '..#']],
  ['L5d', 'L5', 3, ['..#', '..#', '###']],

  ['O3', 'O3', 4, ['###', '###', '###']],
];

/**
 * @param {string} id
 * @param {string} family
 * @param {number} tier
 * @param {string[]} pattern
 * @returns {Readonly<Shape>}
 */
function makeShape(id, family, tier, pattern) {
  const cells = [];
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (pattern[r][c] === '#') cells.push(Object.freeze([r, c]));
    }
  }
  const h = pattern.length;
  const w = Math.max(...pattern.map((row) => row.length));
  return Object.freeze({ id, family, cells: Object.freeze(cells), w, h, size: cells.length, tier });
}

/** @type {ReadonlyArray<Readonly<Shape>>} every shape of the game */
export const SHAPES = Object.freeze(DEFS.map(([id, family, tier, pattern]) => makeShape(id, family, tier, pattern)));

/** @type {Readonly<Record<string, Readonly<Shape>>>} */
export const SHAPE_BY_ID = Object.freeze(Object.fromEntries(SHAPES.map((s) => [s.id, s])));

/** Number of orientations per family. */
const FAMILY_SIZE = SHAPES.reduce((acc, s) => {
  acc[s.family] = (acc[s.family] || 0) + 1;
  return acc;
}, {});

/**
 * @param {string} id
 * @returns {Readonly<Shape> | undefined} the shape, or undefined for an unknown id
 */
export function getShape(id) {
  return SHAPE_BY_ID[id];
}

/**
 * Weight of a whole family at difficulty d: lerp of CONFIG.GENERATOR.FAMILY_WEIGHTS[family].
 * @param {string} family
 * @param {number} d difficulty 0..1
 * @returns {number}
 */
export function familyWeight(family, d) {
  const [w0, w1] = CONFIG.GENERATOR.FAMILY_WEIGHTS[family];
  return w0 + (w1 - w0) * d;
}

/**
 * Weight of one orientation: the family weight shared by all orientations of the family.
 * @param {Shape} shape
 * @param {number} d difficulty 0..1
 * @returns {number}
 */
export function shapeWeight(shape, d) {
  return familyWeight(shape.family, d) / FAMILY_SIZE[shape.family];
}
