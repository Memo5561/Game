// Save-game persistence (docs/ARCHITECTURE.md §4.8).
//
// The save lives in two places: WebView localStorage (fast, synchronous) and the native durable
// store (Platform.saveData → AtomicFile). Every write puts the same JSON with the same `rev` into
// both; on boot `loadSave()` takes whichever snapshot has the higher `rev`, so progress survives a
// wiped WebView profile. This module never imports the platform bridge: the App injects a backend
// whose `saveData(json)` forwards to the native store (see `setStorageBackend`).

import { CONFIG } from '../config.js';

/** localStorage key of the save. Never changes; format changes go through `MIGRATIONS`. */
export const SAVE_KEY = 'blocko.save.v1';

/** Where an unparsable save string is copied before falling back to defaults. */
export const CORRUPT_KEY = 'blocko.save.corrupt';

/** Current SaveData format version. */
export const SAVE_VERSION = 1;

/** Theme every player owns from the start (also the fallback for an invalid selection). */
export const DEFAULT_THEME = 'jewel';

/**
 * Format migrations: `MIGRATIONS[n](data)` turns version-n data into version n+1 (may mutate and
 * return `data`). Add an entry here together with bumping `SAVE_VERSION`.
 * @type {Readonly<Record<number, (data: object) => object>>}
 */
export const MIGRATIONS = Object.freeze({});

/**
 * @typedef {object} StorageBackend
 * @property {(key: string) => (string|null)} [getItem]
 * @property {(key: string, value: string) => void} [setItem]
 * @property {(key: string) => void} [removeItem]
 * @property {(json: string) => void} [saveData] durable native copy (Platform.saveData)
 */

/** @type {StorageBackend|null} null → globalThis.localStorage */
let backend = null;
/** Highest `rev` seen in any snapshot or write; every write goes above it. */
let revFloor = 0;
/** @type {{ data: object, cancel: () => void } | null} */
let pending = null;

/**
 * Replaces the storage backend. Methods the backend lacks (`getItem`/`setItem`/`removeItem`) fall
 * back to `globalThis.localStorage`, so the App can inject just `{ saveData }`. `null` restores
 * the default. Also drops a pending `requestSave` and resets the revision floor.
 * @param {StorageBackend|null} next
 */
export function setStorageBackend(next) {
  cancelPending();
  backend = next || null;
  revFloor = 0;
}

/**
 * A fresh SaveData object with default values (version 1, see §4.8).
 * @returns {SaveData}
 */
export function defaultSave() {
  const now = Date.now();
  const { STARTING_COINS, STARTING_BOOSTERS } = CONFIG.ECONOMY;
  return {
    version: SAVE_VERSION,
    rev: 0,
    createdAt: now,
    lastPlayedAt: now,
    lastSessionStart: now,
    settings: { sound: true, music: true, haptics: true, lang: 'auto' },
    coins: STARTING_COINS,
    xp: 0,
    stats: {
      gamesPlayed: 0,
      classicGames: 0,
      bestScore: 0,
      totalScore: 0,
      totalLines: 0,
      bestCombo: 0,
      piecesPlaced: 0,
      allClears: 0,
      playSec: 0,
    },
    themes: { owned: [DEFAULT_THEME], selected: DEFAULT_THEME },
    boosters: { hammer: STARTING_BOOSTERS.hammer, shuffle: STARTING_BOOSTERS.shuffle },
    daily: { lastClaimDay: null, day: 0, streak: 0 },
    missions: { day: null, list: [], bonusClaimed: false },
    journey: { unlocked: 1, stars: {} },
    challenge: { completed: {}, streak: 0, lastDay: null },
    ads: {
      runsFinished: 0,
      playSecSinceAd: 0,
      lastInterstitialAt: 0,
      lastRewardedAt: 0,
      interstitialsShown: 0,
      sessionRuns: 0,
      upsellDay: null,
      freeCoins: { day: null, count: 0 },
    },
    iap: { adsRemoved: false, adsGiftGranted: false, grantedTokens: [] },
    flags: {
      tutorialDone: false,
      notifAsked: null,
      notifOptIn: false,
      notifDeclines: 0,
      reviewAsked: false,
      firstRecordShown: false,
    },
    run: null,
  };
}

