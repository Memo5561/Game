import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { defaultSave } from '../../game/js/meta/storage.js';
import { generateMissions, MISSION_TYPES } from '../../game/js/meta/missions.js';
import { Progression, dayKey, daysBetween, xpForLevel } from '../../game/js/meta/progression.js';

const { ECONOMY, PROGRESSION: P, ADS, UNLOCKS, PRODUCTS } = CONFIG;

/** Mutable local-time clock: `at('2026-10-18', 12)` → that local date and hour. */
function makeClock(day = '2026-10-18', hour = 12) {
  let t;
  const clock = {
    now: () => new Date(t),
    at(key, h = 12, min = 0) {
      const [y, m, d] = key.split('-').map(Number);
      t = new Date(y, m - 1, d, h, min).getTime();
      return clock;
    },
    /** Moves by whole local calendar days, keeping the wall-clock time. */
    addDays(n) {
      const d = new Date(t);
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
      return clock;
    },
    today: () => dayKey(new Date(t)),
  };
  return clock.at(day, hour);
}

function setup({ games = 0, coins, day = '2026-10-18', hour = 12 } = {}) {
  const save = defaultSave();
  save.stats.gamesPlayed = games;
  if (coins !== undefined) save.coins = coins;
  const clock = makeClock(day, hour);
  const changes = { count: 0 };
  const p = new Progression(save, { now: clock.now, onChange: () => { changes.count++; } });
  return { save, p, clock, changes };
}

const ZONES = ['Europe/Berlin', 'America/New_York', 'Australia/Sydney', 'Pacific/Chatham', 'UTC'];

