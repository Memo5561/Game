import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { SHAPES, SHAPE_BY_ID, getShape, familyWeight, shapeWeight } from '../../game/js/core/shapes.js';
import { RNG } from '../../game/js/core/rng.js';

const key = (cells) => cells.map(([r, c]) => `${r},${c}`).sort().join(';');
const FAMILIES = ['1x1', 'I2', 'I3', 'L3', 'O2', 'I4', 'T', 'L4', 'SZ', 'R23', 'I5', 'L5', 'O3'];

test('every shape is normalized, frozen and consistent', () => {
  for (const s of SHAPES) {
    assert.ok(s.cells.length > 0, s.id);
    assert.equal(Math.min(...s.cells.map(([r]) => r)), 0, `${s.id} min r`);
    assert.equal(Math.min(...s.cells.map(([, c]) => c)), 0, `${s.id} min c`);
    assert.equal(s.h, Math.max(...s.cells.map(([r]) => r)) + 1, `${s.id} h`);
    assert.equal(s.w, Math.max(...s.cells.map(([, c]) => c)) + 1, `${s.id} w`);
    assert.equal(s.size, s.cells.length, `${s.id} size`);
    assert.equal(new Set(s.cells.map(([r, c]) => `${r},${c}`)).size, s.size, `${s.id} duplicate cells`);
    assert.ok([1, 2, 3, 4].includes(s.tier), `${s.id} tier`);
    assert.ok(FAMILIES.includes(s.family), `${s.id} family`);
    assert.deepEqual(Object.keys(s).sort(), ['cells', 'family', 'h', 'id', 'size', 'tier', 'w']);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.cells) && Object.isFrozen(s.cells[0]));
  }
  assert.ok(Object.isFrozen(SHAPES));
  assert.ok(Object.isFrozen(SHAPE_BY_ID));
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

test('families have the specified orientations', () => {
  const orientations = { '1x1': 1, I2: 2, I3: 2, L3: 4, O2: 1, I4: 2, T: 4, L4: 8, SZ: 4, R23: 2, I5: 2, L5: 4, O3: 1 };
  for (const family of FAMILIES) {
    const members = SHAPES.filter((s) => s.family === family);
    assert.equal(members.length, orientations[family], family);
    assert.equal(new Set(members.map((s) => s.size)).size, 1, `${family} sizes`);
  }
  assert.deepEqual(getShape('O3').cells.length, 9);
  assert.deepEqual([getShape('R2x3').w, getShape('R2x3').h, getShape('R3x2').w, getShape('R3x2').h], [3, 2, 2, 3]);
  for (const id of ['I1', 'I5h', 'I5v', 'L5a', 'L3d', 'J4c', 'T4b', 'S4v', 'Z4h']) assert.ok(SHAPE_BY_ID[id], id);
});

test('lookup helpers', () => {
  for (const s of SHAPES) assert.equal(getShape(s.id), s);
  assert.equal(getShape('nope'), undefined);
});

test('family and shape weights follow CONFIG.GENERATOR.FAMILY_WEIGHTS', () => {
  const W = CONFIG.GENERATOR.FAMILY_WEIGHTS;
  for (const family of FAMILIES) {
    assert.equal(familyWeight(family, 0), W[family][0]);
    assert.equal(familyWeight(family, 1), W[family][1]);
    assert.ok(Math.abs(familyWeight(family, 0.5) - (W[family][0] + W[family][1]) / 2) < 1e-12);
    const members = SHAPES.filter((s) => s.family === family);
    const sum = members.reduce((a, s) => a + shapeWeight(s, 0.3), 0);
    assert.ok(Math.abs(sum - familyWeight(family, 0.3)) < 1e-9, `${family} orientations share the family weight`);
  }
});

test('sampling 100k pieces matches the family shares within 1 % at d = 0 and d = 1', () => {
  for (const d of [0, 1]) {
    const rng = new RNG(4242 + d);
    const counts = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
    const samples = 100000;
    for (let i = 0; i < samples; i++) counts[rng.weighted(SHAPES, (s) => shapeWeight(s, d)).family]++;
    const total = FAMILIES.reduce((a, f) => a + familyWeight(f, d), 0);
    for (const f of FAMILIES) {
      const expected = familyWeight(f, d) / total;
      const actual = counts[f] / samples;
      assert.ok(Math.abs(actual - expected) < 0.01, `d=${d} ${f}: ${actual.toFixed(4)} vs ${expected.toFixed(4)}`);
    }
  }
});
