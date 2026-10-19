// Fun assist (near-record help, gentler restart, ads that spare emotional moments).
// The hard rule under test: assistance only ever HELPS, never depends on device/time, never alters the score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { Board } from '../../game/js/core/board.js';
import { RNG } from '../../game/js/core/rng.js';
import { analyzeTray, PieceGenerator } from '../../game/js/core/generator.js';
import { GameSession, listValidMoves } from '../../game/js/core/game.js';
import { getShape } from '../../game/js/core/shapes.js';
import { defaultSave } from '../../game/js/meta/storage.js';
import { Progression } from '../../game/js/meta/progression.js';
import { AdPolicy } from '../../game/js/meta/adpolicy.js';

const GEN = CONFIG.GENERATOR;
const A = GEN.ASSIST;
const ALWAYS = Object.freeze({ ...GEN, ASSIST: Object.freeze({ ...A, NEAR_RECORD_P: 1 }) });
const NEVER = Object.freeze({ ...GEN, ASSIST: Object.freeze({ ...A, NEAR_RECORD_P: 0 }) });

function botMove(session) {
  const moves = listValidMoves(session);
  moves.sort((a, b) => b.lines - a.lines || b.cells - a.cells || a.trayIndex - b.trayIndex || a.r - b.r || a.c - b.c);
  return moves[0];
}

function randomBoard(rng, fill) {
  for (;;) {
    const b = new Board(8);
    for (let i = 0; i < 64; i++) if (rng.chance(fill)) b.cells[i] = 1;
    const { rows, cols } = b.findFullLines();
    if (rows.length === 0 && cols.length === 0) return b;
  }
}

// --- (a) assistance only helps ----------------------------------------------------------------

test('assist: the dealt tray is solvable+clearing at least as often as without assist, never less solvable', () => {
  const picker = new RNG(4242);
  const opts = { nodeLimit: 200000, targetLines: 0 };
  let n = 0;
  const stat = { off: { solvable: 0, clearing: 0 }, on: { solvable: 0, clearing: 0 } };
  for (let i = 0; i < 400; i++) {
    const board = randomBoard(picker, 0.25 + picker.next() * 0.35); // below MERCY_FILL, so only the assist can trigger
    const ctx = { trayIndex: 30, fill: board.fillRatio(), traysSinceClear: 0, experience: 20 };
    for (const [key, cfg, nearRecord] of [['off', NEVER, false], ['on', ALWAYS, true]]) {
      const gen = new PieceGenerator({ rng: new RNG(1000 + i), mode: 'classic', config: cfg });
      const tray = gen.nextTray(board, { ...ctx, nearRecord });
      const a = analyzeTray(board, tray.map((p) => getShape(p.shapeId)), opts);
      if (a.solvable) stat[key].solvable++;
      if (a.solvable && a.maxLines >= 1) stat[key].clearing++;
    }
    n++;
  }
  assert.ok(stat.on.solvable >= stat.off.solvable, `solvable ${stat.on.solvable} >= ${stat.off.solvable}`);
  assert.ok(stat.on.clearing >= stat.off.clearing, `clearing ${stat.on.clearing} >= ${stat.off.clearing}`);
  assert.ok(stat.on.clearing > stat.off.clearing, 'the assist makes a visible difference');
  assert.ok(stat.on.solvable / n > 0.97, 'assisted trays are practically always solvable');
});

test('assist: nearRecord does not change how many rng values a tray consumes (same stream, with or without)', () => {
  const board = randomBoard(new RNG(5), 0.3);
  for (const cfg of [GEN, ALWAYS, NEVER]) {
    const a = new PieceGenerator({ rng: new RNG(9), mode: 'classic', config: cfg });
    const b = new PieceGenerator({ rng: new RNG(9), mode: 'classic', config: cfg });
    a.nextTray(board, { trayIndex: 20, experience: 20, nearRecord: true });
    b.nextTray(board, { trayIndex: 20, experience: 20, nearRecord: false });
    assert.deepEqual(a.rng.getState(), b.rng.getState());
  }
});

test('assist: journey/daily/tutorial generators ignore nearRecord entirely', () => {
  const board = randomBoard(new RNG(6), 0.3);
  for (const mode of ['journey', 'daily']) {
    const level = { difficulty: 0.5 };
    const on = new PieceGenerator({ rng: new RNG(3), mode, config: ALWAYS }).nextTray(board, { trayIndex: 5, level, nearRecord: true });
    const off = new PieceGenerator({ rng: new RNG(3), mode, config: ALWAYS }).nextTray(board, { trayIndex: 5, level, nearRecord: false });
    assert.deepEqual(on, off, mode);
  }
});

// --- (b) when the assist is active ----------------------------------------------------------------

