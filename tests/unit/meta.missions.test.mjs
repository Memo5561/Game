import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { MISSION_TYPES, MULTI_CLEAR_LINES, generateMissions, progressMissions } from '../../game/js/meta/missions.js';

const FEATURE_OF = { journey_levels: 'journey', use_booster: 'journey', daily_challenge: 'daily' };
const ALL_FEATURES = ['missions', 'daily_reward', 'journey', 'daily'];

/** 'YYYY-MM-DD' keys of `n` consecutive days (computed in UTC, independent of the local zone). */
function days(n, start = Date.UTC(2026, 0, 1)) {
  return Array.from({ length: n }, (_, i) => new Date(start + i * 864e5).toISOString().slice(0, 10));
}

const mission = (type, target, extra = {}) =>
  ({ id: type, type, target, progress: 0, reward: 1, claimed: false, textKey: `mission.${type}`, ...extra });

test('MISSION_TYPES lists the ten contract types', () => {
  assert.deepEqual([...MISSION_TYPES].sort(), [
    'all_clear', 'clear_lines', 'combo_reach', 'daily_challenge', 'journey_levels', 'multi_clear',
    'place_pieces', 'play_games', 'score_single', 'use_booster',
  ]);
  assert.ok(Object.isFrozen(MISSION_TYPES));
});

test('generateMissions returns easy/medium/hard missions of three distinct types', () => {
  for (const day of days(120)) {
    const list = generateMissions(day, 4, ALL_FEATURES);
    assert.equal(list.length, 3);
    assert.equal(new Set(list.map((m) => m.type)).size, 3, day);
    assert.equal(new Set(list.map((m) => m.id)).size, 3);
    list.forEach((m, slot) => {
      assert.deepEqual(Object.keys(m).sort(), ['claimed', 'id', 'progress', 'reward', 'target', 'textKey', 'type']);
      assert.ok(MISSION_TYPES.includes(m.type));
      assert.ok(m.id.startsWith(day));
      assert.equal(m.reward, CONFIG.ECONOMY.MISSION_REWARDS[slot]);
      assert.equal(m.textKey, `mission.${m.type}`);
      assert.ok(Number.isInteger(m.target) && m.target >= 1);
      assert.equal(m.progress, 0);
      assert.equal(m.claimed, false);
    });
  }
});

test('generateMissions is deterministic per day and varies across days', () => {
  const a = generateMissions('2026-10-18', 5, ['journey']);
  const b = generateMissions('2026-10-18', 5, new Set(['journey']));
  assert.deepEqual(a, b);
  a[0].progress = 9;
  assert.equal(generateMissions('2026-10-18', 5, ['journey'])[0].progress, 0, 'fresh objects');
  const signatures = new Set(days(30).map((d) => generateMissions(d, 5, ['journey']).map((m) => m.type).join()));
  assert.ok(signatures.size >= 10, `only ${signatures.size} distinct mission sets in 30 days`);
});

test('missions for locked features are never generated', () => {
  const seen = { none: new Set(), journey: new Set(), all: new Set() };
  for (const day of days(730)) {
    for (const m of generateMissions(day, 3, [])) seen.none.add(m.type);
    for (const m of generateMissions(day, 3, ['missions', 'journey'])) seen.journey.add(m.type);
    for (const m of generateMissions(day, 3, ALL_FEATURES)) seen.all.add(m.type);
  }
  for (const [type, feature] of Object.entries(FEATURE_OF)) {
    assert.equal(seen.none.has(type), false, `${type} without ${feature}`);
    assert.equal(seen.journey.has(type), feature === 'journey', type);
  }
  assert.deepEqual([...seen.all].sort(), MISSION_TYPES.filter((t) => t !== 'all_clear').sort(),
    'every type but the luck-based all_clear shows up once unlocked');
  // generateMissions with no unlock list behaves like an empty one
  assert.deepEqual(generateMissions('2026-10-18', 1), generateMissions('2026-10-18', 1, []));
});

test('all_clear (luck, not skill) is never generated any more but old saved lists still progress', () => {
  for (const day of days(400)) {
    for (const features of [[], ['journey'], ALL_FEATURES]) {
      for (const level of [1, 8, 30]) {
        assert.ok(generateMissions(day, level, features).every((m) => m.type !== 'all_clear'), `${day} ${features}`);
      }
    }
  }
  // a list stored by an older version: the all_clear mission still advances, completes and keeps its text key
  const saved = [mission('all_clear', 1, { id: '2026-10-01-2', textKey: 'mission.all_clear', reward: 70 })];
  const res = progressMissions(saved, { type: 'all_clear' });
  assert.equal(res.completed.length, 1);
  assert.equal(saved[0].progress, 1);
  assert.ok(MISSION_TYPES.includes('all_clear'), 'the type (and its text) stays known');
});

