// E2E smoke: the app boots without console errors at all 5 viewports (first launch → tutorial,
// returning player → home), has no horizontal overflow, and every main screen / run modal
// renders. Screenshots → tools/out/ui/<scene>-<viewport>.png (home, tutorial, game, journey,
// pause, revive, gameover, levelResult, shop, settings).
// Run: node tests/e2e/run.mjs smoke
import { openGame, veteranSave, VIEWPORTS, assert, ev, state, idle, waitModal, tap, shot, layoutProblems, assertNoErrors, playMoves } from './ui.helpers.mjs';
import { launchGame, waitForDebug } from './harness.mjs';

const MID_BOARD = ['........', '.....33.', '0...333.', '00..1...', '002211..', '.62277..', '.6..7744', '55..7.44'];

async function checkLayout(page, where) {
  const problems = await layoutProblems(page);
  assert(problems.length === 0, `${where}: layout problems:\n  ${problems.join('\n  ')}`);
}

/** Boot must survive a hostile environment and fall back gracefully when the module can't run. */
async function robustness() {
  // blocked storage (private mode / disabled DOM storage) → defaults, playable tutorial
  let g = await launchGame({ viewport: VIEWPORTS.phone });
  try {
    await g.context.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('storage denied'); };
      Storage.prototype.setItem = () => { throw new Error('storage denied'); };
    });
    await g.page.reload({ waitUntil: 'load' });
    await waitForDebug(g.page);
    const s = await state(g.page);
    assert(s.screen === 'game' && s.session && s.session.mode === 'tutorial', 'boots into a playable tutorial without storage');
    assertNoErrors(g, 'blocked storage');
  } finally {
    await g.close();
  }
  // corrupt save → copied aside, defaults
  g = await launchGame({ viewport: VIEWPORTS.phone });
  try {
    // injected at document start (the running app flushes its save when the page is hidden)
    await g.context.addInitScript(() => {
      if (sessionStorage.getItem('corrupted')) return;
      sessionStorage.setItem('corrupted', '1');
      localStorage.setItem('blocko.save.v1', '{"oops');
      localStorage.removeItem('blocko.mock.nativeSave');
    });
    await g.page.reload({ waitUntil: 'load' });
    await waitForDebug(g.page);
    const s = await state(g.page);
    assert(s.screen === 'game' && s.session.mode === 'tutorial', 'corrupt save → fresh start');
    assert(await g.page.evaluate(() => localStorage.getItem('blocko.save.corrupt') === '{"oops'), 'corrupt save kept aside');
    assertNoErrors(g, 'corrupt save');
  } finally {
    await g.close();
  }
  // the module cannot load (outdated WebView) → inline multilingual hint after 8 s
  g = await launchGame({ viewport: VIEWPORTS.phone, locale: 'de-DE' });
  try {
    await g.page.route('**/js/main.js', (route) => route.abort());
    await g.page.reload({ waitUntil: 'load' });
    await g.page.waitForSelector('#webview-fallback', { timeout: 10000 });
    const text = await g.page.textContent('#webview-fallback');
    assert(/Android System WebView/.test(text) && /aktualisiere/.test(text), `fallback hint (${text})`);
  } finally {
    await g.close();
  }
}

export default async function smokeSpec() {
  await robustness();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    // first launch: straight into the tutorial on the game screen
    let g = await openGame({ viewport });
    try {
      const s = await state(g.page);
      assert(s.screen === 'game' && s.session && s.session.mode === 'tutorial', `${name}: first launch opens the tutorial (${s.screen}/${s.session && s.session.mode})`);
      assert(s.modals.length === 0, `${name}: no modal during the tutorial`);
      await ev(g.page, () => window.__blocko.setTimeScale(1));
      await g.page.waitForTimeout(1200);
      await shot(g.page, `tutorial-${name}`);
      await checkLayout(g.page, `${name} tutorial`);
      assertNoErrors(g, `${name} first launch`);
    } finally {
      await g.close();
    }

    // returning player: home + every main scene
    g = await openGame({ viewport, save: veteranSave({ journey: { unlocked: 6 } }) });
    const { page } = g;
    try {
      let s = await state(page);
      assert(s.screen === 'home', `${name}: returning player lands on home (${s.screen})`);
      await idle(page);
      await shot(page, `home-${name}`);
      await checkLayout(page, `${name} home`);

      await ev(page, (b) => window.__blocko.startGame('classic', { seed: 7, score: 1320, best: 1500, board: b }), MID_BOARD);
      await shot(page, `game-${name}`);
      await checkLayout(page, `${name} game`);

      await tap(page, 'game.pause');
      await waitModal(page, 'pause');
      await shot(page, `pause-${name}`);
      await checkLayout(page, `${name} pause`);
      await tap(page, 'pause.resume');
      await idle(page);

      await playMoves(page, 2);
      await ev(page, () => window.__blocko.forceGameOver());
      await waitModal(page, 'revive');
      await shot(page, `revive-${name}`);
      await checkLayout(page, `${name} revive`);
      await tap(page, 'revive.skip');
      await waitModal(page, 'gameover');
      await idle(page);
      await page.waitForTimeout(1600);
      await shot(page, `gameover-${name}`);
      await checkLayout(page, `${name} gameover`);
      // "Play again" sits in the middle third on phones (never bottom-anchored next to the banner)
      if (viewport.height >= 640 && viewport.width < 900) {
        const y = await ev(page, () => {
          const r = document.querySelector('[data-modal="gameover"] [data-action="gameover.again"]').getBoundingClientRect();
          return (r.top + r.height / 2) / window.innerHeight;
        });
        assert(y > 0.33 && y < 0.67, `${name}: Play again centre at ${(y * 100).toFixed(0)} % of the height`);
      }

      await tap(page, 'gameover.home');
      await ev(page, () => window.__blocko.startGame('journey', { level: 6 }));
      await shot(page, `journey-${name}`);
      await checkLayout(page, `${name} journey`);
      await ev(page, () => window.__blocko.modal('levelResult'));
      await waitModal(page, 'levelResult');
      await page.waitForTimeout(1800);
      await shot(page, `levelResult-${name}`);
      await checkLayout(page, `${name} levelResult`);

      for (const screen of ['shop', 'settings']) {
        await ev(page, (id) => window.__blocko.goto(id), screen);
        await idle(page);
        await page.waitForTimeout(150);
        await shot(page, `${screen}-${name}`);
        await checkLayout(page, `${name} ${screen}`);
      }
      s = await state(page);
      assert(s.screen === 'settings', `${name}: navigation works`);
      assertNoErrors(g, `${name} returning player`);
    } finally {
      await g.close();
    }
  }
}
