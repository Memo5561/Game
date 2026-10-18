import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { generateLevel, generateDailyLevel, levelKind, levelEffort, PATTERN_NAMES, PATTERN_TEMPLATES } from '../../game/js/core/levels.js';
import { GameSession } from '../../game/js/core/game.js';
import { analyzeTray } from '../../game/js/core/generator.js';
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

/** Occupancy of the prefilled cells as a string (identical string = identical board layout). */
const layoutOf = (L) => {
  const grid = new Array(64).fill('.');
  for (const { r, c } of L.prefilled) grid[r * 8 + c] = '#';
  return grid.join('');
};

test('template library: 8x8, no full row/column, unique names and layouts', () => {
  assert.ok(PATTERN_TEMPLATES.length >= 70, `${PATTERN_TEMPLATES.length} templates`);
  assert.equal(new Set(PATTERN_NAMES).size, PATTERN_NAMES.length, 'unique names');
  const layouts = new Set();
  for (const t of PATTERN_TEMPLATES) {
    assert.equal(t.rows.length, 8, `${t.name} rows`);
    assert.ok(t.rows.every((row) => /^[.a-k]{8}$/.test(row)), `${t.name} chars`);
    for (let i = 0; i < 8; i++) {
      assert.ok(t.rows[i].includes('.'), `${t.name} row ${i} is full`);
      assert.ok(t.rows.some((row) => row[i] === '.'), `${t.name} column ${i} is full`);
    }
    assert.ok([1, 2, 3].includes(t.tier));
    const layout = t.rows.join('').replace(/[a-k]/g, '#');
    assert.ok(!layouts.has(layout), `${t.name} duplicates another template`);
    layouts.add(layout);
  }
  const tier3 = PATTERN_TEMPLATES.filter((t) => t.tier === 3).length;
  assert.ok(tier3 >= 40, `${tier3} dense (tier 3) templates for the hard / super hard pools`);
});

test('layout variety: peaks avoid their last template picks, no exact layout repeats (levels 1-500)', () => {
  const last = { hard: [], superhard: [] };
  const peaks = [];
  const layouts = new Map();
  const used = { normal: new Set(), hard: new Set(), superhard: new Set() };
  for (let n = 1; n <= 500; n++) {
    const L = generateLevel(n);
    used[L.tag].add(L.pattern);
    const layout = layoutOf(L);
    assert.ok(!layouts.has(layout), `L${n} (${L.pattern}) repeats the board of L${layouts.get(layout)}`);
    layouts.set(layout, n);
    if (L.tag === 'normal') continue;
    assert.ok(!last[L.tag].slice(-4).includes(L.pattern), `L${n} reuses a ${L.tag} template of its last 4 ${L.tag} levels`);
    assert.ok(!peaks.slice(-2).includes(L.pattern), `L${n} reuses a template of the last 2 peaks`);
    last[L.tag].push(L.pattern);
    peaks.push(L.pattern);
  }
  assert.ok(used.superhard.size >= 14, `super hard templates: ${used.superhard.size}`);
  assert.ok(used.hard.size >= 20, `hard templates: ${used.hard.size}`);
  assert.ok(used.normal.size >= 40, `normal templates: ${used.normal.size}`);
});

test('layout variants: levels stay valid and independent of the order they are requested in', async () => {
  const forward = [];
  for (let n = 1; n <= 120; n++) forward.push(generateLevel(n));
  // a fresh module instance asked for the levels in another order (the layout history is lazy)
  const fresh = await import(`../../game/js/core/levels.js?order=${Date.now()}`);
  for (let n = 120; n >= 1; n -= 7) assert.deepEqual(fresh.generateLevel(n), forward[n - 1], `L${n}`);
  for (const L of forward) assertValidLevel(L);
  // the first-session levels keep their template unshifted
  for (let n = 1; n <= 9; n++) {
    const L = generateLevel(n);
    const tpl = PATTERN_TEMPLATES.find((t) => t.name === L.pattern);
    const layout = layoutOf(L);
    const variants = new Set();
    for (const sym of [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]) {
      const g = new Array(64).fill('.');
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (tpl.rows[r][c] === '.') continue;
          let rr = sym[1] ? 7 - r : r;
          let cc = sym[2] ? 7 - c : c;
          if (sym[0]) [rr, cc] = [cc, rr];
          g[rr * 8 + cc] = '#';
        }
      }
      variants.add(g.join(''));
    }
    assert.ok(variants.has(layout), `L${n} (${L.pattern}) is an unshifted symmetry of its template`);
  }
});

test('journey and daily opening trays are always fully placeable (levels 1-200 x seeds, 60 daily keys)', () => {
  const check = (level, seed) => {
    const s = GameSession.create({ mode: level.kind, level, seed });
    const shapes = s.tray.map((p) => p.shapeId);
    assert.ok(analyzeTray(s.board, shapes, { nodeLimit: 1e7 }).solvable, `${level.id} seed ${seed}: ${shapes} cannot be placed together`);
  };
  for (let n = 1; n <= 200; n++) {
    const level = generateLevel(n);
    for (let k = 1; k <= 30; k++) check(level, (k * 2654435761 + n) >>> 0);
  }
  for (let d = 0; d < 60; d++) {
    const level = generateDailyLevel(new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10));
    for (let k = 1; k <= 20; k++) check(level, (k * 40503 + d) >>> 0);
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
