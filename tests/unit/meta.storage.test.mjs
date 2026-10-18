import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import {
  SAVE_KEY, CORRUPT_KEY, SAVE_VERSION, MIGRATIONS, DEFAULT_THEME,
  defaultSave, loadSave, migrateSave, writeSave, requestSave, flushSave, clearSave, setStorageBackend,
} from '../../game/js/meta/storage.js';

/** In-memory localStorage stand-in, optionally with a native `saveData` sink. */
function memoryBackend({ native = true, failSet = false, failNative = false } = {}) {
  const map = new Map();
  const backend = {
    map,
    writes: 0,
    nativeWrites: [],
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failSet) throw new Error('QuotaExceededError');
      if (k === SAVE_KEY) backend.writes++;
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); },
  };
  if (native) {
    backend.saveData = (json) => {
      if (failNative) throw new Error('bridge gone');
      backend.nativeWrites.push(json);
    };
  }
  setStorageBackend(backend);
  return backend;
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 5));
const snapshot = (obj) => JSON.stringify(obj);
/** Drops the creation-time timestamps so two default saves compare equal. */
const stripTimes = ({ createdAt, lastPlayedAt, lastSessionStart, ...rest }) => rest;

afterEach(() => setStorageBackend(null));

test('defaultSave has the complete v1 shape with CONFIG starting values', () => {
  const before = Date.now();
  const s = defaultSave();
  assert.deepEqual(Object.keys(s), [
    'version', 'rev', 'createdAt', 'lastPlayedAt', 'lastSessionStart', 'settings', 'coins', 'xp',
    'stats', 'themes', 'boosters', 'daily', 'missions', 'journey', 'challenge', 'ads', 'iap', 'flags', 'run',
  ]);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.version, 1);
  assert.equal(s.rev, 0);
  for (const k of ['createdAt', 'lastPlayedAt', 'lastSessionStart']) {
    assert.ok(Number.isInteger(s[k]) && s[k] >= before && s[k] <= Date.now(), k);
  }
  assert.deepEqual(s.settings, { sound: true, music: true, haptics: true, lang: 'auto' });
  assert.equal(s.coins, CONFIG.ECONOMY.STARTING_COINS);
  assert.equal(s.xp, 0);
  assert.deepEqual(s.stats, {
    gamesPlayed: 0, classicGames: 0, bestScore: 0, totalScore: 0, totalLines: 0, bestCombo: 0,
    piecesPlaced: 0, allClears: 0, playSec: 0,
  });
  assert.deepEqual(s.themes, { owned: ['jewel'], selected: 'jewel' });
  assert.equal(DEFAULT_THEME, 'jewel');
  assert.deepEqual(s.boosters, { ...CONFIG.ECONOMY.STARTING_BOOSTERS });
  assert.deepEqual(s.daily, { lastClaimDay: null, day: 0, streak: 0 });
  assert.deepEqual(s.missions, { day: null, list: [], bonusClaimed: false });
  assert.deepEqual(s.journey, { unlocked: 1, stars: {} });
  assert.deepEqual(s.challenge, { completed: {}, streak: 0, lastDay: null });
  assert.deepEqual(s.ads, {
    runsFinished: 0, playSecSinceAd: 0, lastInterstitialAt: 0, lastRewardedAt: 0,
    interstitialsShown: 0, sessionRuns: 0, upsellDay: null, freeCoins: { day: null, count: 0 },
  });
  assert.deepEqual(s.iap, { adsRemoved: false, adsGiftGranted: false, grantedTokens: [] });
  assert.deepEqual(s.flags, {
    tutorialDone: false, notifAsked: null, notifOptIn: false, notifDeclines: 0,
    reviewAsked: false, firstRecordShown: false,
  });
  assert.equal(s.run, null);
});

test('defaultSave returns independent objects', () => {
  const a = defaultSave();
  const b = defaultSave();
  a.themes.owned.push('neon');
  a.boosters.hammer = 99;
  a.journey.stars[1] = 3;
  assert.deepEqual(b.themes.owned, ['jewel']);
  assert.equal(b.boosters.hammer, CONFIG.ECONOMY.STARTING_BOOSTERS.hammer);
  assert.deepEqual(b.journey.stars, {});
});

test('loadSave without any snapshot returns defaults', () => {
  memoryBackend();
  assert.deepEqual(stripTimes(loadSave('')), stripTimes(defaultSave()));
  assert.deepEqual(stripTimes(loadSave()), stripTimes(defaultSave()));
  assert.deepEqual(stripTimes(loadSave(null)), stripTimes(defaultSave()));
});

