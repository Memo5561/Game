import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { GameSession, listValidMoves, SESSION_VERSION, TUTORIAL_STEP_COUNT } from '../../game/js/core/game.js';
import { Board } from '../../game/js/core/board.js';
import { getShape } from '../../game/js/core/shapes.js';
import { analyzeTray } from '../../game/js/core/generator.js';
import { generateLevel, generateDailyLevel } from '../../game/js/core/levels.js';
import { RNG } from '../../game/js/core/rng.js';

const PLACE_RESULT_KEYS = [
  'trayIndex', 'piece', 'r', 'c', 'placedCells', 'placePoints', 'lines', 'linesCount', 'cleared',
  'gemsCollected', 'combo', 'comboBefore', 'comboBroken', 'movesSinceClear', 'comboMovesLeft',
  'clearPoints', 'allClear', 'allClearBonus', 'praise', 'totalPoints', 'score', 'newBest',
  'trayRefilled', 'tray', 'placeable', 'goals', 'status', 'tutorialStep',
].sort();

let uid = 10000;
const piece = (shapeId, color = 1) => Object.freeze({ uid: uid++, shapeId, color });

/** Rows: '.' empty, digit color index, 'd'/'s'/'h' = filled cell with gem 1/2/3. */
function parseRows(rows) {
  const prefilled = [];
  const gems = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      const gem = 'dsh'.indexOf(ch) + 1;
      prefilled.push({ r, c, color: gem ? 0 : Number(ch) });
      if (gem) gems.push({ r, c, type: gem });
    }
  });
  return { prefilled, gems };
}

function customLevel(rows, { goals, par = [3, 6], kind = 'journey' } = {}) {
  const { prefilled, gems } = parseRows(rows);
  const gemGoals = {};
  for (const g of gems) gemGoals[g.type] = (gemGoals[g.type] || 0) + 1;
  return {
    id: 'L999', kind, number: 999, seed: 1, difficulty: 0.3, tag: 'normal', prefilled, gems,
    goals: goals || { gems: gemGoals }, par, rewardCoins: 40,
  };
}

function setBoard(session, rows) {
  const { prefilled, gems } = parseRows(rows);
  session.board = new Board(8);
  for (const { r, c, color } of prefilled) session.board.cells[r * 8 + c] = color + 1;
  for (const { r, c, type } of gems) session.board.gems[r * 8 + c] = type;
}

/** Deterministic bot: most lines, then biggest piece, then first position. */
function botMove(session) {
  const moves = listValidMoves(session);
  moves.sort((a, b) => b.lines - a.lines || b.cells - a.cells || a.trayIndex - b.trayIndex || a.r - b.r || a.c - b.c);
  return moves[0];
}

test('create: classic run basics', () => {
  const s = GameSession.create({ mode: 'classic', seed: 42, bestScore: 900, gamesPlayed: 7 });
  assert.equal(s.mode, 'classic');
  assert.equal(s.status, 'playing');
  assert.equal(s.tray.length, 3);
  assert.ok(s.tray.every((p) => p && Object.isFrozen(p) && getShape(p.shapeId)));
  assert.deepEqual([s.score, s.combo, s.trayIndex, s.piecesPlaced, s.experience, s.bestScore], [0, 0, 0, 0, 7, 900]);
  assert.ok(s.board.isBoardEmpty());
  assert.deepEqual(s.placeable(), [true, true, true]);
  assert.throws(() => GameSession.create({ mode: 'journey' }), 'journey needs a level');
  assert.throws(() => GameSession.create({ mode: 'arcade' }));
  const t = GameSession.create({ mode: 'classic' });
  assert.ok(Number.isInteger(t.seed) && t.seed >= 0, 'random seed');
});

test('placePiece: validation, result shape, fresh copies and refill', () => {
  const s = GameSession.create({ mode: 'classic', seed: 3 });
  const shape0 = getShape(s.tray[0].shapeId);
  assert.equal(s.placePiece(0, 8, 0), null, 'out of bounds');
  assert.equal(s.placePiece(5, 0, 0), null, 'no such slot');
  assert.equal(s.canPlace(0, 0, 0), true);
  const res = s.placePiece(0, 0, 0);
  assert.deepEqual(Object.keys(res).sort(), PLACE_RESULT_KEYS);
  assert.equal(res.placePoints, shape0.size);
  assert.equal(res.score, shape0.size);
  assert.equal(res.placedCells.length, shape0.size);
  assert.equal(res.tutorialStep, null);
  assert.equal(s.tray[0], null);
  assert.equal(s.placePiece(0, 4, 4), null, 'slot already used');
  assert.equal(s.canPlace(1, 0, 0), false, 'occupied');
  // results are copies
  res.tray[1] = null;
  res.placedCells.push([9, 9]);
  res.goals.foo = 1;
  assert.notEqual(s.tray[1], null);
  assert.equal(s.goals.foo, undefined);
});

