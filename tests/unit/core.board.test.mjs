import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, OUT_OF_BOUNDS } from '../../game/js/core/board.js';
import { getShape } from '../../game/js/core/shapes.js';

/** Board from 8 strings: '.' empty, digit = color index, letters d/s/h = filled with gem 1/2/3. */
function boardFrom(rows) {
  const b = new Board(8);
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      const gem = 'dsh'.indexOf(ch) + 1;
      b.cells[r * 8 + c] = gem ? 1 : Number(ch) + 1;
      if (gem) b.gems[r * 8 + c] = gem;
    }
  });
  return b;
}

test('get, isEmpty and bounds', () => {
  const b = new Board();
  assert.equal(b.size, 8);
  assert.equal(b.cells.length, 64);
  assert.equal(b.get(0, 0), 0);
  assert.equal(b.get(-1, 0), OUT_OF_BOUNDS);
  assert.equal(b.get(0, 8), OUT_OF_BOUNDS);
  assert.equal(b.isEmpty(8, 8), false);
  assert.ok(b.isEmpty(3, 3));
});

test('canPlace and place', () => {
  const b = new Board();
  const l = getShape('L4a'); // #. / #. / ##
  assert.ok(b.canPlace(l, 5, 6));
  assert.ok(!b.canPlace(l, 6, 6), 'too low');
  assert.ok(!b.canPlace(l, 5, 7), 'too far right');
  assert.ok(!b.canPlace(l, -1, 0));
  const placed = b.place(l, 5, 6, 4);
  assert.deepEqual(placed, [[5, 6], [6, 6], [7, 6], [7, 7]]);
  assert.equal(b.get(7, 7), 5, 'stores color + 1');
  assert.equal(b.filledCount(), 4);
  assert.ok(!b.canPlace(getShape('I1'), 7, 7));
  assert.ok(b.canPlace(getShape('I1'), 5, 7), 'gaps inside the bounding box are free');
});

test('row and column cleared together, intersection reported once, gems collected', () => {
  const b = boardFrom([
    '...0....',
    '...0....',
    '...0....',
    '11.d2222',
    '...0....',
    '...s....',
    '...0....',
    '...0....',
  ]);
  const i1 = getShape('I1');
  assert.deepEqual(b.previewLines(i1, 3, 2), { rows: [3], cols: [] });
  b.place(i1, 3, 2, 6);
  const lines = b.findFullLines();
  assert.deepEqual(lines, { rows: [3], cols: [3] });
  const res = b.clearLines(lines.rows, lines.cols);
  assert.equal(res.cells.length, 15, '8 + 8 - 1 intersection');
  const keys = res.cells.map(({ r, c }) => `${r},${c}`);
  assert.equal(new Set(keys).size, 15);
  assert.deepEqual(res.gems, { 1: 1, 2: 1, 3: 0 });
  const inter = res.cells.find(({ r, c }) => r === 3 && c === 3);
  assert.deepEqual(inter, { r: 3, c: 3, color: 0, gem: 1 });
  assert.equal(res.cells.find(({ r, c }) => r === 3 && c === 2).color, 6);
  assert.ok(b.isBoardEmpty());
  assert.deepEqual(b.gemCount(), { 1: 0, 2: 0, 3: 0 });
});

test('previewLines detects row + column completion without mutating', () => {
  const b = boardFrom([
    '0.......',
    '0.......',
    '0.......',
    '0.......',
    '0.......',
    '........',
    '........',
    '...11111',
  ]);
  const before = Array.from(b.cells);
  const big = getShape('L5a'); // #.. / #.. / ###
  assert.deepEqual(b.previewLines(big, 5, 0), { rows: [7], cols: [0] });
  assert.deepEqual(Array.from(b.cells), before);
  assert.deepEqual(b.previewLines(big, 4, 0), { rows: [], cols: [] }, 'invalid position');
  assert.deepEqual(b.previewLines(getShape('I1'), 0, 5), { rows: [], cols: [] }, 'no line');
});

test('clearCells skips empty, duplicate and out-of-bounds cells', () => {
  const b = boardFrom(['12......', '.h......', '........', '........', '........', '........', '........', '........']);
  const res = b.clearCells([[0, 0], [0, 0], [1, 1], [1, 2], [-1, 0], [9, 9]]);
  assert.deepEqual(res.cells, [{ r: 0, c: 0, color: 1, gem: 0 }, { r: 1, c: 1, color: 0, gem: 3 }]);
  assert.deepEqual(res.gems, { 1: 0, 2: 0, 3: 1 });
  assert.equal(b.filledCount(), 1);
});

test('placements and anyPlacement', () => {
  const b = new Board();
  assert.equal(b.placements(getShape('O3')).length, 36);
  assert.equal(b.placements(getShape('I5h')).length, 32);
  const full = boardFrom(Array(8).fill('00000000'));
  full.cells[0] = 0;
  assert.ok(full.anyPlacement(getShape('I1')));
  assert.deepEqual(full.placements(getShape('I1')), [[0, 0]]);
  assert.ok(!full.anyPlacement(getShape('I2h')));
});

test('toJSON / fromJSON / clone', () => {
  const b = boardFrom(['1.......', '.d......', '........', '........', '........', '........', '........', '......7.']);
  const json = JSON.parse(JSON.stringify(b.toJSON()));
  assert.equal(json.size, 8);
  assert.equal(json.cells.length, 64);
  const c = Board.fromJSON(json);
  assert.deepEqual(Array.from(c.cells), Array.from(b.cells));
  assert.deepEqual(Array.from(c.gems), Array.from(b.gems));
  assert.deepEqual(c.gemCount(), { 1: 1, 2: 0, 3: 0 });
  const k = b.clone();
  k.cells[63] = 3;
  assert.equal(b.cells[63], 0, 'clone is independent');
  assert.throws(() => Board.fromJSON({ size: 8, cells: [1, 2] }));
});