test('loadSave deep-merges over defaults, keeps unknown keys, takes arrays and run verbatim', () => {
  const b = memoryBackend();
  const run = { v: 1, mode: 'classic', level: null, session: { score: 420, board: { cells: [0, 1] }, extra: [1] } };
  b.map.set(SAVE_KEY, snapshot({
    version: 1,
    rev: 3,
    coins: 777,
    settings: { lang: 'de', futureSetting: 7 },
    stats: { bestScore: 900 },
    themes: { owned: ['candy'] },
    journey: { stars: { 1: 3, 2: 1 } },
    daily: { lastClaimDay: '2026-10-01', day: 4 },
    iap: { grantedTokens: [] },
    run,
    futureKey: { nested: true },
  }));
  const s = loadSave('');
  assert.equal(s.rev, 3);
  assert.equal(s.coins, 777);
  assert.deepEqual(s.settings, { sound: true, music: true, haptics: true, lang: 'de', futureSetting: 7 });
  assert.equal(s.stats.bestScore, 900);
  assert.equal(s.stats.gamesPlayed, 0);
  assert.deepEqual(s.themes, { owned: ['candy'], selected: 'jewel' }, 'arrays are not merged with defaults');
  assert.deepEqual(s.journey, { unlocked: 1, stars: { 1: 3, 2: 1 } });
  assert.deepEqual(s.daily, { lastClaimDay: '2026-10-01', day: 4, streak: 0 });
  assert.deepEqual(s.run, run);
  assert.deepEqual(s.futureKey, { nested: true });
  assert.deepEqual(s.missions, { day: null, list: [], bonusClaimed: false });
  assert.deepEqual(s.ads.freeCoins, { day: null, count: 0 });
});

test('loadSave replaces values whose type contradicts the default', () => {
  const b = memoryBackend();
  b.map.set(SAVE_KEY, snapshot({
    rev: 1,
    coins: 'lots',
    xp: null,
    stats: 5,
    themes: { owned: 'jewel', selected: 7 },
    settings: { sound: 'yes' },
    missions: { list: { 0: 'x' } },
    run: { v: 1 },
  }));
  const s = loadSave('');
  assert.equal(s.coins, CONFIG.ECONOMY.STARTING_COINS);
  assert.equal(s.xp, 0);
  assert.deepEqual(s.stats, defaultSave().stats);
  assert.deepEqual(s.themes, { owned: ['jewel'], selected: 'jewel' });
  assert.equal(s.settings.sound, true);
  assert.deepEqual(s.missions.list, []);
  assert.deepEqual(s.run, { v: 1 });
});

test('an unparsable local save is backed up and defaults are returned', () => {
  for (const raw of ['{"coins": 5', 'null', '[1,2]', '42', 'undefined']) {
    const b = memoryBackend();
    b.map.set(SAVE_KEY, raw);
    let s;
    assert.doesNotThrow(() => { s = loadSave(''); });
    assert.deepEqual(stripTimes(s), stripTimes(defaultSave()), raw);
    assert.equal(b.map.get(CORRUPT_KEY), raw);
    assert.equal(b.map.get(SAVE_KEY), raw, 'loading never overwrites the save itself');
  }
});

test('a corrupt snapshot on one side falls back to the other side', () => {
  let b = memoryBackend();
  b.map.set(SAVE_KEY, '{broken');
  let s = loadSave(snapshot({ rev: 2, coins: 55 }));
  assert.equal(s.coins, 55);
  assert.equal(b.map.get(CORRUPT_KEY), '{broken');

  b = memoryBackend();
  b.map.set(SAVE_KEY, snapshot({ rev: 2, coins: 66 }));
  s = loadSave('{"rev": 9, "coins"');
  assert.equal(s.coins, 66);
  assert.equal(b.map.get(CORRUPT_KEY), '{"rev": 9, "coins"');
});

