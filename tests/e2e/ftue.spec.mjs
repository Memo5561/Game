// E2E first-time experience (§4.15 FTUE): fresh install → tutorial directly on the game screen
// (no modal, no banner, no consent, no ads) → 3 steps completed with REAL pointer drags that follow
// session.tutorialHint() (a wrong drop flies back first) → skip only from step 2 → first classic
// run on the same screen → free revive → first game-over screen → ads start only after leaving it.
// Run: node tests/e2e/run.mjs ftue
import { openGame, VIEWPORTS, assert, ev, state, idle, waitModal, waitState, tap, mouseDrag, assertNoErrors } from './ui.helpers.mjs';
import { botPlay } from './harness.mjs';

export default async function ftueSpec() {
  const g = await openGame({ viewport: VIEWPORTS.phone, timeScale: 1 });
  const { page } = g;
  try {
    let s = await state(page);
    assert(s.screen === 'game' && s.tutorial && s.tutorial.step === 0, 'fresh install starts the tutorial on the game screen');
    assert(s.modals.length === 0, 'no modal on first launch');
    assert(!s.ads.started && !s.ads.canRequestAds && !s.ads.banner, 'no ads / consent / banner during the tutorial');
    // a hidden skip takes no room (display: none), so the coach title never wraps because of it
    const skipVisible = () => ev(page, () => { const cs = getComputedStyle(document.querySelector('[data-action="tutorial.skip"]')); return cs.display !== 'none' && cs.visibility === 'visible'; });
    assert(!(await skipVisible()), 'skip is hidden in step 1');

    // a wrong drop flies back and keeps the step
    const wrong = await ev(page, () => {
      const h = window.__blocko.state().tutorial.hint;
      return window.__blocko.pointerFor(h.trayIndex, 0, 0);
    });
    await mouseDrag(page, wrong.start, wrong.end);
    await page.waitForTimeout(300);
    s = await state(page);
    assert(s.tutorial.step === 0 && s.session.score === 0, 'a wrong drop does not place');

    for (let step = 0; step < 3; step++) {
      s = await state(page);
      assert(s.tutorial && s.tutorial.step === step, `tutorial at step ${step + 1}`);
      if (step >= 1) assert(await skipVisible(), `skip visible from step 2 (step ${step + 1})`);
      const text = await ev(page, () => document.querySelector('.coach__text').textContent);
      assert(text.length > 10 && !text.includes('tutorial.'), `coach text for step ${step + 1} (${text})`);
      const p = await ev(page, () => {
        const h = window.__blocko.state().tutorial.hint;
        return window.__blocko.pointerFor(h.trayIndex, h.r, h.c);
      });
      await mouseDrag(page, p.start, p.end);
      if (step < 2) await waitState(page, `(st) => st.tutorial && st.tutorial.step === ${step + 1} && !st.busy`, 8000);
    }
    // 600 ms celebration, then the first classic run on the same screen
    s = await waitState(page, '(st) => st.session && st.session.mode === "classic"', 8000);
    assert(s.screen === 'game' && s.session.status === 'playing' && s.session.score === 0, 'first classic run started seamlessly');
    let sv = await ev(page, () => window.__blocko.save());
    assert(sv.flags.tutorialDone === true, 'tutorialDone flushed');
    assert(sv.stats.gamesPlayed === 0, 'the tutorial is not a recorded game');
    assert(!s.ads.started && !s.ads.canRequestAds, 'still no ads after the tutorial');

    // first run: bot to game over → free revive offered (no ad before the first result screen)
    await ev(page, () => window.__blocko.setTimeScale(20));
    await botPlay(page, { maxMoves: 500 });
    await waitModal(page, 'revive');
    assert(await page.$('[data-modal="revive"] [data-action="revive.free"]'), 'first games: free revive');
    assert(!(await page.$('[data-modal="revive"] [data-action="revive.watch"]')), 'no rewarded ad offered before ads started');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    s = await state(page);
    assert(!s.ads.started && !s.ads.canRequestAds && !s.ads.banner, 'no ads / consent while the first game-over screen is shown');
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.stats.gamesPlayed === 1 && sv.run === null, 'first run finalized');

    // leaving the first result screen starts consent + ads (and the banner slot)
    await tap(page, 'gameover.again');
    s = await waitState(page, '(st) => st.ads.started && st.session && st.session.status === "playing" && st.modals.length === 0');
    assert(s.ads.canRequestAds && s.ads.banner, 'ads + banner start after leaving the first game-over screen');
    assert(s.modals.length === 0, 'no popup after the first game over');
    await idle(page);
    assertNoErrors(g, 'ftue');
  } finally {
    await g.close();
  }
}
