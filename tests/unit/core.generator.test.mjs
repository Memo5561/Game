import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { analyzeTray, PieceGenerator } from '../../game/js/core/generator.js';
import { Board } from '../../game/js/core/board.js';
import { SHAPES, getShape } from '../../game/js/core/shapes.js';
import { RNG } from '../../game/js/core/rng.js';
import { GameSession, listValidMoves } from '../../game/js/core/game.js';
import { playOut } from '../../tools/simulate.mjs';

const GEN = CONFIG.GENERATOR;

function boardFrom(rows) {
  const b = new Board(8);
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) {
      if (row[c] === '.') continue;
      b.cells[r * 8 + c] = 1;
      if (row[c] === 'g') b.gems[r * 8 + c] = 1;
    }
  });
  return b;
}

/** Reference search without any pruning (all orders, all positions, clears between pieces). */
function bruteForce(board, shapes) {
  const out = { solvable: false, maxLines: 0, maxSingle: 0, maxGems: 0 };
  const rec = (b, remaining, lines, gems) => {
    if (remaining.length === 0) { out.solvable = true; return; }
    remaining.forEach((shape, i) => {
      for (const [r, c] of b.placements(shape)) {
        const nb = b.clone();
        nb.place(shape, r, c, 0);
        const { rows, cols } = nb.findFullLines();
        const cnt = rows.length + cols.length;
        const cleared = nb.clearLines(rows, cols).gems;
        const g = gems + cleared[1] + cleared[2] + cleared[3];
        out.maxSingle = Math.max(out.maxSingle, cnt);
        out.maxLines = Math.max(out.maxLines, lines + cnt);
        out.maxGems = Math.max(out.maxGems, g);
        rec(nb, remaining.filter((_, j) => j !== i), lines + cnt, g);
      }
    });
  };
  rec(board, shapes, 0, 0);
  return out;
}

/** Random board without full lines. */
function randomBoard(rng, fill) {
  for (;;) {
    const b = new Board(8);
    for (let i = 0; i < 64; i++) {
      if (rng.chance(fill)) {
        b.cells[i] = 1;
        if (rng.chance(0.15)) b.gems[i] = 1 + rng.int(3);
      }
    }
    const { rows, cols } = b.findFullLines();
    if (rows.length === 0 && cols.length === 0) return b;
  }
}

test('analyzeTray: empty board, big pieces', () => {
  const a = analyzeTray(new Board(), ['O3', 'O3', 'O3'], { nodeLimit: 100000 });
  assert.equal(a.solvable, true);
  assert.equal(a.maxLines, 0, 'three 3x3 squares cannot complete a line');
});

test('analyzeTray applies line clears between placements', () => {
  const b = boardFrom([
    '.#######',
    '#.######',
    '##.#####',
    '###.####',
    '####.###',
    '#####.##',
    '######..',
    '..######',
  ]);
  const i3 = getShape('I3h');
  assert.equal(b.anyPlacement(i3), false, 'I3h does not fit before a clear');
  const a = analyzeTray(b, ['I3h', 'I1'], { nodeLimit: 1e7 });
  assert.equal(a.solvable, true, 'I1 completes a row first, then I3h fits');
  assert.equal(a.complete, true);
  assert.deepEqual(a, { ...bruteForce(b, [i3, getShape('I1')]), complete: true });
  assert.equal(a.maxSingle, 2, 'I1 at (2,2) completes row 2 and column 2');
});

test('analyzeTray detects unsolvable trays', () => {
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? '.' : '#')).join(''));
  const b = boardFrom(rows);
  const a = analyzeTray(b, ['I1', 'I2h'], { nodeLimit: 1e7 });
  assert.deepEqual([a.solvable, a.maxLines, a.complete], [false, 0, true]);
  assert.equal(analyzeTray(b, ['I1', 'I1', 'I1']).solvable, true);
});

test('analyzeTray matches a brute-force search on random boards', () => {
  const rng = new RNG(2024);
  for (let i = 0; i < 60; i++) {
    const board = randomBoard(rng, 0.55 + rng.next() * 0.15);
    const count = 2 + rng.int(2);
    const shapes = Array.from({ length: count }, () => rng.pick(SHAPES));
    const fast = analyzeTray(board, shapes, { nodeLimit: 1e8 });
    assert.equal(fast.complete, true);
    const ref = bruteForce(board, shapes);
    assert.deepEqual(
      { solvable: fast.solvable, maxLines: fast.maxLines, maxSingle: fast.maxSingle, maxGems: fast.maxGems },
      ref,
      `case ${i}: ${shapes.map((s) => s.id).join(',')}`,
    );
  }
});