test('loadSave picks the snapshot with the higher rev (ties: localStorage)', () => {
  const cases = [
    { local: { rev: 5, coins: 1 }, native: { rev: 7, coins: 2 }, coins: 2 },
    { local: { rev: 9, coins: 1 }, native: { rev: 3, coins: 2 }, coins: 1 },
    { local: { rev: 4, coins: 1 }, native: { rev: 4, coins: 2 }, coins: 1 },
    { local: { rev: 1, coins: 1 }, native: { coins: 2 }, coins: 1 },
    { local: { coins: 1 }, native: { rev: 1, coins: 2 }, coins: 2 },
    { local: null, native: { rev: 1, coins: 2 }, coins: 2 },
    { local: { rev: 8, coins: 1 }, native: null, coins: 1 },
  ];
  for (const c of cases) {
    const b = memoryBackend();
    if (c.local) b.map.set(SAVE_KEY, snapshot(c.local));
    const s = loadSave(c.native ? snapshot(c.native) : '');
    assert.equal(s.coins, c.coins, JSON.stringify(c));
    assert.equal(b.map.has(CORRUPT_KEY), false);
  }
});

test('loadSave uses the native snapshot when localStorage throws', () => {
  setStorageBackend({
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  });
  const s = loadSave(snapshot({ rev: 3, coins: 321 }));
  assert.equal(s.coins, 321);
  assert.deepEqual(stripTimes(loadSave('{bad')), stripTimes(defaultSave()));
});

test('migrateSave runs every step from the stored version up to the target', () => {
  const calls = [];
  const migrations = {
    1: (d) => { calls.push(1); return { ...d, renamed: d.old, old: undefined }; },
    2: (d) => { calls.push(2); d.added = true; return d; },
  };
  const out = migrateSave({ version: 1, old: 'x' }, migrations, 3);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(out.version, 3);
  assert.equal(out.renamed, 'x');
  assert.equal(out.added, true);

  calls.length = 0;
  assert.equal(migrateSave({ version: 2 }, migrations, 3).added, true);
  assert.deepEqual(calls, [2]);
  calls.length = 0;
  assert.equal(migrateSave({}, migrations, 3).version, 3, 'unversioned data counts as current');
  assert.deepEqual(calls, []);
  assert.equal(migrateSave({ version: 7 }, migrations, 3).version, 7, 'newer data is never downgraded');
});

test('loadSave migrates by version and keeps data from a newer app version', () => {
  assert.ok(Object.isFrozen(MIGRATIONS));
  const b = memoryBackend();
  b.map.set(SAVE_KEY, snapshot({ rev: 1, coins: 9 }));
  assert.equal(loadSave('').version, SAVE_VERSION);
  b.map.set(SAVE_KEY, snapshot({ version: SAVE_VERSION + 1, rev: 2, coins: 9, newThing: [1] }));
  const s = loadSave('');
  assert.equal(s.version, SAVE_VERSION + 1);
  assert.deepEqual(s.newThing, [1]);
  assert.equal(s.coins, 9);
});

test('writeSave bumps rev and writes the same JSON to localStorage and native', () => {
  const b = memoryBackend();
  const s = defaultSave();
  assert.equal(writeSave(s), true);
  assert.equal(s.rev, 1);
  assert.equal(b.nativeWrites.length, 1);
  assert.equal(b.map.get(SAVE_KEY), b.nativeWrites[0]);
  assert.equal(JSON.parse(b.nativeWrites[0]).rev, 1);
  s.coins = 5;
  assert.equal(writeSave(s), true);
  assert.equal(s.rev, 2);
  assert.equal(JSON.parse(b.map.get(SAVE_KEY)).coins, 5);
  assert.equal(loadSave(b.nativeWrites[1]).rev, 2);
});

test('writeSave reports success if at least one store accepted the snapshot', () => {
  let b = memoryBackend({ failSet: true });
  assert.equal(writeSave(defaultSave()), true, 'native only');
  assert.equal(b.nativeWrites.length, 1);
  b = memoryBackend({ failNative: true });
  assert.equal(writeSave(defaultSave()), true, 'localStorage only');
  assert.ok(b.map.has(SAVE_KEY));
  memoryBackend({ failSet: true, failNative: true });
  assert.equal(writeSave(defaultSave()), false);
  memoryBackend({ failSet: true, native: false });
  assert.equal(writeSave(defaultSave()), false);
});

test('writeSave refuses unserializable data without writing', () => {
  const b = memoryBackend();
  const s = defaultSave();
  s.run = {};
  s.run.self = s.run;
  assert.equal(writeSave(s), false);
  assert.equal(b.map.has(SAVE_KEY), false);
  assert.equal(b.nativeWrites.length, 0);
  assert.equal(writeSave(null), false);
});

