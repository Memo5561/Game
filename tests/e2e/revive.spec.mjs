// E2E revive (§4.15 offerRevive): free revive in the first games (no ad), rewarded revive via the
// mock (button armed after AD_BUTTON_ARM_MS, markRewardedShown), coin revive (REVIVE_COINS, a
// shake + toast when short), "{n} to your best", countdown expiry = decline (never an ad), once
// per run.
// Run: node tests/e2e/run.mjs revive
import { CONFIG } from '../../game/js/config.js';
import { openGame, makeSave, veteranSave, assert, ev, state, waitModal, waitState, tap, playMoves, recordAds, adLog, assertNoErrors } from './ui.helpers.mjs';

async function toRevive(page) {
  await ev(page, () => window.__blocko.startGame('classic', { seed: 11, best: 5000 }));
  await playMoves(page, 3);
  assert(await ev(page, () => window.__blocko.forceGameOver()), 'forceGameOver');
  await waitModal(page, 'revive');
}

const has = (page, action) => page.$(`.modal:not(.is-closing) [data-action="${action}"]`).then((x) => !!x);

export default async function reviveSpec() {
  // --- free revive while gamesPlayed < 2 -------------------------------------------------------
  let g = await openGame({ save: makeSave({ flags: { tutorialDone: true }, stats: { gamesPlayed: 1 }, coins: 0 }) });
  try {
    const { page } = g;
    await toRevive(page);
    assert(await has(page, 'revive.free'), 'free revive offered');
    assert(!(await has(page, 'revive.watch')) && !(await has(page, 'revive.coins')), 'no ad / coin option with a free revive');
    assert(await has(page, 'revive.skip'), '"No thanks" visible from the first frame');
    const toBest = await ev(page, () => document.querySelector('.revive__best').textContent);
    assert(/to your best/.test(toBest), `"{n} to your best" line (${toBest})`);
    await tap(page, 'revive.free');
    const s = await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing"');
    assert(s.session.reviveUsed, 'revived');
    // a second game over in the same run goes straight to the result
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'gameover');
    assertNoErrors(g, 'free revive');
  } finally {
    await g.close();
  }

  // --- rewarded + coin revive (ads start at boot for returning players) -------------------------
  g = await openGame({ save: veteranSave({ coins: 50 }) });
  try {
    const { page } = g;
    await recordAds(page);
    await toRevive(page);
    assert(await has(page, 'revive.watch'), 'rewarded revive offered (video ready)');
    assert(await has(page, 'revive.coins'), 'coin revive offered');
    // not enough coins → shake + toast, modal stays
    await tap(page, 'revive.coins');
    let s = await state(page);
    assert(s.modals.join() === 'revive' && s.toasts.some((x) => /Not enough coins/.test(x)), 'coin revive refused without coins');
    // the ad button ignores taps until armed
    await page.waitForTimeout(CONFIG.ADS.AD_BUTTON_ARM_MS + 100);
    const armed = await ev(page, () => document.querySelector('[data-action="revive.watch"]').getAttribute('aria-disabled'));
    assert(armed === null, 'ad button armed after AD_BUTTON_ARM_MS');
    await tap(page, 'revive.watch');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing" && st.session.reviveUsed');
    assert((await adLog(page)).join() === 'Rewarded (revive)', 'one rewarded video (placement revive)');
    const ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.lastRewardedAt > 0 && ads.playSecSinceAd === 0, 'markRewardedShown after the rewarded revive');
    const saved = await ev(page, () => window.__blocko.save().run);
    assert(saved && saved.session.reviveUsed && saved.session.status === 'playing', 'revive persisted');

    // coins
    await ev(page, () => window.__blocko.setCoins(500));
    await toRevive(page);
    await tap(page, 'revive.coins');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.reviveUsed');
    assert(s.coins === 500 - CONFIG.ECONOMY.REVIVE_COINS, `coins spent (${s.coins})`);

    // ad button arming on a fresh offer
    await toRevive(page);
    const early = await ev(page, () => document.querySelector('[data-action="revive.watch"]').getAttribute('aria-disabled'));
    assert(early === 'true', 'ad button disarmed right after the auto-open');

    // countdown expiry = decline, never an ad
    const adsBefore = (await adLog(page)).length;
    await page.waitForTimeout(CONFIG.ADS.REVIVE_COUNTDOWN_SEC * 1000 + 600);
    await waitModal(page, 'gameover');
    assert((await adLog(page)).length === adsBefore, 'expiry did not start an ad');
    assertNoErrors(g, 'paid revive');
  } finally {
    await g.close();
  }
}