test('isNearRecord: only classic, best >= MIN_BEST, score in [FROM*best, best)', () => {
  const mk = (opts) => GameSession.create({ mode: 'classic', seed: 1, ...opts });
  const s = mk({ bestScore: 4000 });
  const lo = A.NEAR_RECORD_FROM * 4000;
  s.score = lo - 1;
  assert.equal(s.isNearRecord(), false, 'too far below');
  s.score = lo;
  assert.equal(s.isNearRecord(), true);
  s.score = 3999;
  assert.equal(s.isNearRecord(), true);
  s.score = 4000;
  assert.equal(s.isNearRecord(), false, 'ties do not count: the assist ends at the record');
  s.score = 9000;
  assert.equal(s.isNearRecord(), false, 'never after the record is broken');

  const small = mk({ bestScore: A.MIN_BEST - 1 });
  small.score = A.MIN_BEST - 2;
  assert.equal(small.isNearRecord(), false, 'best below MIN_BEST');
  const edge = mk({ bestScore: A.MIN_BEST });
  edge.score = A.MIN_BEST - 1;
  assert.equal(edge.isNearRecord(), true);
  assert.equal(mk({ bestScore: 0 }).isNearRecord(), false);

  for (const mode of ['journey', 'daily']) {
    const level = { number: 1, difficulty: 0.3, prefilled: [], gems: [], goals: { score: 99999 }, par: [5, 9], id: 'x' };
    const j = GameSession.create({ mode, seed: 1, level, bestScore: 4000 });
    j.score = 3999;
    assert.equal(j.isNearRecord(), false, mode);
  }
});

test('session passes nearRecord to the generator only while it applies', () => {
  const s = GameSession.create({ mode: 'classic', seed: 11, bestScore: 3000, gamesPlayed: 10 });
  const seen = [];
  const original = s.generator.nextTray.bind(s.generator);
  s.generator.nextTray = (board, ctx) => { seen.push(ctx.nearRecord); return original(board, ctx); };
  s.score = 2500;
  s.dealTray();
  s.score = 3500;
  s.dealTray();
  s.score = 100;
  s.dealTray();
  assert.deepEqual(seen, [true, false, false]);
});

// --- (c) gentler restart --------------------------------------------------------------------------

function progression() {
  const save = defaultSave();
  return { save, p: new Progression(save, { now: () => new Date(2026, 9, 18, 12) }) };
}

test('shortRunStreak: counts short counted classic runs in a row and resets on a long one', () => {
  const { p, save } = progression();
  assert.equal(save.stats.shortRunStreak, 0);
  const run = (trays, extra = {}) => p.recordGame({ mode: 'classic', score: 300, lines: 2, pieces: 20, trays, ...extra });
  run(A.SHORT_RUN_TRAYS - 1);
  assert.equal(save.stats.shortRunStreak, 1);
  run(3);
  assert.equal(save.stats.shortRunStreak, 2);
  run(A.SHORT_RUN_TRAYS);
  assert.equal(save.stats.shortRunStreak, 0, 'a run of SHORT_RUN_TRAYS trays is long enough');
  run(2);
  run(2);
  assert.equal(save.stats.shortRunStreak, 2);
  // not counted (below RUN_MIN_PIECES) and non-classic runs do not touch the streak
  run(1, { pieces: CONFIG.ADS.RUN_MIN_PIECES - 1 });
  p.recordGame({ mode: 'journey', score: 0, pieces: 30, trays: 1 });
  p.recordGame({ mode: 'daily', score: 0, pieces: 30, trays: 50 });
  assert.equal(save.stats.shortRunStreak, 2);
});

test('assistedStart: the generous early phase of a newbie, but only from SHORT_RUNS_FOR_EASY_START short runs on', () => {
  const gen = new PieceGenerator({ rng: new RNG(1), mode: 'classic' });
  const exp = { trayIndex: GEN.EARLY_TRAYS + 2, experience: 50 };
  assert.equal(gen.phaseFor(exp), 'normal');
  assert.equal(gen.phaseFor({ ...exp, assistedStart: true }), 'early');
  assert.equal(gen.phaseFor({ ...exp, trayIndex: GEN.NEWBIE_EARLY_TRAYS, assistedStart: true }), 'normal');

  const need = A.SHORT_RUNS_FOR_EASY_START;
  for (const [streak, expected] of [[0, false], [need - 1, false], [need, true], [need + 3, true]]) {
    const s = GameSession.create({ mode: 'classic', seed: 2, gamesPlayed: 40, shortRunStreak: streak });
    let flag = null;
    const orig = s.generator.nextTray.bind(s.generator);
    s.generator.nextTray = (b, ctx) => { flag = ctx.assistedStart; return orig(b, ctx); };
    s.dealTray();
    assert.equal(flag, expected, `streak ${streak}`);
  }
  const level = { number: 1, difficulty: 0.3, prefilled: [], gems: [], goals: { score: 500 }, par: [5, 9], id: 'x' };
  assert.equal(GameSession.create({ mode: 'journey', seed: 1, level, shortRunStreak: 9 }).shortRunStreak, 0);
});

// --- (e) resume determinism with the assist on ----------------------------------------------------------------