test('analyzeTray respects the node limit (deterministic, conservative)', () => {
  const a = analyzeTray(new Board(), ['I1', 'I1', 'I2h'], { nodeLimit: 2 });
  assert.deepEqual([a.solvable, a.complete], [false, false], 'a full sequence needs 3 nodes');
  const b = analyzeTray(new Board(), ['I1', 'I1', 'I2h'], { nodeLimit: 3 });
  assert.equal(b.solvable, true);
  assert.throws(() => analyzeTray(new Board(), []));
  assert.throws(() => analyzeTray(new Board(), ['nope']));
});

test('generator is deterministic and resumes exactly from toJSON', () => {
  const board = boardFrom(['##......', '#.......', '........', '........', '....##..', '....##..', '........', '#######.']);
  const a = new PieceGenerator({ rng: new RNG(77), mode: 'classic' });
  const b = new PieceGenerator({ rng: new RNG(77), mode: 'classic' });
  for (let i = 0; i < 5; i++) assert.deepEqual(a.nextTray(board, { trayIndex: i }), b.nextTray(board, { trayIndex: i }));
  const rngState = a.rng.getState();
  const saved = JSON.parse(JSON.stringify(a.toJSON()));
  const expected = [12, 13, 14].map((trayIndex) => a.nextTray(board, { trayIndex, fill: 0.2 }));
  const rng = new RNG(0);
  rng.setState(rngState);
  const c = PieceGenerator.fromJSON(saved, rng);
  assert.deepEqual([12, 13, 14].map((trayIndex) => c.nextTray(board, { trayIndex, fill: 0.2 })), expected);
  assert.throws(() => PieceGenerator.fromJSON({}, rng));
});

test('pieces: frozen, unique uids, never 3 identical colors or shapes', () => {
  const gen = new PieceGenerator({ rng: new RNG(5), mode: 'classic' });
  const board = new Board();
  const uids = new Set();
  for (let i = 0; i < 400; i++) {
    const tray = gen.nextTray(board, { trayIndex: i % 80 });
    assert.equal(tray.length, 3);
    for (const p of tray) {
      assert.ok(Object.isFrozen(p));
      assert.ok(getShape(p.shapeId));
      assert.ok(Number.isInteger(p.color) && p.color >= 0 && p.color < 8);
      assert.ok(!uids.has(p.uid));
      uids.add(p.uid);
    }
    assert.ok(!(tray[0].color === tray[1].color && tray[1].color === tray[2].color), 'three identical colors');
    assert.ok(!(tray[0].shapeId === tray[1].shapeId && tray[1].shapeId === tray[2].shapeId), 'three identical shapes');
  }
});

test('difficulty: classic ramps with the tray index only, levels use their difficulty', () => {
  const gen = new PieceGenerator({ rng: new RNG(1), mode: 'classic' });
  assert.equal(gen.difficultyFor({ trayIndex: 0 }), GEN.D_MIN);
  assert.ok(Math.abs(gen.difficultyFor({ trayIndex: 12 }) - Math.min(GEN.D_MAX, GEN.D_MIN + 12 / GEN.RAMP_TRAYS)) < 1e-12);
  assert.equal(gen.difficultyFor({ trayIndex: 10000 }), GEN.D_MAX);
  assert.equal(gen.difficultyFor({ trayIndex: 12, score: 1e6 }), gen.difficultyFor({ trayIndex: 12, score: 0 }));
  const lvl = new PieceGenerator({ rng: new RNG(1), mode: 'journey' });
  assert.equal(lvl.difficultyFor({ trayIndex: 40, level: { difficulty: 0.37 } }), 0.37);
});

test('the score never influences the dealt tray', () => {
  const board = boardFrom(['###.....', '###.....', '........', '........', '........', '..####..', '........', '.######.']);
  for (const trayIndex of [0, 9, 30, 70]) {
    const a = new PieceGenerator({ rng: new RNG(trayIndex + 3), mode: 'classic' });
    const b = new PieceGenerator({ rng: new RNG(trayIndex + 3), mode: 'classic' });
    assert.deepEqual(a.nextTray(board, { trayIndex, score: 0 }), b.nextTray(board, { trayIndex, score: 987654 }));
  }
});

test('phases: early (longer for new players), mercy, normal', () => {
  const gen = new PieceGenerator({ rng: new RNG(1), mode: 'classic' });
  const vet = { experience: GEN.NEWBIE_GAMES };
  assert.equal(gen.phaseFor({ ...vet, trayIndex: GEN.EARLY_TRAYS - 1 }), 'early');
  assert.equal(gen.phaseFor({ ...vet, trayIndex: GEN.EARLY_TRAYS }), 'normal');
  assert.equal(gen.phaseFor({ experience: 0, trayIndex: GEN.NEWBIE_EARLY_TRAYS - 1 }), 'early');
  assert.equal(gen.phaseFor({ ...vet, trayIndex: 30, fill: GEN.MERCY_FILL + 0.01 }), 'mercy');
  assert.equal(gen.phaseFor({ ...vet, trayIndex: 30, traysSinceClear: GEN.MERCY_TRAYS_NO_CLEAR }), 'mercy');
  assert.equal(gen.phaseFor({ ...vet, trayIndex: 30, mercyTrays: 1 }), 'mercy');
  const journey = new PieceGenerator({ rng: new RNG(1), mode: 'journey' });
  assert.equal(journey.phaseFor({ trayIndex: 0, experience: 0 }), 'normal', 'no early phase in levels');
});