test('writes always outrank every snapshot seen by loadSave', () => {
  const b = memoryBackend();
  b.map.set(SAVE_KEY, snapshot({ rev: 3, coins: 1 }));
  const loaded = loadSave(snapshot({ rev: 10, coins: 2 }));
  assert.equal(loaded.rev, 10);
  writeSave(loaded);
  assert.equal(loaded.rev, 11);
  // a fresh object (e.g. after a reset) still beats the stale native snapshot
  const fresh = defaultSave();
  writeSave(fresh);
  assert.equal(fresh.rev, 12);
  assert.equal(loadSave(snapshot({ rev: 10, coins: 2 })).coins, CONFIG.ECONOMY.STARTING_COINS);
});

test('requestSave coalesces all calls of one task into a single write', async () => {
  const b = memoryBackend();
  const s = defaultSave();
  for (let i = 0; i < 5; i++) {
    s.coins = i;
    requestSave(s);
  }
  assert.equal(b.writes, 0, 'nothing is written synchronously');
  await macrotask();
  assert.equal(b.writes, 1);
  assert.equal(b.nativeWrites.length, 1);
  assert.equal(JSON.parse(b.map.get(SAVE_KEY)).coins, 4, 'the latest state is written');
  assert.equal(s.rev, 1);

  requestSave(s);
  await macrotask();
  assert.equal(b.writes, 2, 'a later task schedules a new write');
});

test('requestSave writes the most recently passed object', async () => {
  const b = memoryBackend();
  const first = defaultSave();
  const second = defaultSave();
  second.coins = 4242;
  requestSave(first);
  requestSave(second);
  await macrotask();
  assert.equal(b.writes, 1);
  assert.equal(JSON.parse(b.map.get(SAVE_KEY)).coins, 4242);
});

test('flushSave writes synchronously and supersedes a pending requestSave', async () => {
  const b = memoryBackend();
  const s = defaultSave();
  requestSave(s);
  assert.equal(flushSave(s), true);
  assert.equal(b.writes, 1);
  await macrotask();
  assert.equal(b.writes, 1);
  assert.equal(s.rev, 1);
});

test('requestSave falls back to a microtask where timers are missing', async () => {
  const b = memoryBackend();
  const realSetTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = undefined;
    requestSave(defaultSave());
    requestSave(defaultSave());
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(b.writes, 0);
  await Promise.resolve();
  assert.equal(b.writes, 1);
});

test('clearSave removes the save everywhere and cancels a pending write', async () => {
  const b = memoryBackend();
  const s = defaultSave();
  s.coins = 999;
  flushSave(s);
  requestSave(s);
  clearSave();
  assert.equal(b.map.has(SAVE_KEY), false);
  assert.equal(b.nativeWrites.at(-1), '');
  await macrotask();
  assert.equal(b.map.has(SAVE_KEY), false, 'the pending write was dropped');
  assert.equal(loadSave(b.nativeWrites.at(-1)).coins, CONFIG.ECONOMY.STARTING_COINS);
  // even if native kept its old snapshot, the next save outranks it
  const fresh = defaultSave();
  flushSave(fresh);
  assert.ok(fresh.rev > s.rev);
  assert.equal(loadSave(b.nativeWrites[0]).coins, CONFIG.ECONOMY.STARTING_COINS);
});

test('the default backend is globalThis.localStorage, accessed defensively', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restore = () => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  };
  try {
    setStorageBackend(null);
    const map = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, v),
        removeItem: (k) => map.delete(k),
      },
    });
    const s = defaultSave();
    s.coins = 31;
    assert.equal(writeSave(s), true);
    assert.equal(JSON.parse(map.get(SAVE_KEY)).coins, 31);
    assert.equal(loadSave('').coins, 31);

    // partial backend: localStorage methods fall back to globalThis.localStorage
    const native = [];
    setStorageBackend({ saveData: (json) => native.push(json) });
    assert.equal(writeSave(s), true);
    assert.equal(native.length, 1);
    assert.equal(map.get(SAVE_KEY), native[0]);

    setStorageBackend(null);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: access denied'); },
    });
    assert.deepEqual(stripTimes(loadSave('')), stripTimes(defaultSave()));
    assert.equal(writeSave(defaultSave()), false);
    assert.doesNotThrow(() => clearSave());

    delete globalThis.localStorage;
    assert.equal(writeSave(defaultSave()), false);
    assert.equal(loadSave(snapshot({ rev: 1, coins: 12 })).coins, 12);
  } finally {
    restore();
  }
});