test('refill: the third placement deals a new tray', () => {
  const s = GameSession.create({ mode: 'classic', seed: 11 });
  let res;
  for (let i = 0; i < 3; i++) {
    const m = botMove(s);
    res = s.placePiece(m.trayIndex, m.r, m.c);
    assert.equal(res.trayRefilled, i === 2);
  }
  assert.equal(s.trayIndex, 1);
  assert.ok(res.tray.every(Boolean));
  assert.deepEqual(res.tray, s.tray);
  assert.equal(s.piecesPlaced, 3);
});

test('preview and listValidMoves', () => {
  const s = GameSession.create({ mode: 'classic', seed: 8 });
  setBoard(s, ['0000000.', '........', '........', '........', '........', '........', '........', '........']);
  s.tray = [piece('I1'), piece('O2'), null];
  s.updateStatus();
  assert.deepEqual(s.preview(0, 0, 7), { valid: true, rows: [0], cols: [] });
  assert.deepEqual(s.preview(0, 0, 0), { valid: false, rows: [], cols: [] });
  assert.deepEqual(s.preview(2, 3, 3), { valid: false, rows: [], cols: [] });
  const moves = listValidMoves(s);
  assert.equal(moves.length, 57 + 42);
  assert.deepEqual(moves.find((m) => m.trayIndex === 0 && m.r === 0 && m.c === 7), { trayIndex: 0, r: 0, c: 7, lines: 1, cells: 1 });
  assert.ok(moves.every((m) => s.canPlace(m.trayIndex, m.r, m.c)));
});

test('game over is detected after a placement', () => {
  const s = GameSession.create({ mode: 'classic', seed: 1 });
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? '.' : '1')).join(''));
  setBoard(s, rows);
  s.tray = [piece('I1'), piece('O2'), piece('I2h')];
  s.updateStatus();
  assert.equal(s.status, 'playing');
  assert.deepEqual(s.placeable(), [true, false, false]);
  const res = s.placePiece(0, 0, 0);
  assert.equal(res.status, 'over');
  assert.equal(s.canRevive(), true);
  assert.equal(s.placePiece(1, 0, 0), null, 'no moves after game over');
  assert.deepEqual(listValidMoves(s), []);
});

test('revive clears the 2 fullest rows and columns, resets the combo and grants mercy', () => {
  const s = GameSession.create({ mode: 'classic', seed: 2 });
  setBoard(s, [
    '1111111.', '1.1.1.1.', '111111.1', '1.1.1.1.', '.1.1.1.1', '1.1.1.1.', '.1.1.1.1', '1.1.1.1.',
  ]);
  s.tray = [piece('O3'), null, null];
  s.combo = 4;
  s.movesSinceClear = 1;
  s.traysSinceClear = 3;
  s.updateStatus();
  assert.equal(s.status, 'over');
  const before = s.board.filledCount();
  const rr = s.revive();
  assert.deepEqual(Object.keys(rr).sort(), ['cleared', 'gemsCollected', 'goals', 'placeable', 'status', 'tray']);
  for (let c = 0; c < 8; c++) assert.equal(s.board.get(0, c), 0, 'row 0 cleared');
  for (let c = 0; c < 8; c++) assert.equal(s.board.get(2, c), 0, 'row 2 cleared');
  for (let r = 0; r < 8; r++) assert.equal(s.board.get(r, 0), 0, 'column 0 cleared');
  assert.equal(rr.cleared.length, before - s.board.filledCount());
  assert.deepEqual([s.combo, s.movesSinceClear, s.traysSinceClear, s.reviveUsed], [0, 0, 0, true]);
  assert.equal(s.mercyTrays, CONFIG.GENERATOR.MERCY_AFTER_REVIVE);
  assert.equal(rr.status, 'playing');
  assert.ok(rr.tray.every((p) => p && getShape(p.shapeId).tier <= 2));
  assert.ok(analyzeTray(s.board, rr.tray.map((p) => p.shapeId), { nodeLimit: 1e6 }).solvable);
  assert.equal(s.revive(), null, 'only once');
  s.status = 'over';
  assert.equal(s.canRevive(), false);
});