/**
 * Loads the save. Never throws.
 * - Takes the snapshot (localStorage vs. native) with the higher `rev`; ties go to localStorage.
 * - An unparsable snapshot (or one that is not a JSON object) is copied to `CORRUPT_KEY` and
 *   ignored; with no usable snapshot the result is `defaultSave()`.
 * - Runs `MIGRATIONS` by `version`, then deep-merges over `defaultSave()`: plain objects merge
 *   recursively, arrays and `run` are taken as stored, unknown keys are kept, and a stored value
 *   whose type contradicts the default (e.g. a string where a number belongs) is replaced by it.
 * @param {string} [nativeSnapshot] `Platform.loadData()` ('' if none)
 * @returns {SaveData}
 */
export function loadSave(nativeSnapshot) {
  let chosen = null;
  try {
    const local = parseSnapshot(readItem(SAVE_KEY));
    const native = parseSnapshot(typeof nativeSnapshot === 'string' ? nativeSnapshot : null);
    const corrupt = local.corrupt ? local : native.corrupt ? native : null;
    if (corrupt) writeItem(CORRUPT_KEY, corrupt.raw);
    revFloor = Math.max(revFloor, local.rev, native.rev);
    chosen = native.data && (!local.data || native.rev > local.rev) ? native : local;
    if (!chosen.data) return defaultSave();
    return mergeOver(defaultSave(), migrateSave(chosen.data));
  } catch {
    // A failing migration must not cost the player's progress on the next write.
    if (chosen && chosen.raw) writeItem(CORRUPT_KEY, chosen.raw);
    return defaultSave();
  }
}

/**
 * Brings parsed save data up to `targetVersion` by running `migrations[v]` for every version
 * v from `data.version` up to the target. Data without a valid version counts as current; data
 * from a newer app version is left untouched (never downgraded).
 * @param {object} data parsed save (mutated)
 * @param {Readonly<Record<number, (data: object) => object>>} [migrations]
 * @param {number} [targetVersion]
 * @returns {object} the migrated data
 */
export function migrateSave(data, migrations = MIGRATIONS, targetVersion = SAVE_VERSION) {
  let version = Number.isInteger(data.version) ? data.version : targetVersion;
  let out = data;
  for (; version < targetVersion; version++) {
    const step = migrations[version];
    if (typeof step === 'function') out = step(out) || out;
  }
  out.version = version;
  return out;
}

/**
 * Writes the save now: bumps `data.rev` above every revision seen so far, serializes once and
 * hands the same JSON to localStorage and to the backend's `saveData` (if any).
 * @param {SaveData} data
 * @returns {boolean} true if at least one store accepted the snapshot
 */
export function writeSave(data) {
  if (!data || typeof data !== 'object') return false;
  const rev = Math.max(toRev(data.rev), revFloor) + 1;
  let json;
  try {
    data.rev = rev;
    json = JSON.stringify(data);
  } catch {
    return false;
  }
  revFloor = rev;
  const local = writeItem(SAVE_KEY, json);
  const native = nativeSave(json);
  return local || native;
}

/**
 * Coalesced save: any number of calls within one task produce a single `writeSave` (of the most
 * recently passed object) in a later macrotask.
 * @param {SaveData} data
 */
export function requestSave(data) {
  if (pending) {
    pending.data = data;
    return;
  }
  const entry = { data, cancel: () => {} };
  entry.cancel = schedule(() => {
    if (pending !== entry) return;
    pending = null;
    writeSave(entry.data);
  });
  pending = entry;
}

/**
 * Writes synchronously now and supersedes a pending `requestSave` (the App keeps one SaveData
 * object, so the pending write would only repeat this one).
 * @param {SaveData} data
 * @returns {boolean} see `writeSave`
 */
export function flushSave(data) {
  cancelPending();
  return writeSave(data);
}

/**
 * Deletes the save from localStorage and empties the native snapshot (`saveData('')`). Drops a
 * pending `requestSave`. The revision floor is kept, so a following `flushSave(defaultSave())`
 * still outranks any stale snapshot.
 */
export function clearSave() {
  cancelPending();
  removeItem(SAVE_KEY);
  nativeSave('');
}

// ---------------------------------------------------------------------------------------------

function cancelPending() {
  if (!pending) return;
  pending.cancel();
  pending = null;
}

/**
 * Runs `fn` in a later macrotask (setTimeout 0), or as a microtask where timers don't exist.
 * @returns {() => void} cancels the call
 */
