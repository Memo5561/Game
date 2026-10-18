import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashString, randomSeed } from '../../game/js/core/rng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng.next());

test('same seed gives the same sequence, different seeds differ', () => {
  assert.deepEqual(take(new RNG(123), 50), take(new RNG(123), 50));
  assert.notDeepEqual(take(new RNG(123), 50), take(new RNG(124), 50));
});

test('next() stays in [0, 1)', () => {
  const rng = new RNG(7);
  for (let i = 0; i < 10000; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1);
  }
});

test('state can be saved and restored mid-sequence', () => {
  const rng = new RNG(99);
  take(rng, 17);
  const state = rng.getState();
  assert.equal(state, state >>> 0, 'state is a uint32');
  const expected = take(rng, 30);
  const other = new RNG(1);
  other.setState(state);
  assert.deepEqual(take(other, 30), expected);
  // survives a JSON round trip
  const restored = new RNG(0);
  restored.setState(JSON.parse(JSON.stringify({ s: state })).s);
  assert.deepEqual(take(restored, 30), expected);
});

test('int, range, chance and pick respect their bounds', () => {
  const rng = new RNG(5);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
    seen.add(v);
    const w = rng.range(-2, 2);
    assert.ok(Number.isInteger(w) && w >= -2 && w <= 2);
  }
  assert.equal(seen.size, 6);
  assert.equal(rng.chance(0), false);
  assert.equal(rng.chance(1), true);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(rng.pick(arr)));
});

test('weighted() follows the weights and never picks zero weights', () => {
  const rng = new RNG(11);
  const items = [{ id: 'a', w: 1 }, { id: 'b', w: 3 }, { id: 'zero', w: 0 }];
  const counts = { a: 0, b: 0, zero: 0 };
  for (let i = 0; i < 20000; i++) counts[rng.weighted(items, (x) => x.w).id]++;
  assert.equal(counts.zero, 0);
  const ratio = counts.b / counts.a;
  assert.ok(ratio > 2.7 && ratio < 3.3, `ratio ${ratio}`);
  // all weights zero → uniform fallback, still returns an item
  assert.ok(items.includes(rng.weighted(items, () => 0)));
});

test('shuffle() permutes in place', () => {
  const rng = new RNG(3);
  const arr = Array.from({ length: 20 }, (_, i) => i);
  const out = rng.shuffle(arr);
  assert.equal(out, arr);
  assert.deepEqual([...arr].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
  assert.notDeepEqual(arr, Array.from({ length: 20 }, (_, i) => i));
});

test('hashString is 32-bit FNV-1a, stable and spreads similar strings', () => {
  assert.equal(hashString(''), 0x811c9dc5);
  assert.equal(hashString('a'), 0xe40c292c);
  assert.equal(hashString('foobar'), 0xbf9cf968);
  assert.equal(hashString('L1'), hashString('L1'));
  const h = new Set(['L1', 'L2', 'L3', 'L10', 'D2026-10-18', 'D2026-10-19'].map(hashString));
  assert.equal(h.size, 6);
  for (const v of h) assert.equal(v, v >>> 0);
});

test('randomSeed returns uint32 values', () => {
  const a = randomSeed();
  const b = randomSeed();
  for (const v of [a, b]) assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
});