test('mercy trays are consumed by the following refills', () => {
  const s = GameSession.create({ mode: 'classic', seed: 21 });
  s.mercyTrays = 2;
  for (let tray = 0; tray < 2; tray++) {
    for (let i = 0; i < 3; i++) {
      const m = botMove(s);
      s.placePiece(m.trayIndex, m.r, m.c);
    }
  }
  assert.equal(s.mercyTrays, 0);
});

test('newBest: classic only, once, only with a best score > 0', () => {
  const run = (opts) => {
    const s = GameSession.create({ seed: 5, ...opts });
    const flags = [];
    for (let i = 0; i < 30 && s.status === 'playing'; i++) {
      const m = botMove(s);
      flags.push(s.placePiece(m.trayIndex, m.r, m.c).newBest);
    }
    return { s, count: flags.filter(Boolean).length };
  };
  const a = run({ mode: 'classic', bestScore: 20 });
  assert.equal(a.count, 1);
  assert.ok(a.s.score > 20);
  assert.equal(run({ mode: 'classic', bestScore: 0 }).count, 0);
  const level = customLevel(['1.......', '........', '........', '........', '........', '........', '........', '.......d']);
  assert.equal(run({ mode: 'journey', level, bestScore: 5 }).count, 0);
});

test('journey: gems → goals, won before game over, no refill after winning, stars', () => {
  // Checkerboard holes (nothing bigger than 1x1 fits), column 7 complete except (0,7), gem at (3,7).
  const rows = [];
  for (let r = 0; r < 8; r++) {
    rows.push(Array.from({ length: 8 }, (_, c) => {
      if (c === 7) return r === 0 ? '.' : r === 3 ? 'd' : '2';
      return (r + c) % 2 === 0 ? '.' : '1';
    }).join(''));
  }
  const level = customLevel(rows, { par: [1, 2] });
  const s = GameSession.create({ mode: 'journey', level, seed: 4 });
  assert.deepEqual(s.goals, { gems: { 1: { need: 1, have: 0 } } });
  s.tray = [piece('I1'), piece('O3'), piece('O3')];
  s.updateStatus();
  assert.equal(s.status, 'playing');
  const res = s.placePiece(0, 0, 7);
  assert.deepEqual(res.lines, { rows: [], cols: [7] });
  assert.deepEqual(res.gemsCollected, { 1: 1, 2: 0, 3: 0 });
  assert.equal(res.status, 'won', 'won is checked before game over (no O3 fits)');
  assert.equal(res.trayRefilled, false, 'no refill after winning');
  assert.deepEqual(res.placeable, [false, false, false]);
  assert.deepEqual(res.goals, { gems: { 1: { need: 1, have: 1 } } });
  assert.equal(s.stars(), 3);
  s.piecesPlaced = 2;
  assert.equal(s.stars(), 2);
  s.piecesPlaced = 3;
  assert.equal(s.stars(), 1);
  assert.equal(GameSession.create({ mode: 'classic', seed: 1 }).stars(), 0);
});

test('daily: score goal progress and win', () => {
  const level = generateDailyLevel('2026-10-19');
  const s = GameSession.create({ mode: 'daily', level, seed: 6 });
  assert.equal(s.goals.score.need, level.goals.score);
  let res;
  while (s.status === 'playing') {
    const m = botMove(s);
    res = s.placePiece(m.trayIndex, m.r, m.c);
  }
  if (res.status === 'won') {
    assert.ok(s.score >= level.goals.score);
    assert.equal(res.goals.score.have, level.goals.score);
  } else {
    assert.ok(res.goals.score.have < level.goals.score);
  }
});

/** Checkerboard rows (only 1x1 pieces fit) with optional overrides { 'r,c': char }. */
function checkerRows(overrides = {}) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    rows.push(Array.from({ length: 8 }, (_, c) => overrides[`${r},${c}`] || ((r + c) % 2 === 0 ? '.' : '1')).join(''));
  }
  return rows;
}

test('boosters are journey/daily only', () => {
  const classic = GameSession.create({ mode: 'classic', seed: 1 });
  assert.equal(classic.canUseBooster('hammer'), false);
  assert.equal(classic.useHammer(3, 3), null);
  assert.equal(classic.useShuffle(), null);
});

