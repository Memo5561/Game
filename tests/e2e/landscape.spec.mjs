// E2E landscape tablet (1280×800, body.landscape): HUD as a left column of clamp(200px, 26vw,
// 320px), canvas to its right, real mouse drags place pieces into the bottom row, home / pause /
// gameover lay out without overflow.
// Run: node tests/e2e/run.mjs landscape
import { openGame, veteranSave, VIEWPORTS, assert, ev, state, idle, waitModal, tap, mouseDrag, layoutProblems, shot, assertNoErrors } from './ui.helpers.mjs';

const EMPTY = ['........', '........', '........', '........', '........', '........', '........', '........'];

export default async function landscapeSpec() {
  const vp = VIEWPORTS.tabletLandscape;
  const g = await openGame({ viewport: vp, save: veteranSave() });
  const { page } = g;
  try {
    let s = await state(page);
    assert(s.landscape && s.screen === 'home', 'body.landscape on the tablet');
    let problems = await layoutProblems(page);
    assert(problems.length === 0, `home layout:\n  ${problems.join('\n  ')}`);

    await ev(page, (b) => window.__blocko.startGame('classic', {
      seed: 3, board: b, tray: [{ shapeId: 'O2', color: 3 }, { shapeId: 'I1', color: 0 }, { shapeId: 'I3h', color: 5 }],
    }), EMPTY);
    const geo = await ev(page, () => {
      const hud = document.querySelector('.screen--game .hud').getBoundingClientRect();
      const cv = document.querySelector('.board-canvas').getBoundingClientRect();
      return { hud: { x: hud.left, w: hud.width, h: hud.height }, cv: { x: cv.left, w: cv.width, h: cv.height } };
    });
    const side = Math.min(320, Math.max(200, vp.width * 0.26));
    assert(Math.abs(geo.hud.w - side) < 2 && geo.hud.x === 0, `HUD column width ${geo.hud.w} ≈ ${side}`);
    assert(Math.abs(geo.hud.h - vp.height) < 2, 'HUD column spans the height');
    assert(Math.abs(geo.cv.x - geo.hud.w) < 2 && Math.abs(geo.cv.w - (vp.width - geo.hud.w)) < 2, 'canvas fills the rest');

    // real drags into the bottom row
    let p = await ev(page, () => window.__blocko.pointerFor(1, 7, 7));
    await mouseDrag(page, p.start, p.end);
    await page.waitForTimeout(100);
    s = await state(page);
    assert(s.session.board[63] === 1, 'I1 dragged into the bottom-right cell');
    p = await ev(page, () => window.__blocko.pointerFor(0, 6, 0));
    await mouseDrag(page, p.start, p.end);
    await page.waitForTimeout(100);
    s = await state(page);
    assert([48, 49, 56, 57].every((i) => s.session.board[i] === 4), 'O2 dragged into rows 6–7');
    await shot(page, 'landscape-game');

    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    problems = await layoutProblems(page);
    assert(problems.length === 0, `pause layout:\n  ${problems.join('\n  ')}`);
    await tap(page, 'pause.resume');
    await idle(page);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    problems = await layoutProblems(page);
    assert(problems.length === 0, `gameover layout:\n  ${problems.join('\n  ')}`);
    await page.waitForTimeout(1500);
    await shot(page, 'landscape-gameover');
    assertNoErrors(g, 'landscape');
  } finally {
    await g.close();
  }
}