test('resume with assist and assisted start active continues with identical trays', () => {
  for (const seed of [31, 32, 33]) {
    const make = () => GameSession.create({ mode: 'classic', seed, bestScore: 1500, gamesPlayed: 30, shortRunStreak: 3 });
    const straight = make();
    let resumed = make();
    const choose = new RNG(seed);
    let assistTrays = 0;
    for (let i = 0; i < 400 && straight.status === 'playing'; i++) {
      if (choose.chance(0.25)) resumed = GameSession.fromJSON(JSON.parse(JSON.stringify(resumed.toJSON())));
      assert.equal(resumed.shortRunStreak, 3);
      if (straight.isNearRecord()) assistTrays++;
      const m = botMove(straight);
      const ra = straight.placePiece(m.trayIndex, m.r, m.c);
      const rb = resumed.placePiece(m.trayIndex, m.r, m.c);
      assert.deepEqual(rb, ra, `seed ${seed} move ${i}`);
    }
    assert.deepEqual(resumed.toJSON(), straight.toJSON());
    assert.ok(assistTrays > 0, 'the run passed through the assist zone');
  }
});

test('fromJSON of an older run without shortRunStreak defaults to 0', () => {
  const s = GameSession.create({ mode: 'classic', seed: 5, shortRunStreak: 2 });
  const json = JSON.parse(JSON.stringify(s.toJSON()));
  assert.equal(json.shortRunStreak, 2);
  delete json.shortRunStreak;
  assert.equal(GameSession.fromJSON(json).shortRunStreak, 0);
});

test('the score is never altered by the assist (same moves, same points)', () => {
  const run = (cfg) => {
    const s = GameSession.create({ mode: 'classic', seed: 77, bestScore: 1500, gamesPlayed: 30 });
    s.generator.config = cfg;
    const pts = [];
    for (let i = 0; i < 30 && s.status === 'playing'; i++) {
      const m = botMove(s);
      const before = s.score;
      const r = s.placePiece(m.trayIndex, m.r, m.c);
      assert.equal(s.score - before, r.totalPoints);
      pts.push(r.totalPoints);
    }
    return pts;
  };
  assert.ok(run(ALWAYS).length > 0 && run(NEVER).length > 0);
});

// --- (d) ads spare emotional moments ----------------------------------------------------------------

function adSetup(config = CONFIG.ADS) {
  const save = defaultSave();
  const t = { now: new Date(2026, 9, 18, 12).getTime() };
  const policy = new AdPolicy(save, { config, nowMs: () => t.now });
  save.stats.playSec = config.INTERSTITIAL_MIN_TOTAL_PLAY_SEC;
  save.ads.playSecSinceAd = config.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD;
  save.ads.sessionRuns = 3;
  return { save, policy };
}

test('AdPolicy: no interstitial after a new best, a close call or a celebration; counters stay untouched', () => {
  const { save, policy } = adSetup();
  assert.equal(policy.shouldShowInterstitial(), true);
  assert.equal(policy.shouldShowInterstitial({}), true);
  assert.equal(policy.shouldShowInterstitial({ newBest: false, nearRecord: false, celebration: false }), true);
  const before = JSON.stringify(save);
  for (const ctx of [{ newBest: true }, { nearRecord: true }, { celebration: true }, { newBest: true, nearRecord: true }]) {
    assert.equal(policy.shouldShowInterstitial(ctx), false, JSON.stringify(ctx));
  }
  assert.equal(JSON.stringify(save), before, 'nothing consumed, the ad is only postponed');
  assert.equal(policy.shouldShowInterstitial(), true, 'next ordinary result screen shows it');
});

test('AdPolicy: SKIP_AFTER_HIGH_MOMENTS can be switched off, and other gates still apply', () => {
  const off = adSetup({ ...CONFIG.ADS, SKIP_AFTER_HIGH_MOMENTS: false });
  assert.equal(off.policy.shouldShowInterstitial({ newBest: true, nearRecord: true, celebration: true }), true);
  const gated = adSetup();
  gated.save.ads.playSecSinceAd = 0;
  assert.equal(gated.policy.shouldShowInterstitial({}), false);
  assert.equal(CONFIG.ADS.SKIP_AFTER_HIGH_MOMENTS, true);
});

test('generator resumes exactly from toJSON with nearRecord / assistedStart contexts', () => {
  const board = randomBoard(new RNG(8), 0.35);
  const a = new PieceGenerator({ rng: new RNG(77), mode: 'classic' });
  for (let i = 0; i < 4; i++) a.nextTray(board, { trayIndex: 20 + i, nearRecord: true, assistedStart: i % 2 === 0 });
  const rngState = a.rng.getState();
  const saved = JSON.parse(JSON.stringify(a.toJSON()));
  const ctxs = [20, 21, 22, 23].map((trayIndex) => ({ trayIndex, fill: 0.3, nearRecord: trayIndex % 2 === 0, assistedStart: true }));
  const expected = ctxs.map((ctx) => a.nextTray(board, ctx));
  const rng = new RNG(0);
  rng.setState(rngState);
  const c = PieceGenerator.fromJSON(saved, rng);
  assert.deepEqual(ctxs.map((ctx) => c.nextTray(board, ctx)), expected);
});
