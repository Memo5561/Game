import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { placementPoints, clearPoints, praiseFor, PRAISE_LEVELS } from '../../game/js/core/scoring.js';
import { GameSession } from '../../game/js/core/game.js';
import { Board } from '../../game/js/core/board.js';

const { LINE_POINTS, COMBO_KEEP_MOVES, ALL_CLEAR_BONUS } = CONFIG.SCORING;

test('placement points equal the cell count', () => {
  assert.equal(placementPoints(1), 1);
  assert.equal(placementPoints(9), 9);
});

test('clear points follow LINE_POINTS × combo and extrapolate beyond the table', () => {
  assert.equal(clearPoints(0, 3), 0);
  for (let lines = 1; lines < LINE_POINTS.length; lines++) {
    assert.equal(clearPoints(lines, 0), LINE_POINTS[lines], 'combo 0 counts as x1');
    assert.equal(clearPoints(lines, 1), LINE_POINTS[lines]);
    assert.equal(clearPoints(lines, 4), LINE_POINTS[lines] * 4);
  }
  const last = LINE_POINTS.length - 1;
  assert.equal(clearPoints(last + 1, 1), LINE_POINTS[last] + 140);
  assert.equal(clearPoints(last + 3, 2), (LINE_POINTS[last] + 3 * 140) * 2);
});

test('praise: higher of line praise and the combo milestone reached on this placement', () => {
  assert.deepEqual(PRAISE_LEVELS, ['good', 'great', 'excellent', 'amazing', 'unbelievable']);
  assert.equal(praiseFor(0, 2, 2), null, 'no clear');
  assert.equal(praiseFor(1, 0, 1), null, 'plain single line');
  assert.equal(praiseFor(2, 0, 1), 'good');
  assert.equal(praiseFor(3, 0, 1), 'great');
  assert.equal(praiseFor(4, 0, 1), 'excellent');
  assert.equal(praiseFor(5, 0, 1), 'amazing');
  assert.equal(praiseFor(6, 0, 1), 'unbelievable');
  assert.equal(praiseFor(9, 0, 1), 'unbelievable', 'lines capped at 6');
  assert.equal(praiseFor(1, 2, 3), 'good', 'combo milestone 3');
  assert.equal(praiseFor(1, 3, 4), null, 'no milestone at 4');
  assert.equal(praiseFor(1, 4, 5), 'great');
  assert.equal(praiseFor(2, 4, 5), 'great', 'milestone beats line praise');
  assert.equal(praiseFor(4, 2, 3), 'excellent', 'line praise beats milestone');
  assert.equal(praiseFor(1, 7, 8), 'excellent');
  assert.equal(praiseFor(1, 11, 12), 'amazing');
  assert.equal(praiseFor(1, 19, 20), 'unbelievable');
  assert.equal(praiseFor(1, 0, 1, true), 'unbelievable', 'all clear');
});

/** Classic session on a custom board; `place` puts the given shape in slot 0 and plays it. */
function sessionWithBoard(rows) {
  const s = GameSession.create({ mode: 'classic', seed: 1 });
  s.board = new Board(8);
  rows.forEach((row, r) => { for (let c = 0; c < 8; c++) if (row[c] !== '.') s.board.cells[r * 8 + c] = 1; });
  let uid = 1000;
  s.place = (shapeId, r, c) => {
    s.tray = [{ uid: uid++, shapeId, color: 2 }, { uid: uid++, shapeId: 'I1', color: 3 }, { uid: uid++, shapeId: 'I1', color: 4 }];
    s.status = 'playing';
    const res = s.placePiece(0, r, c);
    assert.ok(res, `move ${shapeId}@${r},${c} must be valid`);
    return res;
  };
  return s;
}

test('combo rules incl. COMBO_KEEP_MOVES, comboBroken and comboMovesLeft', () => {
  assert.equal(COMBO_KEEP_MOVES, 3, 'test assumes the shipped constant');
  const s = sessionWithBoard([
    '0000000.', '0000000.', '0000000.', '0000000.', '0000000.', '........', '........', '........',
  ]);
  let r = s.place('I1', 0, 7);
  assert.deepEqual([r.linesCount, r.comboBefore, r.combo, r.clearPoints, r.totalPoints, r.comboMovesLeft], [1, 0, 1, 20, 21, 3]);
  r = s.place('I1', 1, 7);
  assert.deepEqual([r.combo, r.clearPoints], [2, 40]);
  r = s.place('I1', 6, 0);
  assert.deepEqual([r.linesCount, r.combo, r.movesSinceClear, r.comboMovesLeft, r.comboBroken], [0, 2, 1, 2, false]);
  r = s.place('I1', 6, 2);
  assert.deepEqual([r.combo, r.movesSinceClear, r.comboMovesLeft], [2, 2, 1], 'combo survives 2 moves without clear');
  r = s.place('I1', 2, 7);
  assert.deepEqual([r.combo, r.clearPoints, r.praise, r.movesSinceClear], [3, 60, 'good', 0], 'milestone 3');
  s.place('I1', 6, 4);
  s.place('I1', 6, 6);
  assert.equal(s.combo, 3);
  r = s.place('I1', 7, 0);
  assert.deepEqual([r.combo, r.comboBroken, r.comboMovesLeft], [0, true, 0], `breaks after ${COMBO_KEEP_MOVES} moves without a clear`);
  r = s.place('I1', 7, 2);
  assert.equal(r.comboBroken, false, 'a combo of 0 cannot break again');
  r = s.place('I1', 3, 7);
  assert.deepEqual([r.combo, r.clearPoints], [1, 20]);
  assert.equal(s.maxCombo, 3);
  assert.equal(s.linesCleared, 4);
});

test('all clear bonus and praise', () => {
  const s = sessionWithBoard(['0000000.', '........', '........', '........', '........', '........', '........', '........']);
  const r = s.place('I1', 0, 7);
  assert.equal(r.allClear, true);
  assert.equal(r.allClearBonus, ALL_CLEAR_BONUS);
  assert.equal(r.totalPoints, 1 + 20 + ALL_CLEAR_BONUS);
  assert.equal(r.praise, 'unbelievable');
  assert.equal(s.allClears, 1);
});

test('a multi-line clear scores the whole clear once', () => {
  const s = sessionWithBoard(['000.0000', '000.0000', '000.0000', '1.......', '........', '........', '........', '........']);
  const r = s.place('I3v', 0, 3);
  assert.deepEqual(r.lines, { rows: [0, 1, 2], cols: [] });
  assert.deepEqual([r.linesCount, r.clearPoints, r.praise, r.allClear], [3, LINE_POINTS[3], 'great', false]);
  assert.equal(r.cleared.length, 24);
});