test('every generated mission is reachable by skill: the hard slot only uses skill or volume based types', () => {
  const hardTypes = new Set();
  for (const day of days(500)) hardTypes.add(generateMissions(day, 5, ALL_FEATURES)[2].type);
  assert.deepEqual([...hardTypes].sort(), ['clear_lines', 'combo_reach', 'daily_challenge', 'journey_levels', 'multi_clear',
    'place_pieces', 'play_games', 'score_single']);
});

test('targets grow gently and monotonically with the player level, then cap', () => {
  let grew = 0;
  for (const day of days(60)) {
    let prev = generateMissions(day, 1, ALL_FEATURES);
    for (let level = 2; level <= 40; level++) {
      const cur = generateMissions(day, level, ALL_FEATURES);
      cur.forEach((m, i) => {
        assert.equal(m.type, prev[i].type, 'the level never changes which types are chosen');
        assert.ok(m.target >= prev[i].target);
        assert.ok(m.target <= 2 * generateMissions(day, 1, ALL_FEATURES)[i].target, 'gentle: at most ×2');
      });
      prev = cur;
    }
    const l1 = generateMissions(day, 1, ALL_FEATURES);
    if (l1.some((m, i) => m.target < prev[i].target)) grew++;
    assert.deepEqual(generateMissions(day, 100, ALL_FEATURES), generateMissions(day, 16, ALL_FEATURES));
  }
  assert.ok(grew > 0, 'volume targets scale with the level');
  // invalid levels count as level 1
  assert.deepEqual(generateMissions('2026-10-18', NaN, []), generateMissions('2026-10-18', 1, []));
});

test('progressMissions advances each type on its event', () => {
  const list = MISSION_TYPES.map((type) => mission(type, 1000));
  const get = (type) => list.find((m) => m.type === type).progress;
  const send = (evt) => progressMissions(list, evt);

  send({ type: 'place', cells: 4 });
  send({ type: 'place', cells: 1 });
  assert.equal(get('place_pieces'), 2);

  send({ type: 'clear', lines: MULTI_CLEAR_LINES, combo: 3 });
  send({ type: 'clear', lines: 1, combo: 2 });
  assert.equal(get('clear_lines'), MULTI_CLEAR_LINES + 1);
  assert.equal(get('multi_clear'), 1);
  assert.equal(get('combo_reach'), 3, 'combo_reach keeps the highest combo');

  send({ type: 'all_clear' });
  assert.equal(get('all_clear'), 1);

  send({ type: 'game_end', mode: 'classic', score: 500 });
  send({ type: 'game_end', mode: 'journey', score: 300 });
  assert.equal(get('score_single'), 500, 'best single run, not a sum');
  assert.equal(get('play_games'), 2);
  send({ type: 'game_end', mode: 'classic', score: 10, pieces: CONFIG.ADS.RUN_MIN_PIECES - 1 });
  assert.equal(get('play_games'), 2, 'trivially short runs do not count when pieces is given');
  send({ type: 'game_end', mode: 'classic', score: 10, pieces: CONFIG.ADS.RUN_MIN_PIECES });
  assert.equal(get('play_games'), 3);

  send({ type: 'level_complete', stars: 3 });
  send({ type: 'daily_complete' });
  send({ type: 'booster_used' });
  assert.equal(get('journey_levels'), 1);
  assert.equal(get('daily_challenge'), 1);
  assert.equal(get('use_booster'), 1);

  const before = JSON.stringify(list);
  assert.deepEqual(send({ type: 'unknown_event' }), { changed: false, completed: [] });
  assert.deepEqual(send(null), { changed: false, completed: [] });
  assert.equal(JSON.stringify(list), before);
});

test('progressMissions caps progress, reports completion once and returns copies', () => {
  const list = [mission('clear_lines', 5), mission('place_pieces', 1), mission('all_clear', 1, { claimed: true })];
  let res = progressMissions(list, { type: 'clear', lines: 3, combo: 1 });
  assert.deepEqual(res, { changed: true, completed: [] });
  res = progressMissions(list, { type: 'clear', lines: 4, combo: 2 });
  assert.equal(list[0].progress, 5);
  assert.equal(res.completed.length, 1);
  assert.equal(res.completed[0].id, 'clear_lines');
  res.completed[0].progress = 0;
  assert.equal(list[0].progress, 5, 'completed entries are copies');
  assert.deepEqual(progressMissions(list, { type: 'clear', lines: 4, combo: 3 }), { changed: false, completed: [] });

  assert.equal(progressMissions(list, { type: 'place' }).completed[0].id, 'place_pieces');
  progressMissions(list, { type: 'all_clear' });
  assert.equal(list[2].progress, 0, 'claimed missions never change');
  assert.deepEqual(progressMissions('nope', { type: 'place' }), { changed: false, completed: [] });
});