test('hammer: clears the filled cells of the 3x3, counts gems, can win a lost run', () => {
  const level = customLevel(checkerRows({ '1,1': 'h' }));
  const s = GameSession.create({ mode: 'journey', level, seed: 2 });
  s.tray = [piece('O2'), null, piece('I2h')];
  s.updateStatus();
  assert.equal(s.status, 'over');
  assert.equal(s.canUseBooster('hammer'), true);
  assert.equal(s.canUseBooster('rocket'), false);
  let filled = 0;
  for (let r = 0; r <= 2; r++) for (let c = 0; c <= 2; c++) if (s.board.get(r, c)) filled++;
  const combo = s.combo;
  const res = s.useHammer(1, 1);
  assert.deepEqual(Object.keys(res).sort(), ['cleared', 'gemsCollected', 'goals', 'placeable', 'status']);
  assert.equal(res.cleared.length, filled, 'only filled cells are reported');
  assert.equal(res.gemsCollected[3], 1);
  assert.equal(res.status, 'won', 'the last gem was collected by the hammer');
  assert.equal(s.combo, combo, 'combo untouched');
  assert.equal(s.piecesPlaced, 0, 'boosters are no placements');
  assert.equal(s.useHammer(4, 4), null, 'not after winning');
});

test('hammer: rescues a lost run back to playing; null on an empty area', () => {
  const level = customLevel(checkerRows({ '7,6': 'd' }));
  const s = GameSession.create({ mode: 'journey', level, seed: 2 });
  s.tray = [piece('O2'), null, null];
  s.updateStatus();
  assert.equal(s.status, 'over');
  const res = s.useHammer(1, 1);
  assert.equal(res.status, 'playing', 'O2 fits into the cleared area');
  assert.deepEqual(res.placeable, [true, false, false]);
  const empty = GameSession.create({ mode: 'journey', level: customLevel(['1.......', '........', '........', '........', '........', '........', '........', '.......d']), seed: 1 });
  assert.equal(empty.useHammer(4, 4), null);
  assert.equal(empty.useHammer(-1, 4), null);
});

test('shuffle: replaces only the remaining pieces and can rescue a lost run', () => {
  const level = customLevel(checkerRows({ '1,1': 'd', '7,0': 'h' }));
  const s = GameSession.create({ mode: 'journey', level, seed: 3 });
  s.tray = [piece('O3'), null, piece('O3')];
  s.updateStatus();
  assert.equal(s.status, 'over');
  const old = s.tray.slice();
  const res = s.useShuffle();
  assert.deepEqual(Object.keys(res).sort(), ['placeable', 'status', 'tray']);
  assert.equal(res.tray[1], null, 'empty slots stay empty');
  assert.ok(res.tray[0] && res.tray[2] && res.tray[0].uid !== old[0].uid && res.tray[2].uid !== old[2].uid);
  assert.equal(res.status, 'playing', 'shuffle rescued the run');
  assert.deepEqual(res.placeable, s.placeable());
  assert.equal(s.piecesPlaced, 0);
});

test('toJSON/fromJSON resumes every mode exactly', () => {
  const variants = [
    { mode: 'classic', seed: 99, bestScore: 50, gamesPlayed: 1 },
    { mode: 'journey', level: generateLevel(12), seed: 7 },
    { mode: 'daily', level: generateDailyLevel('2026-10-18'), seed: 8 },
  ];
  for (const opts of variants) {
    const a = GameSession.create(opts);
    for (let i = 0; i < 7 && a.status === 'playing'; i++) {
      const m = botMove(a);
      a.placePiece(m.trayIndex, m.r, m.c);
    }
    const json = JSON.parse(JSON.stringify(a.toJSON()));
    assert.equal(json.v, SESSION_VERSION);
    const b = GameSession.fromJSON(json);
    assert.deepEqual(b.toJSON(), a.toJSON(), `${opts.mode} snapshot`);
    for (let i = 0; i < 60 && a.status === 'playing'; i++) {
      const m = botMove(a);
      assert.deepEqual(botMove(b), m);
      const ra = a.placePiece(m.trayIndex, m.r, m.c);
      const rb = b.placePiece(m.trayIndex, m.r, m.c);
      assert.deepEqual(rb, ra, `${opts.mode} move ${i}`);
    }
    assert.deepEqual(b.toJSON(), a.toJSON());
  }
});

