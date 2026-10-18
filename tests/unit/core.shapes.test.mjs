import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SHAPE_BY_ID, getShape } from '../../game/js/core/shapes.js';

const key = (cells) => cells.map(([r, c]) => `${r},${c}`).sort().join(';');

test('every shape is normalized and consistent', () => {
  for (const s of SHAPES) {
    assert.ok(s.cells.length > 0, s.id);
    assert.equal(Math.min(...s.cells.map(([r]) => r)), 0, `${s.id} min r`);
    assert.equal(Math.min(...s.cells.map(([, c]) => c)), 0, `${s.id} min c`);
    assert.equal(s.h, Math.max(...s.cells.map(([r]) => r)) + 1, `${s.id} h`);
    assert.equal(s.w, Math.max(...s.cells.map(([, c]) => c)) + 1, `${s.id} w`);
    assert.equal(s.size, s.cells.length, `${s.id} size`);
    assert.equal(new Set(s.cells.map(([r, c]) => `${r},${c}`)).size, s.size, `${s.id} duplicate cells`);
    assert.ok([1, 2, 3, 4].includes(s.tier), `${s.id} tier`);
    assert.ok(s.weight > 0, `${s.id} weight`);
  }
});

test('ids and cell sets are unique', () => {
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, SHAPES.length);
  assert.equal(new Set(SHAPES.map((s) => key(s.cells))).size, SHAPES.length);
});

test('all shapes are orthogonally connected (no diagonal shapes)', () => {
  for (const s of SHAPES) {
    const cells = new Set(s.cells.map(([r, c]) => `${r},${c}`));
    const stack = [s.cells[0]];
    const seen = new Set([`${s.cells[0][0]},${s.cells[0][1]}`]);
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${r + dr},${c + dc}`;
        if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push([r + dr, c + dc]); }
      }
    }
    assert.equal(seen.size, s.size, `${s.id} is not connected`);
  }
});

test('the required shape families are complete', () => {
  const required = [
    'I1', 'I2h', 'I2v', 'I3h', 'I3v', 'I4h', 'I4v', 'I5h', 'I5v', 'O2', 'O3', 'R2x3', 'R3x2',
    'L3a', 'L3b', 'L3c', 'L3d',
    'L4a', 'L4b', 'L4c', 'L4d', 'J4a', 'J4b', 'J4c', 'J4d',
    'L5a', 'L5b', 'L5c', 'L5d', 'T4a', 'T4b', 'T4c', 'T4d', 'S4h', 'S4v', 'Z4h', 'Z4v',
  ];
  for (const id of required) assert.ok(SHAPE_BY_ID[id], `missing ${id}`);
  // the 8 L/J tetromino orientations are all different
  const lj = ['L4a', 'L4b', 'L4c', 'L4d', 'J4a', 'J4b', 'J4c', 'J4d'].map((id) => key(getShape(id).cells));
  assert.equal(new Set(lj).size, 8);
  assert.equal(getShape('O3').size, 9);
  assert.equal(getShape('L5a').size, 5);
});

test('lookup helpers and immutability', () => {
  for (const s of SHAPES) assert.equal(getShape(s.id), s);
  assert.equal(getShape('nope'), undefined);
  assert.ok(Object.isFrozen(SHAPES));
  assert.ok(Object.isFrozen(SHAPES[0]));
  assert.ok(Object.isFrozen(SHAPES[0].cells));
  assert.ok(Object.isFrozen(SHAPE_BY_ID));
});
