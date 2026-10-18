// E2E app lifecycle (§4.15 pause/resume): a 'pause' during a run opens the pause modal and a
// 'resume' never closes it; no pause modal while an ad is showing (Platform.isBusy()); Back is
// ignored while busy; the revive countdown stops in the background; a resume after
// SESSION_GAP_MIN starts a new ad session; day rollover re-renders home.
// Run: node tests/e2e/run.mjs lifecycle
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, playMoves, assertNoErrors } from './ui.helpers.mjs';

const simulate = (page, evt) => ev(page, (e) => window.__blocko.simulate(e), evt);

export default async function lifecycleSpec() {
  // normal mock speed: ad overlays stay up for 1.5 s
  const g = await openGame({ save: veteranSave(), query: 'debug=1' });
  const { page } = g;
  try {
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await playMoves(page, 2);

    // pause → pause modal; resume → stays paused
    await simulate(page, { type: 'pause' });
    await waitModal(page, 'pause');
    await simulate(page, { type: 'resume' });
    await page.waitForTimeout(300);
    let s = await state(page);
    assert(s.modals.join() === 'pause', 'resume never auto-unpauses');
    await tap(page, 'pause.resume');
    await idle(page);

    // an ad is showing (Platform.isBusy) → no pause modal, Back ignored
    await ev(page, () => { window.__adDone = window.__blocko.platform.showRewarded('test').then(() => true); });
    await page.waitForSelector('[data-mock-ad]');
    assert(await ev(page, () => window.__blocko.platform.isBusy()), 'busy while the ad shows');
    await simulate(page, { type: 'pause' });
    await page.keyboard.press('Escape');
    s = await state(page);
    assert(s.modals.length === 0, `no pause modal / back while an ad is showing (${s.modals})`);
    await ev(page, () => window.__adDone);
    await simulate(page, { type: 'resume' });
    await page.waitForTimeout(200);
    s = await state(page);
    assert(s.modals.length === 0 && s.session.status === 'playing', 'game continues after the ad');

    // revive countdown pauses in the background
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await simulate(page, { type: 'pause' });
    const n1 = await ev(page, () => document.querySelector('[data-ref="num"]').textContent);
    await page.waitForTimeout(2200);
    const n2 = await ev(page, () => document.querySelector('[data-ref="num"]').textContent);
    assert(n1 === n2, `countdown frozen in the background (${n1} → ${n2})`);
    s = await state(page);
    assert(s.modals.join() === 'revive', 'no pause modal over the revive offer');
    await simulate(page, { type: 'resume' });
    await page.waitForTimeout(1300);
    const n3 = await ev(page, () => document.querySelector('[data-ref="num"]').textContent);
    assert(Number(n3) < Number(n2), `countdown runs again after resume (${n2} → ${n3})`);
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    await tap(page, 'gameover.home');
    await waitState(page, '(st) => st.screen === "home"');

    // resume after SESSION_GAP_MIN → new ad session
    await ev(page, () => window.__blocko.save({ ads: { sessionRuns: 5 } }));
    await simulate(page, { type: 'pause' });
    await ev(page, (ms) => window.__blocko.setNow(Date.now() + ms), (CONFIG.ADS.SESSION_GAP_MIN + 1) * 60000);
    await simulate(page, { type: 'resume' });
    const ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.sessionRuns === 0, 'session restarted after the gap');

    // day rollover re-renders home (daily card shows the new date)
    const day1 = await ev(page, () => document.querySelector('[data-ref="calDay"]').textContent);
    await ev(page, () => window.__blocko.setNow(Date.now() + 86400000));
    const day2 = await ev(page, () => document.querySelector('[data-ref="calDay"]').textContent);
    assert(day1 !== day2, `home re-rendered for the new day (${day1} → ${day2})`);
    assertNoErrors(g, 'lifecycle');
  } finally {
    await g.close();
  }
}
