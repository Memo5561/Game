import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { ECONOMY_PROFILES, simulatePlayer } from '../../tools/simulate.mjs';

const E = CONFIG.ECONOMY;

test('economy simulation: every coin is attributed to a source and the balance adds up', () => {
  for (const ads of [false, true]) {
    const r = simulatePlayer(ECONOMY_PROFILES.casual, { ads, days: 4, seed: 7 });
    const income = Object.values(r.incomeBy).reduce((a, b) => a + b, 0);
    assert.equal(r.cumulative[r.cumulative.length - 1], income, `income by source = income by day (ads ${ads})`);
    assert.equal(r.finalBalance, E.STARTING_COINS + income - r.spent, `balance = start + income - purchases (ads ${ads})`);
    assert.equal(r.days.length, 4);
    assert.ok(r.runCoins.length >= 4 && r.runCoins.every((c) => c >= 0));
    if (!ads) assert.ok(!('x2 videos' in r.incomeBy) && !('free-coin videos' in r.incomeBy), 'no ad income without ads');
    else assert.ok(r.incomeBy['x2 videos'] > 0 && r.incomeBy['free-coin videos'] > 0);
  }
});

test('economy simulation is deterministic and a play day pays a plausible amount', () => {
  const a = simulatePlayer(ECONOMY_PROFILES.casual, { ads: false, days: 3, seed: 1 });
  const b = simulatePlayer(ECONOMY_PROFILES.casual, { ads: false, days: 3, seed: 1 });
  assert.deepEqual(a.days, b.days);
  const perDay = a.cumulative[a.cumulative.length - 1] / 3;
  assert.ok(perDay > 150 && perDay < 3000, `casual income ${perDay}/day`);
  // a classic run pays the concave formula, never a minimum
  assert.ok(a.runCoins.every((c) => c <= Math.floor(E.RUN_COINS_FACTOR * Math.sqrt(100000))));
});
