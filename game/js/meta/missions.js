// Daily missions (docs/ARCHITECTURE.md §4.10): generation and event-driven progress.
// Pure and deterministic – the same day key, player level and unlocked features always give the
// same three missions. No DOM, no dependency on js/core.

import { CONFIG } from '../config.js';

/** Every mission type; the UI text key of a type is `mission.<type>` with param `{n}` = target. */
export const MISSION_TYPES = Object.freeze([
  'clear_lines',     // clear {n} lines (sum over runs)
  'score_single',    // score {n} in a single run (best run of the day)
  'play_games',      // finish {n} runs
  'combo_reach',     // reach combo x{n}
  'place_pieces',    // place {n} pieces
  'multi_clear',     // clear MULTI_CLEAR_LINES+ lines with one placement {n} times
  'all_clear',       // clear the whole board {n} times – legacy: no longer generated (luck, not skill), still tracked for saved lists
  'journey_levels',  // complete {n} journey levels
  'daily_challenge', // complete the daily challenge ({n} = 1)
  'use_booster',     // use {n} boosters
]);

/** A placement counts for `multi_clear` when it clears at least this many lines. */
export const MULTI_CLEAR_LINES = 2;

/**
 * Mission design table. `targets` per slot [easy, medium, hard] at player level 1 (null = never in
 * that slot; a type that is null everywhere is not generated any more but keeps its progress rule
 * for missions in older saves); `feature` must be unlocked for the type to be offered; `step` marks targets that
 * grow with the player level and is the rounding step of the scaled value.
 */
const DEFS = Object.freeze({
  clear_lines: { targets: [15, 40, 80], step: 5 },
  score_single: { targets: [1000, 3000, 6000], step: 100 },
  play_games: { targets: [2, 3, 5] },
  combo_reach: { targets: [3, 5, 8] },
  place_pieces: { targets: [30, 80, 150], step: 5 },
  multi_clear: { targets: [2, 4, 8] },
  all_clear: { targets: [null, null, null] }, // never offered: a whole-board clear is mostly luck
  journey_levels: { targets: [1, 2, 4], feature: 'journey' },
  daily_challenge: { targets: [null, null, 1], feature: 'daily' },
  use_booster: { targets: [1, 2, null], feature: 'journey' },
});

/** type → (progress, event) → new progress */
const RULES = Object.freeze({
  clear_lines: (p, e) => (e.type === 'clear' ? p + count(e.lines) : p),
  score_single: (p, e) => (e.type === 'game_end' ? Math.max(p, count(e.score)) : p),
  play_games: (p, e) => (e.type === 'game_end' && !(e.pieces < CONFIG.ADS.RUN_MIN_PIECES) ? p + 1 : p),
  combo_reach: (p, e) => (e.type === 'clear' ? Math.max(p, count(e.combo)) : p),
  place_pieces: (p, e) => (e.type === 'place' ? p + 1 : p),
  multi_clear: (p, e) => (e.type === 'clear' && count(e.lines) >= MULTI_CLEAR_LINES ? p + 1 : p),
  all_clear: (p, e) => (e.type === 'all_clear' ? p + 1 : p),
  journey_levels: (p, e) => (e.type === 'level_complete' ? p + 1 : p),
  daily_challenge: (p, e) => (e.type === 'daily_complete' ? p + 1 : p),
  use_booster: (p, e) => (e.type === 'booster_used' ? p + 1 : p),
});

const SLOTS = 3; // easy, medium, hard
/** Scaled targets grow by this fraction per player level above 1 … */
const SCALE_PER_LEVEL = 0.04;
/** … for at most this many levels (level 16+ → ×1.6). */
const SCALE_MAX_LEVELS = 15;

/**
 * @typedef {object} Mission
 * @property {string} id unique per day: `<dayKey>-<slot>`
 * @property {string} type one of MISSION_TYPES
 * @property {number} target
 * @property {number} progress 0..target (completed when progress >= target)
 * @property {number} reward coins, CONFIG.ECONOMY.MISSION_REWARDS[slot]
 * @property {boolean} claimed
 * @property {string} textKey `mission.<type>` (param n = target)
 */

/**
 * The three missions of a day: slot 0 easy, 1 medium, 2 hard, all of different types. Types that
 * need a locked feature (journey_levels/use_booster → 'journey', daily_challenge → 'daily') are
 * never chosen.
 * @param {string} dayKey 'YYYY-MM-DD' (seeds the choice)
 * @param {number} playerLevel scales volume targets gently
 * @param {Iterable<string>} [unlocked] unlocked feature ids
 * @returns {Mission[]}
 */
export function generateMissions(dayKey, playerLevel, unlocked = []) {
  const rand = prng(hash32(`missions:${dayKey}`));
  const open = new Set(unlocked);
  const level = Math.max(1, Math.floor(Number(playerLevel)) || 1);
  const used = new Set();
  const list = [];
  for (let slot = 0; slot < SLOTS; slot++) {
    const pool = MISSION_TYPES.filter((type) => {
      const def = DEFS[type];
      return !used.has(type) && def.targets[slot] !== null && (!def.feature || open.has(def.feature));
    });
    const type = pool[Math.floor(rand() * pool.length)];
    used.add(type);
    list.push({
      id: `${dayKey}-${slot}`,
      type,
      target: targetFor(DEFS[type], slot, level),
      progress: 0,
      reward: CONFIG.ECONOMY.MISSION_REWARDS[slot],
      claimed: false,
      textKey: `mission.${type}`,
    });
  }
  return list;
}

/**
 * Applies one meta event (§4.9 trackEvent) to the missions in place. Claimed and completed
 * missions don't change; progress never exceeds the target.
 * `game_end` may carry an optional `pieces`: runs with fewer than CONFIG.ADS.RUN_MIN_PIECES
 * pieces then don't count for play_games (no mission farming with instantly abandoned runs).
 * @param {Mission[]} list
 * @param {{ type: string, [key: string]: any }} evt
 * @returns {{ changed: boolean, completed: Mission[] }} completed = copies of missions completed by this event
 */
export function progressMissions(list, evt) {
  const completed = [];
  let changed = false;
  if (!evt || !Array.isArray(list)) return { changed, completed };
  for (const m of list) {
    if (!m || m.claimed || !(m.progress < m.target)) continue;
    const rule = RULES[m.type];
    const next = rule ? Math.min(m.target, rule(m.progress, evt)) : m.progress;
    if (!(next > m.progress)) continue;
    m.progress = next;
    changed = true;
    if (next >= m.target) completed.push({ ...m });
  }
  return { changed, completed };
}

function targetFor(def, slot, level) {
  const base = def.targets[slot];
  if (!def.step) return base;
  const factor = 1 + SCALE_PER_LEVEL * Math.min(level - 1, SCALE_MAX_LEVELS);
  return Math.max(def.step, Math.round((base * factor) / def.step) * def.step);
}

function count(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** FNV-1a 32-bit string hash. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 → floats in [0, 1). */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