test('300 seeded moves with save/resume round-trips at random points give identical trays', () => {
  const choose = new RNG(1234);
  let moves = 0;
  let runs = 0;
  for (let seed = 2027; moves < 300; seed++) {
    runs++;
    const straight = GameSession.create({ mode: 'classic', seed, gamesPlayed: 4 });
    let resumed = GameSession.create({ mode: 'classic', seed, gamesPlayed: 4 });
    while (moves < 300) {
      if (choose.chance(0.2)) resumed = GameSession.fromJSON(JSON.parse(JSON.stringify(resumed.toJSON())));
      if (straight.status === 'over') {
        if (!straight.canRevive()) break; // next run with the next seed
        assert.deepEqual(resumed.revive(), straight.revive());
        continue;
      }
      const m = botMove(straight);
      const ra = straight.placePiece(m.trayIndex, m.r, m.c);
      const rb = resumed.placePiece(m.trayIndex, m.r, m.c);
      assert.deepEqual(rb.tray, ra.tray, `run ${runs}, tray after move ${moves}`);
      assert.deepEqual(rb, ra);
      moves++;
    }
    assert.deepEqual(resumed.toJSON(), straight.toJSON());
  }
  assert.equal(moves, 300);
});

test('fromJSON rejects incompatible data', () => {
  const s = GameSession.create({ mode: 'journey', level: generateLevel(3), seed: 1 });
  const good = s.toJSON();
  assert.doesNotThrow(() => GameSession.fromJSON(good));
  assert.throws(() => GameSession.fromJSON(null));
  assert.throws(() => GameSession.fromJSON({ ...good, v: SESSION_VERSION + 1 }));
  assert.throws(() => GameSession.fromJSON({ ...good, level: null }));
  assert.throws(() => GameSession.fromJSON({ ...good, tray: [null] }));
  assert.throws(() => GameSession.fromJSON({ ...good, tray: [{ uid: 1, shapeId: 'X9', color: 0 }, null, null] }));
  assert.throws(() => GameSession.fromJSON({ ...good, score: 'lots' }));
  assert.throws(() => GameSession.fromJSON({ ...good, generator: {} }));
  assert.throws(() => GameSession.fromJSON({ ...good, board: { size: 8, cells: [] } }));
});

test('tutorial: only the hint is accepted, steps advance via nextTutorialStep, Combo x2 at the end', () => {
  const s = GameSession.create({ mode: 'tutorial', seed: 1 });
  assert.equal(TUTORIAL_STEP_COUNT, 3);
  assert.equal(s.canRevive(), false);
  const expectedLines = [{ rows: [4], cols: [] }, { rows: [], cols: [3] }, { rows: [7], cols: [0] }];
  for (let step = 0; step < TUTORIAL_STEP_COUNT; step++) {
    const hint = s.tutorialHint();
    assert.ok(hint, `hint for step ${step}`);
    const moves = listValidMoves(s);
    assert.deepEqual(moves.map(({ trayIndex, r, c }) => ({ trayIndex, r, c })), [hint], 'only the hinted move is valid');
    assert.equal(s.canPlace(hint.trayIndex, 0, 0), false);
    assert.deepEqual(s.placeable(), s.tray.map((_, i) => i === hint.trayIndex));
    assert.equal(s.nextTutorialStep(), null, 'step not done yet');
    const boardBefore = s.board;
    const res = s.placePiece(hint.trayIndex, hint.r, hint.c);
    assert.deepEqual(res.lines, expectedLines[step]);
    assert.equal(s.board, boardBefore, 'placePiece never swaps the board');
    assert.deepEqual(res.tutorialStep, { done: true, hasNext: step < TUTORIAL_STEP_COUNT - 1 });
    assert.equal(s.tutorialHint(), null);
    if (step < TUTORIAL_STEP_COUNT - 1) {
      assert.equal(res.status, 'playing');
      const next = s.nextTutorialStep();
      assert.ok(next.board instanceof Board && next.board !== s.board);
      assert.deepEqual(Array.from(next.board.cells), Array.from(s.board.cells));
      assert.equal(next.tray.filter(Boolean).length, 1);
    } else {
      assert.equal(res.status, 'won');
      assert.equal(res.combo, 2, 'Combo x2');
      assert.ok(res.praise, 'praise on the final cross clear');
      assert.equal(res.allClear, false);
      assert.equal(s.nextTutorialStep(), null);
    }
  }
  const json = GameSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(json.status, 'won');
  assert.equal(GameSession.create({ mode: 'classic', seed: 1 }).tutorialHint(), null);
});
