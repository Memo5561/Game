// Deterministic, saveable pseudo random numbers (see docs/ARCHITECTURE.md §4.1).
// All core logic draws randomness from an RNG instance so that runs can be saved, resumed and
// replayed exactly. `randomSeed()` is the only non-deterministic source in the core.

/**
 * mulberry32 PRNG with a single uint32 state.
 * The state after any sequence of calls can be read with `getState()` and restored with
 * `setState()`, which reproduces all following numbers exactly.
 */
export class RNG {
  /** @param {number} [seed] uint32 seed (any number is coerced to uint32) */
  constructor(seed = 0) {
    /** @type {number} */
    this.state = seed >>> 0;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * @param {number} n exclusive upper bound (> 0)
   * @returns {number} integer in 0..n-1
   */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /**
   * @param {number} a lower bound (inclusive)
   * @param {number} b upper bound (inclusive)
   * @returns {number} integer in a..b
   */
  range(a, b) {
    return a + this.int(b - a + 1);
  }

  /**
   * @param {number} p probability of `true` (0..1)
   * @returns {boolean}
   */
  chance(p) {
    return this.next() < p;
  }

  /**
   * @template T
   * @param {T[]} array non-empty array
   * @returns {T} a uniformly chosen element
   */
  pick(array) {
    return array[this.int(array.length)];
  }

  /**
   * Picks an item with probability proportional to `weightFn(item)`.
   * Items with a weight <= 0 are never picked; if all weights are <= 0 a uniform pick is made.
   * @template T
   * @param {T[]} items non-empty array
   * @param {(item: T) => number} weightFn
   * @returns {T}
   */
  weighted(items, weightFn) {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i]);
      if (w > 0) total += w;
    }
    if (total <= 0) return this.pick(items);
    let x = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      const w = weightFn(items[i]);
      if (w <= 0) continue;
      x -= w;
      if (x < 0) return items[i];
    }
    // Floating point rounding can leave a tiny remainder: return the last positive item.
    for (let i = items.length - 1; i >= 0; i--) {
      if (weightFn(items[i]) > 0) return items[i];
    }
    return items[items.length - 1];
  }

  /**
   * Fisher–Yates shuffle (in place).
   * @template T
   * @param {T[]} array
   * @returns {T[]} the same array
   */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  /** @returns {number} uint32 state (saveable) */
  getState() {
    return this.state >>> 0;
  }

  /** @param {number} state value previously returned by `getState()` */
  setState(state) {
    this.state = state >>> 0;
  }
}

/**
 * Stable 32-bit FNV-1a string hash (seeds for levels, daily challenges, missions…).
 * @param {string} str
 * @returns {number} uint32
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A fresh random uint32 seed – the ONLY non-deterministic source of the core.
 * Uses `crypto.getRandomValues` when available, otherwise `Math.random`.
 * @returns {number}
 */
export function randomSeed() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
