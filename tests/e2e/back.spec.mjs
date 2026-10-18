// E2E back table (§4.15; in the browser mock the Escape key emits Platform 'back'):
// tutorial → ignored · game while playing → pause · pause → resume · confirm → cancel ·
// revive → No thanks · gameover/levelResult → home · other screens → home · home → exitApp.
// Run: node tests/e2e/run.mjs back
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, playMoves, assertNoErrors } from './ui.helpers.mjs';

async function back(page) {
  await page.keyboard.press('Escape');
  await idle(page);
}

export default async function backSpec() {
  // tutorial: ignored
  let g = await openGame();
  try {
    await back(g.page);
    const s = await state(g.page);
    assert(s.screen === 'game' && s.tutorial && s.tutorial.step === 0 && s.modals.length === 0, 'back ignored in the tutorial');
    assertNoErrors(g, 'back/tutorial');
  } finally {
    await g.close();
  }

  g = await openGame({ save: veteranSave({ journey: { unlocked: 5 } }) });
  const { page } = g;
  try {
    // other screens → home
    for (const screen of ['settings', 'shop', 'missions', 'journey', 'legal']) {
      await ev(page, (id) => window.__blocko.goto(id), screen);
      await idle(page);
      await back(page);
      const s = await state(page);
      assert(s.screen === 'home', `back from ${screen} → home (${s.screen})`);
    }
    // home → exitApp (mock logs it, the app stays)
    await back(page);
    assert(g.consoleLog.some((l) => l.includes('[Platform mock] exitApp')), 'back on home → Platform.exitApp()');

    // game while playing → pause; pause → resume
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await back(page);
    let s = await state(page);
    assert(s.modals.join() === 'pause', 'back while playing → pause');
    await back(page);
    s = await state(page);
    assert(s.modals.length === 0 && s.screen === 'game', 'back on pause → resume');

    // confirm → cancel (pause stays)
    await back(page);
    await tap(page, 'pause.restart');
    await waitModal(page, 'confirm');
    await back(page);
    s = await state(page);
    assert(s.modals.join() === 'pause', `back on confirm → cancel (${s.modals})`);
    await back(page);

    // revive → No thanks → gameover → home
    await playMoves(page, 2);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await back(page);
    await waitModal(page, 'gameover');
    s = await state(page);
    assert(s.modals.join() === 'gameover', 'back on revive → No thanks → gameover');
    await back(page);
    s = await state(page);
    assert(s.screen === 'home' && s.modals.length === 0, 'back on gameover → home');

    // levelResult → home
    await ev(page, () => window.__blocko.startGame('journey', { level: 2 }));
    await ev(page, () => window.__blocko.modal('levelResult'));
    await waitModal(page, 'levelResult');
    await back(page);
    s = await state(page);
    assert(s.screen === 'home' && s.modals.length === 0, 'back on levelResult → home');
    assertNoErrors(g, 'back');
  } finally {
    await g.close();
  }
}