function schedule(fn) {
  if (typeof setTimeout === 'function') {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  }
  let live = true;
  const run = () => { if (live) fn(); };
  if (typeof queueMicrotask === 'function') queueMicrotask(run);
  else Promise.resolve().then(run);
  return () => { live = false; };
}

/**
 * @param {string|null|undefined} raw
 * @returns {{ raw: string|null, data: object|null, rev: number, corrupt: boolean }}
 */
function parseSnapshot(raw) {
  if (typeof raw !== 'string' || raw === '') return { raw: null, data: null, rev: 0, corrupt: false };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!isPlainObject(data)) return { raw, data: null, rev: 0, corrupt: true };
  return { raw, data, rev: toRev(data.rev), corrupt: false };
}

function toRev(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merges `stored` over the defaults `def` (see `loadSave`).
 * @param {object} def
 * @param {object} stored
 */
function mergeOver(def, stored) {
  const out = {};
  for (const key of Object.keys(def)) out[key] = mergeValue(def[key], stored[key]);
  for (const key of Object.keys(stored)) {
    if (!Object.prototype.hasOwnProperty.call(def, key)) out[key] = stored[key];
  }
  return out;
}

function mergeValue(def, stored) {
  if (stored === undefined) return def;
  // null defaults are nullable slots (day keys, `run`): take whatever was stored.
  if (def === null) return stored;
  if (Array.isArray(def)) return Array.isArray(stored) ? stored : def;
  if (isPlainObject(def)) return isPlainObject(stored) ? mergeOver(def, stored) : def;
  if (typeof def === 'number') return Number.isFinite(stored) ? stored : def;
  return typeof stored === typeof def ? stored : def;
}

// Storage access – every call is wrapped: localStorage can be missing, disabled or full.

function webStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function storageFor(method) {
  return backend && typeof backend[method] === 'function' ? backend : webStorage();
}

function readItem(key) {
  try {
    const store = storageFor('getItem');
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeItem(key, value) {
  try {
    const store = storageFor('setItem');
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key) {
  try {
    const store = storageFor('removeItem');
    if (store) store.removeItem(key);
  } catch {
    // nothing to do: the save simply stays
  }
}

function nativeSave(json) {
  if (!backend || typeof backend.saveData !== 'function') return false;
  try {
    backend.saveData(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {object} SaveData
 * @property {number} version
 * @property {number} rev bumped by every write; the higher snapshot wins on load
 * @property {number} createdAt ms timestamp
 * @property {number} lastPlayedAt ms timestamp of the last recorded game
 * @property {number} lastSessionStart ms timestamp (AdPolicy.onSessionStart)
 * @property {{ sound: boolean, music: boolean, haptics: boolean, lang: string }} settings
 * @property {number} coins
 * @property {number} xp total XP (the level is derived from it)
 * @property {{ gamesPlayed: number, classicGames: number, bestScore: number, totalScore: number,
 *   totalLines: number, bestCombo: number, piecesPlaced: number, allClears: number,
 *   playSec: number }} stats bestScore is classic only
 * @property {{ owned: string[], selected: string }} themes
 * @property {{ hammer: number, shuffle: number }} boosters
 * @property {{ lastClaimDay: string|null, day: number, streak: number }} daily login calendar;
 *   day = calendar position 1..7 of the last claim (0 = never)
 * @property {{ day: string|null, list: import('./missions.js').Mission[], bonusClaimed: boolean }} missions
 * @property {{ unlocked: number, stars: Record<string, number> }} journey
 * @property {{ completed: Record<string, number>, streak: number, lastDay: string|null }} challenge
 * @property {{ runsFinished: number, playSecSinceAd: number, lastInterstitialAt: number,
 *   lastRewardedAt: number, interstitialsShown: number, sessionRuns: number,
 *   upsellDay: string|null, freeCoins: { day: string|null, count: number } }} ads
 * @property {{ adsRemoved: boolean, adsGiftGranted: boolean, grantedTokens: string[] }} iap
 * @property {{ tutorialDone: boolean, notifAsked: string|null, notifOptIn: boolean,
 *   notifDeclines: number, reviewAsked: boolean, firstRecordShown: boolean }} flags
 * @property {object|null} run `{ v, mode, level, session }` of the unfinished run
 */