/** Runs `fn` in the process' own zone and then in each of ZONES. */
function inEachZone(fn) {
  const original = process.env.TZ;
  try {
    fn(original || 'default');
    for (const zone of ZONES) {
      process.env.TZ = zone;
      fn(zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

/** Reference level computation: walk level by level. */
function slowLevel(xp) {
  let level = 1;
  let rest = xp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, rest };
}

// --- calendar helpers ---------------------------------------------------------------------------

test('dayKey formats the local date', () => {
  inEachZone((zone) => {
    assert.equal(dayKey(new Date(2026, 9, 18, 0, 0, 1)), '2026-10-18', zone);
    assert.equal(dayKey(new Date(2026, 9, 18, 23, 59, 59)), '2026-10-18', zone);
    assert.equal(dayKey(new Date(2026, 0, 5, 12)), '2026-01-05', zone);
    assert.equal(dayKey(new Date(2026, 11, 31, 23, 30)), '2026-12-31', zone);
    assert.equal(dayKey(new Date(2026, 2, 29, 3, 30).getTime()), '2026-03-29', 'accepts ms timestamps');
  });
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('daysBetween counts calendar days across DST changes', () => {
  inEachZone((zone) => {
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, zone);
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2, zone);
    assert.equal(daysBetween('2026-03-28', '2026-03-29'), 1);
    assert.equal(daysBetween('2026-03-29', '2026-03-30'), 1);
    assert.equal(daysBetween('2026-10-25', '2026-10-26'), 1);
    assert.equal(daysBetween('2026-10-26', '2026-10-24'), -2);
    assert.equal(daysBetween('2026-10-18', '2026-10-18'), 0);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
    assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
    assert.ok(Number.isNaN(daysBetween('garbage', '2026-10-18')));
    assert.ok(Number.isNaN(daysBetween(null, '2026-10-18')));
  });
});

test('consecutive local dates are always one day apart (whole year, every zone)', () => {
  inEachZone((zone) => {
    for (const [h, min] of [[0, 0], [0, 30], [2, 30], [23, 59]]) {
      let prev = dayKey(new Date(2026, 0, 1, h, min));
      for (let i = 1; i <= 365; i++) {
        const key = dayKey(new Date(2026, 0, 1 + i, h, min));
        assert.equal(daysBetween(prev, key), 1, `${zone} ${prev} → ${key}`);
        prev = key;
      }
    }
  });
});

test('Europe/Berlin DST weekends: login calendar and day keys stay consistent', () => {
  const original = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    assert.notEqual(new Date(2026, 2, 28, 12).getTimezoneOffset(), new Date(2026, 2, 30, 12).getTimezoneOffset(),
      'the zone database knows Berlin DST');
    // spring forward (2026-03-29): claim late Saturday, next claim just after midnight
    const { p, clock } = setup({ games: 1 });
    clock.at('2026-03-28', 23, 50);
    assert.equal(p.claimDailyReward().day, 1);
    clock.at('2026-03-29', 0, 10);
    assert.equal(clock.today(), '2026-03-29');
    assert.equal(p.claimDailyReward().day, 2);
    clock.at('2026-03-30', 0, 5);
    assert.equal(p.claimDailyReward().day, 3);
    // fall back (2026-10-25): two-day gap across the change = grace day
    clock.at('2026-10-24', 23, 0);
    p.save.daily = { lastClaimDay: '2026-10-24', day: 3, streak: 3 };
    clock.at('2026-10-26', 0, 30);
    const r = p.claimDailyReward();
    assert.equal(r.day, 4);
    assert.equal(r.graceUsed, true);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

// --- XP / levels --------------------------------------------------------------------------------

test('xpForLevel follows CONFIG.PROGRESSION', () => {
  for (const level of [1, 2, 10, 50]) assert.equal(xpForLevel(level), P.XP_LEVEL_BASE + P.XP_LEVEL_STEP * level);
});

test('levelInfo derives the level from total XP', () => {
  const { p, save } = setup();
  assert.deepEqual(p.levelInfo(), { level: 1, xp: 0, xpIntoLevel: 0, xpForNext: xpForLevel(1), progress: 0 });
  save.xp = xpForLevel(1) - 1;
  assert.equal(p.levelInfo().level, 1);
  save.xp = xpForLevel(1);
  assert.deepEqual(p.levelInfo(), { level: 2, xp: xpForLevel(1), xpIntoLevel: 0, xpForNext: xpForLevel(2), progress: 0 });
  save.xp = xpForLevel(1) + xpForLevel(2) - 1;
  const info = p.levelInfo();
  assert.equal(info.level, 2);
  assert.equal(info.xpIntoLevel, xpForLevel(2) - 1);
  assert.equal(info.progress, (xpForLevel(2) - 1) / xpForLevel(2));
  for (let xp = 0; xp <= 60000; xp += 7) {
    save.xp = xp;
    const ref = slowLevel(xp);
    const got = p.levelInfo();
    assert.equal(got.level, ref.level, `xp ${xp}`);
    assert.equal(got.xpIntoLevel, ref.rest, `xp ${xp}`);
  }
});

test('addXP reports every level crossed, pays level-up coins and unlocks level themes', () => {
  const { p, save, changes } = setup();
  const coins0 = save.coins;
  const levelThemes = Object.keys(ECONOMY.THEMES)
    .filter((id) => ECONOMY.THEMES[id].price === 0 && ECONOMY.THEMES[id].unlockLevel > 1 && ECONOMY.THEMES[id].unlockLevel <= 3);
  assert.ok(levelThemes.includes('neon'));
  assert.equal(p.ownsTheme('neon'), false);

  const r = p.addXP(xpForLevel(1) + xpForLevel(2));
  assert.deepEqual(r, { leveledUp: true, levels: [2, 3], coins: 2 * ECONOMY.LEVEL_UP_COINS, unlockedThemes: levelThemes });
  assert.equal(save.coins, coins0 + 2 * ECONOMY.LEVEL_UP_COINS);
  assert.equal(p.levelInfo().level, 3);
  assert.ok(save.themes.owned.includes('neon'), 'level themes become owned');
  assert.equal(p.ownsTheme('neon'), true);
  assert.equal(changes.count, 1);

  assert.deepEqual(p.addXP(1), { leveledUp: false, levels: [], coins: 0, unlockedThemes: [] });
  assert.equal(changes.count, 2);
  assert.deepEqual(p.addXP(-50), { leveledUp: false, levels: [], coins: 0, unlockedThemes: [] });
  assert.deepEqual(p.addXP(NaN).levels, []);
  assert.equal(changes.count, 2, 'no-op gains do not report a change');
});

// --- runs ---------------------------------------------------------------------------------------

test('recordGame: classic runs set the best score, pay coins and XP', () => {
  const { p, save, clock, changes } = setup();
  const coins0 = save.coins;
  const r = p.recordGame({ mode: 'classic', score: 1000, lines: 20, maxCombo: 4, pieces: 30, allClears: 1, playSec: 95.5 });
  const coins = Math.max(ECONOMY.COINS_MIN_PER_GAME, Math.floor(1000 * ECONOMY.COINS_PER_SCORE));
  assert.equal(r.newBest, true);
  assert.equal(r.firstRecord, true);
  assert.equal(r.coinsEarned, coins);
  assert.equal(r.counted, true);
  assert.equal(save.xp, Math.min(P.XP_RUN_CAP, P.XP_RUN_BASE + 20 * P.XP_PER_LINE));
  assert.deepEqual(r.xp, { leveledUp: false, levels: [], coins: 0, unlockedThemes: [] });
  assert.equal(save.coins, coins0 + coins);
  assert.equal(p.bestScore, 1000);
  assert.deepEqual(save.stats, {
    gamesPlayed: 1, classicGames: 1, bestScore: 1000, totalScore: 1000, totalLines: 20, bestCombo: 4,
    piecesPlaced: 30, allClears: 1, playSec: 95.5,
  });
  assert.equal(save.lastPlayedAt, clock.now().getTime());
  assert.equal(changes.count, 1, 'one change notification per call');

  const lower = p.recordGame({ mode: 'classic', score: 400, lines: 8, maxCombo: 2, pieces: 12, playSec: 30 });
  assert.equal(lower.newBest, false);
  assert.equal(lower.firstRecord, false);
  assert.equal(p.bestScore, 1000);
  assert.equal(save.stats.bestCombo, 4);
  const higher = p.recordGame({ mode: 'classic', score: 1001, lines: 8, pieces: 12 });
  assert.equal(higher.newBest, true);
  assert.equal(higher.firstRecord, false);
  assert.equal(save.stats.totalScore, 2401);
  assert.equal(save.stats.playSec, 125.5);
});

test('recordGame: minimum coins, XP cap and short runs', () => {
  const { p, save } = setup();
  assert.equal(p.recordGame({ mode: 'classic', score: 40, lines: 0, pieces: ADS.RUN_MIN_PIECES }).coinsEarned,
    ECONOMY.COINS_MIN_PER_GAME);
  const xp0 = save.xp;
  p.recordGame({ mode: 'classic', score: 100000, lines: 10000, pieces: 900 });
  assert.equal(save.xp - xp0, P.XP_RUN_CAP);

  const xp1 = save.xp;
  const short = p.recordGame({ mode: 'classic', score: 80, lines: 1, pieces: ADS.RUN_MIN_PIECES - 1, playSec: 10 });
  assert.equal(short.counted, false);
  assert.equal(short.coinsEarned, Math.floor(80 * ECONOMY.COINS_PER_SCORE), 'no minimum for uncounted runs');
  assert.equal(save.xp, xp1, 'no XP for uncounted runs');
  assert.equal(save.stats.gamesPlayed, 2, 'uncounted runs do not advance gamesPlayed (unlock farming)');
  assert.equal(save.stats.totalScore, 40 + 100000 + 80, 'but other stats still include the run');
});

test('recordGame: journey/daily runs earn XP but no run coins and never touch the best score', () => {
  for (const mode of ['journey', 'daily']) {
    const { p, save } = setup();
    const coins0 = save.coins;
    const r = p.recordGame({ mode, score: 5000, lines: 30, maxCombo: 3, pieces: 40, playSec: 60 });
    assert.equal(r.coinsEarned, 0);
    assert.equal(r.newBest, false);
    assert.equal(r.firstRecord, false);
    assert.equal(save.coins, coins0);
    assert.equal(save.stats.bestScore, 0);
    assert.equal(save.stats.classicGames, 0);
    assert.equal(save.stats.gamesPlayed, 1);
    assert.equal(save.xp, P.XP_RUN_BASE + 30 * P.XP_PER_LINE);
  }
});

test('firstRecord is the first classic run that scores at all', () => {
  const { p } = setup();
  assert.equal(p.recordGame({ mode: 'journey', score: 300, pieces: 10 }).firstRecord, false);
  assert.equal(p.recordGame({ mode: 'classic', score: 0, pieces: 0 }).firstRecord, false);
  assert.equal(p.recordGame({ mode: 'classic', score: 120, pieces: 10 }).firstRecord, true);
  assert.equal(p.recordGame({ mode: 'classic', score: 500, pieces: 10 }).firstRecord, false);
});

test('doubleRunCoins grants the amount again', () => {
  const { p, save } = setup();
  const r = p.recordGame({ mode: 'classic', score: 2000, lines: 10, pieces: 20 });
  const coins = save.coins;
  assert.equal(p.doubleRunCoins(r.coinsEarned), r.coinsEarned);
  assert.equal(save.coins, coins + r.coinsEarned);
  assert.equal(p.doubleRunCoins(-5), 0);
});

// --- feature unlocks ----------------------------------------------------------------------------

test('features unlock progressively from CONFIG.UNLOCKS', () => {
  const { p, save } = setup();
  const state = () => ['missions', 'daily_reward', 'journey', 'daily'].map((f) => p.isFeatureUnlocked(f));
  assert.deepEqual(state(), [false, false, false, false]);
  save.stats.gamesPlayed = UNLOCKS.missions.games;
  assert.deepEqual(state(), [true, true, false, false]);
  save.stats.gamesPlayed = UNLOCKS.journey.games;
  assert.deepEqual(state(), [true, true, true, false]);
  p.completeLevel(1, 3);
  p.completeLevel(2, 3);
  assert.equal(p.isFeatureUnlocked('daily'), false);
  p.completeLevel(UNLOCKS.daily.journeyLevel - 1, 2);
  assert.equal(p.journeyUnlocked, UNLOCKS.daily.journeyLevel);
  assert.deepEqual(state(), [true, true, true, true]);
  assert.equal(p.isFeatureUnlocked('classic'), true, 'no requirement → unlocked');
});

test('the first recorded game unlocks missions and the daily reward', () => {
  const { p } = setup();
  assert.equal(p.dailyRewardStatus().available, false);
  assert.deepEqual(p.missions(), []);
  p.recordGame({ mode: 'classic', score: 500, lines: 5, pieces: 20 });
  assert.equal(p.dailyRewardStatus().available, true);
  assert.equal(p.missions().length, 3);
});

// --- login calendar -----------------------------------------------------------------------------

test('dailyRewardStatus lists the 7-day rewards from CONFIG', () => {
  const { p } = setup({ games: 1 });
  const status = p.dailyRewardStatus();
  assert.deepEqual(status.rewards.map((r) => r.coins), [...ECONOMY.DAILY_REWARDS]);
  assert.deepEqual(status.rewards.map((r) => r.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(status.rewards[6].boosters, { ...ECONOMY.DAILY_REWARD_DAY7_BOOSTERS });
  assert.equal('boosters' in status.rewards[0], false);
  assert.deepEqual({ ...status, rewards: undefined }, { available: true, day: 1, streak: 0, graceUsed: false, rewards: undefined });
});

test('login calendar: first claim, same day, gap 1, gap 2 (grace), gap 3 (reset)', () => {
  const { p, save, clock } = setup({ games: 1 });
  const coins0 = save.coins;
  let r = p.claimDailyReward();
  assert.deepEqual(r, { coins: ECONOMY.DAILY_REWARDS[0], boosters: {}, day: 1, graceUsed: false });
  assert.equal(save.coins, coins0 + ECONOMY.DAILY_REWARDS[0]);
  assert.deepEqual(save.daily, { lastClaimDay: '2026-10-18', day: 1, streak: 1 });

  const again = p.dailyRewardStatus();
  assert.equal(again.available, false);
  assert.equal(again.day, 1);
  assert.equal(again.streak, 1);
  assert.deepEqual(p.claimDailyReward(), { coins: 0, boosters: {}, day: 1, graceUsed: false });
  assert.equal(save.coins, coins0 + ECONOMY.DAILY_REWARDS[0]);

  clock.addDays(1); // gap 1
  assert.deepEqual(p.dailyRewardStatus().day, 2);
  r = p.claimDailyReward();
  assert.equal(r.day, 2);
  assert.equal(r.graceUsed, false);
  assert.equal(save.daily.streak, 2);

  clock.addDays(2); // gap 2 → grace day, streak saved
  const st = p.dailyRewardStatus();
  assert.equal(st.available, true);
  assert.equal(st.day, 3);
  assert.equal(st.graceUsed, true);
  assert.equal(st.streak, 2);
  r = p.claimDailyReward();
  assert.deepEqual(r, { coins: ECONOMY.DAILY_REWARDS[2], boosters: {}, day: 3, graceUsed: true });
  assert.equal(save.daily.streak, 3);

  clock.addDays(3); // gap 3 → back to day 1, new streak
  const broken = p.dailyRewardStatus();
  assert.equal(broken.day, 1);
  assert.equal(broken.streak, 0);
  assert.equal(broken.graceUsed, false);
  r = p.claimDailyReward();
  assert.equal(r.day, 1);
  assert.equal(save.daily.streak, 1);
});

test('login calendar: clock moved back counts as already claimed', () => {
  const { p, save, clock } = setup({ games: 1 });
  p.claimDailyReward();
  const coins = save.coins;
  clock.addDays(-2);
  const st = p.dailyRewardStatus();
  assert.equal(st.available, false);
  assert.equal(st.day, 1);
  assert.equal(p.claimDailyReward().coins, 0);
  assert.equal(save.coins, coins);
  assert.equal(save.daily.lastClaimDay, '2026-10-18');
  clock.addDays(3); // the day after the original claim
  assert.equal(p.claimDailyReward().day, 2);
});

test('login calendar wraps after day 7, day 7 adds boosters, the streak keeps counting', () => {
  const { p, save, clock } = setup({ games: 1 });
  for (let day = 1; day <= 6; day++) {
    assert.equal(p.claimDailyReward().day, day);
    clock.addDays(1);
  }
  const hammer = save.boosters.hammer;
  const shuffle = save.boosters.shuffle;
  const r = p.claimDailyReward();
  assert.deepEqual(r, { coins: ECONOMY.DAILY_REWARDS[6], boosters: { ...ECONOMY.DAILY_REWARD_DAY7_BOOSTERS }, day: 7, graceUsed: false });
  assert.equal(save.boosters.hammer, hammer + ECONOMY.DAILY_REWARD_DAY7_BOOSTERS.hammer);
  assert.equal(save.boosters.shuffle, shuffle + ECONOMY.DAILY_REWARD_DAY7_BOOSTERS.shuffle);
  clock.addDays(1);
  assert.equal(p.claimDailyReward().day, 1);
  assert.equal(save.daily.streak, 8);
  assert.equal(p.dailyRewardStatus().streak, 8);
});

test('claimDailyReward multiplier doubles coins but not boosters', () => {
  const { p, save, clock } = setup({ games: 1 });
  assert.equal(p.claimDailyReward(2).coins, 2 * ECONOMY.DAILY_REWARDS[0]);
  save.daily = { lastClaimDay: '2026-10-18', day: 6, streak: 6 };
  clock.addDays(1);
  const r = p.claimDailyReward(2);
  assert.equal(r.coins, 2 * ECONOMY.DAILY_REWARDS[6]);
  assert.deepEqual(r.boosters, { ...ECONOMY.DAILY_REWARD_DAY7_BOOSTERS });
  clock.addDays(1);
  assert.equal(p.claimDailyReward(0).coins, ECONOMY.DAILY_REWARDS[0], 'invalid multipliers count as 1');
});

// --- missions -----------------------------------------------------------------------------------

test('missions are generated per day from missions.js and regenerated on day change', () => {
  const { p, save, clock, changes } = setup({ games: 1 });
  const today = p.missions();
  assert.deepEqual(today, generateMissions('2026-10-18', 1, ['missions', 'daily_reward']));
  assert.equal(save.missions.day, '2026-10-18');
  assert.equal(changes.count, 1, 'the generated list is reported for saving');
  assert.deepEqual(p.missions(), today);
  assert.equal(changes.count, 1);

  today[0].progress = 99;
  assert.equal(p.missions()[0].progress, 0, 'missions() returns copies');

  save.missions.bonusClaimed = true;
  clock.addDays(1);
  const tomorrow = p.missions();
  assert.deepEqual(tomorrow, generateMissions('2026-10-19', 1, ['missions', 'daily_reward']));
  assert.equal(save.missions.bonusClaimed, false);
  assert.notEqual(tomorrow[0].id, today[0].id);

  clock.addDays(-3); // clock moved back: keep the list
  assert.deepEqual(p.missions(), tomorrow);
});

test('missions follow the player level and unlocked features of the day they are generated', () => {
  const { p, save } = setup({ games: 2 });
  save.journey.unlocked = UNLOCKS.daily.journeyLevel;
  save.xp = 5000;
  const level = p.levelInfo().level;
  assert.deepEqual(p.missions(), generateMissions('2026-10-18', level, ['missions', 'daily_reward', 'journey', 'daily']));
});

/** Gives the progression a hand-made mission list for today. */
function withMissions(p, clock, list) {
  p.save.missions = { day: clock.today(), list, bonusClaimed: false };
}
const m = (id, type, target, reward = 10) =>
  ({ id, type, target, progress: 0, reward, claimed: false, textKey: `mission.${type}` });

test('trackEvent advances every mission type', () => {
  const { p, clock } = setup({ games: 3 });
  withMissions(p, clock, MISSION_TYPES.map((type) => m(type, type, 100)));
  const progress = (type) => p.missions().find((x) => x.type === type).progress;

  p.trackEvent({ type: 'place', cells: 4 });
  p.trackEvent({ type: 'clear', lines: 2, combo: 1 });
  p.trackEvent({ type: 'place', cells: 3 });
  p.trackEvent({ type: 'clear', lines: 1, combo: 4 });
  p.trackEvent({ type: 'all_clear' });
  p.trackEvent({ type: 'game_end', mode: 'classic', score: 750 });
  p.trackEvent({ type: 'game_end', mode: 'classic', score: 600 });
  p.trackEvent({ type: 'level_complete', stars: 2 });
  p.trackEvent({ type: 'daily_complete' });
  p.trackEvent({ type: 'booster_used' });

  assert.equal(progress('place_pieces'), 2);
  assert.equal(progress('clear_lines'), 3);
  assert.equal(progress('multi_clear'), 1);
  assert.equal(progress('combo_reach'), 4);
  assert.equal(progress('all_clear'), 1);
  assert.equal(progress('score_single'), 100, 'capped at the target');
  assert.equal(progress('play_games'), 2);
  assert.equal(progress('journey_levels'), 1);
  assert.equal(progress('daily_challenge'), 1);
  assert.equal(progress('use_booster'), 1);
});

test('score_single keeps the best single run of the day', () => {
  const { p, clock } = setup({ games: 3 });
  withMissions(p, clock, [m('s', 'score_single', 5000)]);
  p.trackEvent({ type: 'game_end', mode: 'classic', score: 1200 });
  p.trackEvent({ type: 'game_end', mode: 'journey', score: 3100 });
  p.trackEvent({ type: 'game_end', mode: 'classic', score: 900 });
  assert.equal(p.missions()[0].progress, 3100);
  assert.equal(p.trackEvent({ type: 'game_end', mode: 'classic', score: 5200 }).length, 1);
});

test('trackEvent returns newly completed missions once; claimMission pays once', () => {
  const { p, save, clock, changes } = setup({ games: 3 });
  withMissions(p, clock, [m('a', 'place_pieces', 2, 40), m('b', 'all_clear', 1, 60), m('c', 'clear_lines', 5, 80)]);
  assert.deepEqual(p.trackEvent({ type: 'place', cells: 1 }), []);
  const done = p.trackEvent({ type: 'place', cells: 1 });
  assert.deepEqual(done.map((x) => x.id), ['a']);
  assert.equal(done[0].progress, 2);
  assert.deepEqual(p.trackEvent({ type: 'place', cells: 1 }), []);

  const before = changes.count;
  assert.deepEqual(p.trackEvent({ type: 'booster_used' }), []);
  assert.equal(changes.count, before, 'irrelevant events change nothing');

  const coins = save.coins;
  assert.equal(p.claimMission('b'), 0, 'not completed yet');
  assert.equal(p.claimMission('nope'), 0);
  assert.equal(p.claimMission('a'), 40);
  assert.equal(p.claimMission('a'), 0, 'only once');
  assert.equal(save.coins, coins + 40);
  assert.equal(p.missions()[0].claimed, true);
});

test('mission bonus becomes available after all three missions are claimed', () => {
  const { p, save, clock } = setup({ games: 3 });
  withMissions(p, clock, [m('a', 'place_pieces', 1), m('b', 'all_clear', 1), m('c', 'daily_challenge', 1)]);
  assert.deepEqual(p.missionBonusStatus(), { available: false, claimed: false });
  assert.equal(p.claimMissionBonus(), 0);
  p.trackEvent({ type: 'place', cells: 1 });
  p.trackEvent({ type: 'all_clear' });
  p.trackEvent({ type: 'daily_complete' });
  p.claimMission('a');
  p.claimMission('b');
  assert.equal(p.missionBonusStatus().available, false);
  p.claimMission('c');
  assert.deepEqual(p.missionBonusStatus(), { available: true, claimed: false });
  const coins = save.coins;
  assert.equal(p.claimMissionBonus(), ECONOMY.MISSION_BONUS_COINS);
  assert.equal(save.coins, coins + ECONOMY.MISSION_BONUS_COINS);
  assert.deepEqual(p.missionBonusStatus(), { available: false, claimed: true });
  assert.equal(p.claimMissionBonus(), 0);
});

test("yesterday's unclaimed missions expire at the day change", () => {
  const { p, clock } = setup({ games: 3 });
  withMissions(p, clock, [m('old', 'place_pieces', 1)]);
  p.trackEvent({ type: 'place', cells: 1 });
  clock.addDays(1);
  assert.equal(p.claimMission('old'), 0);
  assert.equal(p.missions().length, 3);
});

test('missions stay empty and silent while locked', () => {
  const { p, save, changes } = setup({ games: 0 });
  assert.deepEqual(p.trackEvent({ type: 'place', cells: 4 }), []);
  assert.deepEqual(save.missions.list, []);
  assert.equal(save.missions.day, null);
  assert.deepEqual(p.missionBonusStatus(), { available: false, claimed: false });
  assert.ok(changes.count <= 1, 'at most the free-coin day stamp');
});

// --- themes -------------------------------------------------------------------------------------

test('themes: coin themes are bought for their CONFIG price, level themes cannot be bought', () => {
  const { p, save, changes } = setup({ coins: 100 });
  const candy = ECONOMY.THEMES.candy;
  assert.deepEqual(p.themeUnlockInfo('candy'), { owned: false, price: candy.price, unlockLevel: candy.unlockLevel, canBuy: false });
  assert.equal(p.buyTheme('candy'), false);
  assert.equal(save.coins, 100);
  assert.equal(changes.count, 0);

  save.coins = candy.price + 7;
  assert.equal(p.themeUnlockInfo('candy').canBuy, true);
  assert.equal(p.buyTheme('candy'), true);
  assert.equal(save.coins, 7);
  assert.equal(p.ownsTheme('candy'), true);
  assert.deepEqual(p.themeUnlockInfo('candy'), { owned: true, price: candy.price, unlockLevel: candy.unlockLevel, canBuy: false });
  assert.equal(p.buyTheme('candy'), false, 'already owned');
  assert.equal(save.coins, 7);
  assert.equal(p.selectedTheme, 'jewel', 'buying does not select');

  save.coins = 1e6;
  const neon = ECONOMY.THEMES.neon;
  assert.deepEqual(p.themeUnlockInfo('neon'), { owned: false, price: 0, unlockLevel: neon.unlockLevel, canBuy: false });
  assert.equal(p.buyTheme('neon'), false);
  assert.equal(p.buyTheme('unknown'), false);
  assert.deepEqual(p.themeUnlockInfo('unknown'), { owned: false, price: 0, unlockLevel: 0, canBuy: false });
});

test('themes: selection requires ownership; invalid selections fall back to the default', () => {
  const { p, save } = setup({ coins: 1e6 });
  assert.equal(p.ownsTheme('jewel'), true);
  assert.equal(p.selectTheme('gold'), false);
  assert.equal(p.selectedTheme, 'jewel');
  assert.equal(p.buyTheme('gold'), true);
  assert.equal(p.selectTheme('gold'), true);
  assert.equal(p.selectedTheme, 'gold');
  assert.equal(save.themes.selected, 'gold');
  save.themes.selected = 'wood';
  assert.equal(p.selectedTheme, 'jewel');
  save.themes.owned = [];
  assert.equal(p.ownsTheme('jewel'), true, 'the free default theme is always owned');
  assert.equal(p.selectTheme('nope'), false);
});

// --- coins & boosters ---------------------------------------------------------------------------

test('addCoins / spendCoins', () => {
  const { p, save, changes } = setup({ coins: 50 });
  assert.equal(p.addCoins(25.9, 'test'), 25);
  assert.equal(p.coins, 75);
  assert.equal(p.addCoins(-10), 0);
  assert.equal(p.spendCoins(80), false);
  assert.equal(p.spendCoins(-1), false);
  assert.equal(p.spendCoins(1.5), false);
  assert.equal(p.spendCoins(75), true);
  assert.equal(save.coins, 0);
  assert.equal(p.spendCoins(0), true);
  assert.equal(changes.count, 2);
});

test('boosters: count, add, use, buy with CONFIG prices', () => {
  const { p, save } = setup({ coins: 0 });
  assert.equal(p.boosterCount('hammer'), ECONOMY.STARTING_BOOSTERS.hammer);
  assert.equal(p.boosterCount('shuffle'), ECONOMY.STARTING_BOOSTERS.shuffle);
  assert.equal(p.boosterCount('laser'), 0);
  assert.equal(p.addBooster('hammer', 3), ECONOMY.STARTING_BOOSTERS.hammer + 3);
  assert.equal(p.addBooster('laser', 3), 0);
  assert.equal('laser' in save.boosters, false);

  save.boosters.shuffle = 1;
  assert.equal(p.useBooster('shuffle'), true);
  assert.equal(p.useBooster('shuffle'), false);
  assert.equal(save.boosters.shuffle, 0);

  assert.equal(p.buyBooster('shuffle'), false, 'too few coins');
  save.coins = ECONOMY.BOOSTER_PRICES.shuffle + ECONOMY.BOOSTER_PRICES.hammer;
  assert.equal(p.buyBooster('shuffle'), true);
  assert.equal(save.coins, ECONOMY.BOOSTER_PRICES.hammer);
  assert.equal(p.boosterCount('shuffle'), 1);
  assert.equal(p.buyBooster('hammer'), true);
  assert.equal(save.coins, 0);
  assert.equal(p.buyBooster('laser'), false);
});

// --- journey ------------------------------------------------------------------------------------

test('completeLevel: first win vs. replays', () => {
  const { p, save } = setup();
  const coins0 = save.coins;
  let r = p.completeLevel(1, 2);
  assert.equal(r.firstTime, true);
  assert.equal(r.newStars, 2);
  assert.equal(r.coins, ECONOMY.LEVEL_COMPLETE_COINS + 2 * ECONOMY.LEVEL_STAR_COINS);
  assert.equal(save.xp, P.XP_LEVEL_WIN + 2 * P.XP_PER_STAR);
  assert.equal(save.coins, coins0 + r.coins);
  assert.equal(save.journey.stars[1], 2);
  assert.equal(p.journeyUnlocked, 2);

  const xp = save.xp;
  r = p.completeLevel(1, 1);
  assert.deepEqual({ ...r, xp: undefined }, { coins: 0, firstTime: false, newStars: 0, xp: undefined });
  assert.equal(save.journey.stars[1], 2, 'stars never decrease');
  r = p.completeLevel(1, 3);
  assert.equal(r.coins, ECONOMY.LEVEL_STAR_COINS);
  assert.equal(r.newStars, 1);
  assert.equal(r.firstTime, false);
  assert.equal(save.journey.stars[1], 3);
  assert.equal(save.xp, xp, 'replays give no level XP');

  p.completeLevel(5, 9);
  assert.equal(save.journey.stars[5], 3, 'stars are clamped to 3');
  assert.equal(p.journeyUnlocked, 6);
  p.completeLevel(2, 0);
  assert.equal(save.journey.stars[2], 1, 'a win is at least one star');
  assert.equal(p.journeyUnlocked, 6, 'replaying an earlier level never lowers the unlock');
  assert.equal(p.completeLevel(0, 3).coins, 0);
});

test('completeLevel reports XP level-ups', () => {
  const { p, save } = setup();
  save.xp = xpForLevel(1) - 1;
  const r = p.completeLevel(1, 3);
  assert.equal(r.xp.leveledUp, true);
  assert.deepEqual(r.xp.levels, [2]);
  assert.equal(r.xp.coins, ECONOMY.LEVEL_UP_COINS);
});

// --- daily challenge ----------------------------------------------------------------------------

test('completeChallenge pays only the first completion of a day', () => {
  const { p, save } = setup();
  const coins0 = save.coins;
  let r = p.completeChallenge('2026-10-18', 2);
  assert.equal(r.firstTime, true);
  assert.equal(r.coins, ECONOMY.DAILY_CHALLENGE_COINS);
  assert.equal(r.streak, 1);
  assert.equal(save.xp, P.XP_DAILY_WIN);
  assert.deepEqual(p.challengeStatus('2026-10-18'), { completed: true, stars: 2, streak: 1 });

  r = p.completeChallenge('2026-10-18', 3);
  assert.deepEqual({ ...r, xp: undefined }, { coins: 0, streak: 1, firstTime: false, xp: undefined });
  assert.deepEqual(r.xp.levels, []);
  assert.equal(save.coins, coins0 + ECONOMY.DAILY_CHALLENGE_COINS);
  assert.equal(save.xp, P.XP_DAILY_WIN);
  assert.equal(p.challengeStatus('2026-10-18').stars, 3, 'best stars are kept');
  assert.deepEqual(p.challengeStatus('2026-10-17'), { completed: false, stars: 0, streak: 1 });
});

test('challenge streak counts consecutive challenge days', () => {
  const { p, clock } = setup();
  assert.equal(p.completeChallenge(clock.today(), 1).streak, 1);
  clock.addDays(1);
  assert.equal(p.completeChallenge(clock.today(), 1).streak, 2);
  clock.addDays(1);
  assert.equal(p.completeChallenge(clock.today(), 1).streak, 3);
  clock.addDays(2);
  assert.equal(p.challengeStatus(clock.today()).streak, 0, 'a missed day breaks the shown streak');
  assert.equal(p.completeChallenge(clock.today(), 1).streak, 1);
});

test('a daily run is credited to its own day, even when finished after midnight', () => {
  const { p, clock, save } = setup();
  clock.at('2026-10-17', 20);
  p.completeChallenge('2026-10-17', 3);
  clock.at('2026-10-19', 0, 5); // the 10-18 run finished after midnight
  const r = p.completeChallenge('D2026-10-18', 2); // a level id works too
  assert.equal(r.firstTime, true);
  assert.equal(r.streak, 2);
  assert.deepEqual(save.challenge.completed, { '2026-10-17': 3, '2026-10-18': 2 });
  assert.equal(p.challengeStatus('2026-10-19').completed, false);
  assert.equal(p.challengeStatus('D2026-10-18').completed, true);

  // an older day finished late neither breaks nor extends the streak
  p.completeChallenge('2026-10-19', 1);
  const late = p.completeChallenge('2026-10-10', 1);
  assert.equal(late.firstTime, true);
  assert.equal(late.coins, ECONOMY.DAILY_CHALLENGE_COINS);
  assert.equal(late.streak, 3);
  assert.equal(save.challenge.lastDay, '2026-10-19');

  const before = JSON.stringify(save);
  assert.equal(p.completeChallenge('not-a-day', 3).coins, 0);
  assert.equal(JSON.stringify(save), before);
});

// --- free coins, gifts, grants ------------------------------------------------------------------

test('free coins: FREE_COINS_ADS_PER_DAY grants per day', () => {
  const { p, save, clock } = setup({ coins: 0 });
  assert.equal(p.freeCoinsLeft(), ADS.FREE_COINS_ADS_PER_DAY);
  for (let i = 0; i < ADS.FREE_COINS_ADS_PER_DAY; i++) assert.equal(p.grantFreeCoins(), ECONOMY.FREE_COINS_AD_AMOUNT);
  assert.equal(p.freeCoinsLeft(), 0);
  assert.equal(p.grantFreeCoins(), 0);
  assert.equal(save.coins, ADS.FREE_COINS_ADS_PER_DAY * ECONOMY.FREE_COINS_AD_AMOUNT);
  clock.addDays(-1);
  assert.equal(p.freeCoinsLeft(), 0, 'moving the clock back does not refill');
  clock.addDays(2);
  assert.equal(p.freeCoinsLeft(), ADS.FREE_COINS_ADS_PER_DAY);
  assert.equal(p.grantFreeCoins(), ECONOMY.FREE_COINS_AD_AMOUNT);
});

test('grantRemoveAdsGift is granted once', () => {
  const { p, save } = setup({ coins: 0 });
  const hammer = save.boosters.hammer;
  const shuffle = save.boosters.shuffle;
  assert.deepEqual(p.grantRemoveAdsGift(), { ...ECONOMY.REMOVE_ADS_GIFT });
  assert.equal(save.coins, ECONOMY.REMOVE_ADS_GIFT.coins);
  assert.equal(save.boosters.hammer, hammer + ECONOMY.REMOVE_ADS_GIFT.hammer);
  assert.equal(save.boosters.shuffle, shuffle + ECONOMY.REMOVE_ADS_GIFT.shuffle);
  assert.equal(save.iap.adsGiftGranted, true);
  assert.equal(p.grantRemoveAdsGift(), null);
  assert.equal(save.coins, ECONOMY.REMOVE_ADS_GIFT.coins);
});

test('applyGrant is idempotent by token and ignores unknown products', () => {
  const { p, save, changes } = setup({ coins: 0 });
  assert.deepEqual(p.applyGrant('tok-1', 'coins_small'), { coins: PRODUCTS.coins_small.coins, duplicate: false, unknown: false });
  assert.deepEqual(p.applyGrant('tok-1', 'coins_small'), { coins: 0, duplicate: true, unknown: false });
  assert.deepEqual(p.applyGrant('tok-2', 'coins_large'), { coins: PRODUCTS.coins_large.coins, duplicate: false, unknown: false });
  assert.equal(save.coins, PRODUCTS.coins_small.coins + PRODUCTS.coins_large.coins);
  assert.deepEqual(save.iap.grantedTokens, ['tok-1', 'tok-2']);
  assert.equal(changes.count, 2);

  for (const [token, product] of [['tok-3', 'gems_huge'], ['tok-4', 'remove_ads'], ['', 'coins_small'], [null, 'coins_small'], ['tok-5', 'toString']]) {
    assert.deepEqual(p.applyGrant(token, product), { coins: 0, duplicate: false, unknown: true }, `${token}/${product}`);
  }
  assert.deepEqual(save.iap.grantedTokens, ['tok-1', 'tok-2'], 'unknown grants are not recorded');
  assert.equal(changes.count, 2);
});

test('applyGrant remembers the last 100 tokens', () => {
  const { p, save } = setup();
  for (let i = 0; i < 105; i++) p.applyGrant(`t${i}`, 'coins_small');
  assert.equal(save.iap.grantedTokens.length, 100);
  assert.equal(save.iap.grantedTokens[0], 't5');
  assert.equal(save.iap.grantedTokens[99], 't104');
  assert.equal(p.applyGrant('t104', 'coins_small').duplicate, true);
});

// --- change notifications -----------------------------------------------------------------------

test('onChange fires once per mutating call and never for reads or refused actions', () => {
  const { p, changes } = setup({ games: 1, coins: 0 });
  p.levelInfo();
  void p.coins;
  void p.bestScore;
  p.ownsTheme('candy');
  p.themeUnlockInfo('gold');
  p.boosterCount('hammer');
  p.isFeatureUnlocked('journey');
  assert.equal(changes.count, 0);
  p.buyTheme('gold');
  p.buyBooster('hammer');
  p.useBooster('laser');
  p.selectTheme('pixel');
  p.spendCoins(10);
  assert.equal(changes.count, 0);

  p.dailyRewardStatus(); // first day-scoped call stamps missions + free coins
  assert.equal(changes.count, 1);
  p.dailyRewardStatus();
  assert.equal(changes.count, 1);
  p.claimDailyReward();
  assert.equal(changes.count, 2);
  p.recordGame({ mode: 'classic', score: 50000, lines: 500, pieces: 300, playSec: 600 });
  assert.equal(changes.count, 3);
  p.completeLevel(1, 3);
  assert.equal(changes.count, 4);
  p.selectTheme('jewel'); // already selected
  assert.equal(changes.count, 4);
});

test('works without onChange and with the default clock', () => {
  const p = new Progression(defaultSave());
  assert.equal(p.recordGame({ mode: 'classic', score: 400, lines: 4, pieces: 10 }).counted, true);
  assert.equal(p.missions().length, 3);
  assert.equal(p.save.missions.day, dayKey(new Date()));
});