/** Greedy bot: most lines, then biggest piece. */
function greedyMove(session) {
  const moves = listValidMoves(session);
  moves.sort((a, b) => b.lines - a.lines || b.cells - a.cells || a.r - b.r || a.c - b.c);
  return moves[0];
}

test('classic: every tray of the early phase is solvable when dealt (many seeds, sloppy play)', () => {
  for (const experience of [0, 10]) {
    const earlyTrays = experience < GEN.NEWBIE_GAMES ? GEN.NEWBIE_EARLY_TRAYS : GEN.EARLY_TRAYS;
    for (let seed = 1; seed <= 80; seed++) {
      const s = GameSession.create({ mode: 'classic', seed, gamesPlayed: experience });
      const choice = new RNG(seed * 7919);
      let checkedTray = -1;
      while (s.status === 'playing' && s.trayIndex < earlyTrays) {
        if (s.trayIndex !== checkedTray) {
          checkedTray = s.trayIndex;
          const shapes = s.tray.filter(Boolean).map((p) => p.shapeId);
          assert.ok(analyzeTray(s.board, shapes, { nodeLimit: 1e6 }).solvable, `seed ${seed} tray ${s.trayIndex} unsolvable`);
        }
        // Alternate between greedy and random moves to produce messy boards.
        const moves = listValidMoves(s);
        const m = seed % 2 ? greedyMove(s) : choice.pick(moves);
        s.placePiece(m.trayIndex, m.r, m.c);
      }
    }
  }
});

test('a tray-planning player never loses within the early phase', () => {
  for (let seed = 100; seed < 140; seed++) {
    const s = GameSession.create({ mode: 'classic', seed, gamesPlayed: 10 });
    playOut(s, { bot: 'planner', maxTrays: GEN.EARLY_TRAYS });
    assert.equal(s.status, 'playing', `seed ${seed}`);
  }
});

test('reviveTray: small/medium pieces that fit together; shuffleTray: count pieces', () => {
  const gen = new PieceGenerator({ rng: new RNG(9), mode: 'journey' });
  const crowded = boardFrom([
    '#.##.###', '##.##.#.', '.##.###.', '##.#.##.', '........', '........', '#.##.##.', '.##.##.#',
  ]);
  for (let i = 0; i < 20; i++) {
    const tray = gen.reviveTray(crowded);
    assert.equal(tray.length, 3);
    assert.ok(tray.every((p) => getShape(p.shapeId).tier <= 2), 'small/medium');
    assert.ok(analyzeTray(crowded, tray.map((p) => p.shapeId), { nodeLimit: 1e6 }).solvable);
    for (const count of [1, 2, 3]) {
      const pieces = gen.shuffleTray(crowded, count);
      assert.equal(pieces.length, count);
      assert.ok(analyzeTray(crowded, pieces.map((p) => p.shapeId), { nodeLimit: 1e6 }).solvable);
    }
  }
});

test('a board where nothing regular fits still gets pieces that fit', () => {
  const rows = [];
  for (let r = 0; r < 8; r++) rows.push(Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? '.' : '#')).join(''));
  const board = boardFrom(rows);
  const gen = new PieceGenerator({ rng: new RNG(3), mode: 'classic' });
  for (let i = 0; i < 10; i++) {
    const tray = gen.nextTray(board, { trayIndex: 50, fill: 0.5 });
    assert.ok(tray.some((p) => board.anyPlacement(getShape(p.shapeId))), 'at least one piece fits');
  }
});

test('performance: p99 nextTray <= 3 ms', () => {
  const times = [];
  for (let seed = 1; seed <= 40; seed++) {
    const s = GameSession.create({ mode: 'classic', seed, gamesPlayed: 10 });
    const gen = s.generator;
    const original = gen.nextTray.bind(gen);
    gen.nextTray = (board, ctx) => {
      const t0 = performance.now();
      const tray = original(board, ctx);
      if (seed > 3) times.push(performance.now() - t0); // first runs warm up the JIT
      return tray;
    };
    while (s.status === 'playing' && s.trayIndex < 120) {
      const m = greedyMove(s);
      s.placePiece(m.trayIndex, m.r, m.c);
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  assert.ok(times.length > 500, `enough samples (${times.length})`);
  assert.ok(p99 <= 3, `p99 ${p99.toFixed(3)} ms`);
});
