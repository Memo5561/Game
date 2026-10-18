import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { generateLevel, generateDailyLevel, levelKind, levelEffort, PATTERN_NAMES } from '../../game/js/core/levels.js';
import { GameSession } from '../../game/js/core/game.js';
import { hashString } from '../../game/js/core/rng.js';
import { playOut } from '../../tools/simulate.mjs';

/** Shared validity checks for journey and daily levels. */
function assertValidLevel(L) {
  const where = L.id;
  assert.equal(typeof L.seed, 'number');
  assert.equal(L.seed, hashString(L.id), `${where} seed`);
  assert.ok(L.difficulty >= 0 && L.difficulty <= 1, `${where} difficulty`);
  assert.ok(['normal', 'hard', 'superhard'].includes(L.tag), `${where} tag`);
  assert.ok(PATTERN_NAMES.includes(L.pattern), `${where} pattern`);
  const filled = new Set();
  const rowCount = new Array(8).fill(0);
  const colCount = new Array(8).fill(0);
  for (const { r, c, color } of L.prefilled) {
    assert.ok(r >= 0 && r < 8 && c >= 0 && c < 8, `${where} prefilled bounds`);
    assert.ok(Number.isInteger(color) && color >= 0 && color < 8, `${where} color`);
    const k = r * 8 + c;
    assert.ok(!filled.has(k), `${where} duplicate prefilled cell`);
    filled.add(k);
    rowCount[r]++;
    colCount[c]++;
  }
  assert.ok(rowCount.every((n) => n < 8) && colCount.every((n) => n < 8), `${where} has a full line`);
  const gemCells = new Set();
  const byType = {};
  for (const { r, c, type } of L.gems) {
    assert.ok(filled.has(r * 8 + c), `${where} gem not on a prefilled cell`);
    assert.ok([1, 2, 3].includes(type), `${where} gem type`);
    assert.ok(!gemCells.has(r * 8 + c), `${where} two gems on one cell`);
    gemCells.add(r * 8 + c);
    byType[type] = (byType[type] || 0) + 1;
  }
  if (L.gems.length) assert.deepEqual(L.goals.gems, byType, `${where} gem goals`);
  const [par3, par2] = L.par;
  assert.ok(Number.isInteger(par3) && par3 >= 1 && par2 > par3, `${where} par`);
  assert.ok(L.rewardCoins > 0);
}

test('journey levels are deterministic and valid', () => {
  for (let n = 1; n <= 250; n++) {
    const L = generateLevel(n);
    assert.deepEqual(L, generateLevel(n), `L${n} deterministic`);
    assert.equal(L.id, `L${n}`);
    assert.equal(L.kind, 'journey');
    assert.equal(L.number, n);
    assert.equal(L.tag, levelKind(n));
    assert.ok(L.gems.length >= 2, `L${n} has gems`);
    assert.ok(L.rewardCoins >= CONFIG.ECONOMY.LEVEL_COMPLETE_COINS);
    assertValidLevel(L);
  }
  assert.notDeepEqual(generateLevel(3).prefilled, generateLevel(4).prefilled);
  assert.throws(() => generateLevel(0), RangeError);
  assert.throws(() => generateLevel(1.5), RangeError);
});

test('sawtooth: tags and difficulty formula', () => {
  for (let n = 1; n <= 9; n++) assert.equal(levelKind(n), 'normal');
  assert.equal(levelKind(10), 'superhard', 'first hard level is 10');
  assert.equal(levelKind(15), 'hard');
  assert.equal(levelKind(20), 'superhard');
  assert.equal(levelKind(21), 'normal');
  const base = (n) => Math.min(0.85, 0.15 + 0.012 * n);
  const close = (a, b) => Math.abs(a - b) < 0.006;
  assert.ok(close(generateLevel(1).difficulty, base(1)));
  assert.ok(close(generateLevel(5).difficulty, base(5)), 'level 5 is normal');
  assert.ok(close(generateLevel(10).difficulty, base(10) + 0.25));
  assert.ok(close(generateLevel(11).difficulty, base(11) - 0.1), 'breather after a peak');
  assert.ok(close(generateLevel(15).difficulty, base(15) + 0.12));
  assert.ok(close(generateLevel(16).difficulty, base(16) - 0.1));
  assert.ok(close(generateLevel(17).difficulty, base(17)));
  assert.equal(generateLevel(80).difficulty, 1, 'clamped to 1');
});

test('gems: 2–3 at level 1, more and harder later', () => {
  const g1 = generateLevel(1).gems.length;
  assert.ok(g1 >= 2 && g1 <= 3, `level 1 has ${g1} gems`);
  for (let n = 30; n <= 50; n++) {
    const g = generateLevel(n).gems.length;
    assert.ok(g >= 8 && g <= 12, `L${n} has ${g} gems`);
  }
  const avgEffort = (from, to) => {
    let sum = 0;
    for (let n = from; n <= to; n++) sum += levelEffort(generateLevel(n)).pieces;
    return sum / (to - from + 1);
  };
  assert.ok(avgEffort(41, 60) > avgEffort(1, 9) + 5, 'later levels need clearly more effort');
});

test('templates are not repeated within a few consecutive levels', () => {
  for (let n = 1; n <= 200; n++) {
    const names = [n, n + 1, n + 2, n + 3].map((k) => generateLevel(k).pattern);
    assert.equal(new Set(names).size, 4, `levels ${n}..${n + 3}: ${names}`);
  }
});

test('daily levels are deterministic, valid and scale with the weekday', () => {
  const byWeekday = Array.from({ length: 7 }, () => []);
  for (let d = 0; d < 70; d++) {
    const date = new Date(Date.UTC(2026, 9, 1 + d));
    const key = date.toISOString().slice(0, 10);
    const L = generateDailyLevel(key);
    assert.deepEqual(L, generateDailyLevel(key));
    assert.equal(L.id, `D${key}`);
    assert.equal(L.kind, 'daily');
    assert.equal(L.number, Number(key.replace(/-/g, '')));
    assert.ok(L.goals.score >= 700 && L.goals.score <= 2800, `${key} score goal ${L.goals.score}`);
    assert.equal(L.rewardCoins, CONFIG.ECONOMY.DAILY_CHALLENGE_COINS);
    assertValidLevel(L);
    byWeekday[date.getUTCDay()].push(L.goals.score);
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(avg(byWeekday[1]) < avg(byWeekday[3]) && avg(byWeekday[3]) < avg(byWeekday[0]), 'Monday < Wednesday < Sunday');
  assert.throws(() => generateDailyLevel('2026/10/18'), RangeError);
});

test('levels are completable: a simple bot wins (almost) all early levels on the first try', () => {
  let firstTry = 0;
  let withRevive = 0;
  let attempts = 0;
  for (let n = 1; n <= 30; n++) {
    const level = generateLevel(n);
    for (let a = 0; a < 3; a++) {
      const s = GameSession.create({ mode: 'journey', level, seed: hashString(`test-${n}-${a}`), gamesPlayed: 10 });
      playOut(s, { revive: true, bot: 'greedy' });
      attempts++;
      if (s.status === 'won') {
        withRevive++;
        if (!s.reviveUsed) firstTry++;
        assert.ok(s.stars() >= 1 && s.stars() <= 3);
      }
      if (n <= 9) assert.equal(s.status, 'won', `L${n} attempt ${a}`);
    }
  }
  assert.ok(withRevive / attempts >= 0.95, `with revive ${withRevive}/${attempts}`);
  assert.ok(firstTry / attempts >= 0.7, `first try ${firstTry}/${attempts}`);
});
