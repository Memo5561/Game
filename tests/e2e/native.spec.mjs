// E2E native bridge path (fake window.BlockoNative, see native.helpers.mjs):
// - Platform.isBusy() counts only requests that put native UI over the WebView (ad, purchase flow,
//   dialogs): a pending product query never blocks Back, rewarded videos or the purchase buttons,
//   and App.purchase answers a real "busy" with a toast instead of failing silently.
// - A rewarded video the player closed early (rewarded: false, shown: true) still counts as a
//   full-screen ad for the interstitial spacing; one that was never shown does not.
// - The theme's bottom colour is passed to native (setThemeColors) at boot and on a theme change.
// - remove_ads detected at boot is confirmed with the gift + "Ads removed" toasts.
// - already_owned: a coin pack never claims "delivered" before the grant arrived.
// Run: node tests/e2e/run.mjs native
import { CONFIG } from '../../game/js/config.js';
import { THEMES } from '../../game/js/render/theme.js';
import { assert, ev, state, idle, waitModal, waitState, tap, playMoves, veteranSave, todayKey } from './ui.helpers.mjs';
import { openNative } from './native.helpers.mjs';

const saveFor = (patch = {}) => veteranSave({
  coins: 600,
  stats: { gamesPlayed: 10, classicGames: 10, bestScore: 100000, playSec: 2000 },
  flags: { reviewAsked: true, notifDeclines: 2 },
  daily: { lastClaimDay: todayKey(), day: 1, streak: 1 },
  ...patch,
});

const isBusy = (page) => ev(page, () => window.__blocko.platform.isBusy());
const toasts = (page) => ev(page, () => window.__blocko.state().toasts);

async function gameOverScreen(page) {
  await ev(page, () => window.__blocko.startGame('classic', { seed: 9 }));
  await idle(page);
  await playMoves(page, CONFIG.ADS.RUN_MIN_PIECES + 1);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
  await page.waitForTimeout(CONFIG.ADS.AD_BUTTON_ARM_MS + 300); // the ×2 button is armed
}

export default async function nativeSpec() {
  // --- background queries are not "busy" ------------------------------------------------------------
  let g = await openNative({ save: saveFor(), fake: { productsDelay: 100 } });
  try {
    const { page } = g;
    await ev(page, () => window.__blocko.goto('shop'));
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    await ev(page, () => window.__blocko.goto('home'));
    await ev(page, () => { window.__fake.productsDelay = 8000; });

    await ev(page, () => window.__blocko.goto('shop'));
    assert((await g.nlog('queryProducts')).length === 2, 'the shop re-queries the products');
    assert(!(await isBusy(page)), 'a pending product query is not busy');
    await ev(page, () => window.__blocko.simulate({ type: 'back' }));
    await waitState(page, '(st) => st.screen === "home"');

    await ev(page, () => window.__blocko.goto('shop'));
    // free coins video while the query is still pending
    const coins0 = (await state(page)).coins;
    await tap(page, 'shop.freeCoins');
    await page.waitForFunction((n) => window.__blocko.state().coins === n, coins0 + CONFIG.ECONOMY.FREE_COINS_AD_AMOUNT, { polling: 100 });
    assert((await g.nlog('showRewarded')).length === 1, 'rewarded video shown while products load');
    // the cached price button buys while the query is pending (no silent "busy")
    await tap(page, 'shop.buy.coins_small');
    await page.waitForFunction(() => window.__nlog.some((e) => e.name === 'purchase'));
    assert((await g.nlog('purchase'))[0].args[1] === 'coins_small', 'purchase reached native');
    await page.waitForFunction((n) => window.__blocko.state().coins === n, coins0 + CONFIG.ECONOMY.FREE_COINS_AD_AMOUNT + CONFIG.PRODUCTS.coins_small.coins);

    // a real busy (a video is up): the purchase says so instead of failing silently
    await ev(page, () => { window.__fake.adDelay = 800; });
    const r = await ev(page, () => {
      window.__blocko.app.showRewarded('free_coins');
      return window.__blocko.app.purchase('coins_large');
    });
    assert(r === 'busy' && (await toasts(page)).some((x) => /purchase didn’t go through/.test(x)), `busy purchase toasts (${r})`);
    await page.waitForFunction(() => !window.__blocko.platform.isBusy());
    assert(g.errors.length === 0, `no page errors: ${g.errors.join('\n')}`);
  } finally {
    await g.close();
  }

  // --- aborted rewarded video = a full-screen ad (monet-4) ------------------------------------------------
  g = await openNative({ save: saveFor({ ads: { sessionRuns: 3, playSecSinceAd: 900, lastInterstitialAt: 0, lastRewardedAt: 0 } }), fake: { rewardOutcome: false, rewardShown: true, adDelay: 200 } });
  try {
    const { page } = g;
    await gameOverScreen(page);
    await tap(page, 'gameover.double');
    await page.waitForFunction(() => window.__blocko.save().ads.lastRewardedAt > 0);
    const ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.playSecSinceAd === 0, 'the aborted video restarted the interstitial clock');
    assert((await toasts(page)).some((x) => /No reward/.test(x)), 'no reward toast');
    await page.waitForTimeout(CONFIG.ADS.RESULT_SCREEN_MIN_MS);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session && st.session.score === 0');
    assert((await g.nlog('showInterstitial')).length === 0, 'no interstitial right after an aborted rewarded video');
  } finally {
    await g.close();
  }

  // a video that was never shown (no fill) does not count
  g = await openNative({ save: saveFor({ ads: { sessionRuns: 3, playSecSinceAd: 900, lastInterstitialAt: 0, lastRewardedAt: 0 } }), fake: { rewardOutcome: false, rewardShown: false, adDelay: 100 } });
  try {
    const { page } = g;
    await gameOverScreen(page);
    await tap(page, 'gameover.double');
    await page.waitForFunction(() => document.querySelector('[data-modal="gameover"] [data-action="gameover.double"]:not([disabled])'));
    assert((await ev(page, () => window.__blocko.save().ads.lastRewardedAt)) === 0, 'a video that was not shown does not count as an ad');
  } finally {
    await g.close();
  }

  // --- theme colour for the native strip (visual-11) -------------------------------------------------------
  g = await openNative({ save: saveFor() });
  try {
    const { page } = g;
    const colors = async () => (await g.nlog('setThemeColors')).map((e) => e.args[0]);
    assert((await colors()).pop() === THEMES.jewel.bg[1], `boot passes the jewel background (${await colors()})`);
    await ev(page, () => window.__blocko.setTheme('candy'));
    assert((await colors()).pop() === THEMES.candy.bg[1], 'candy passes its light background');
    await ev(page, () => window.__blocko.setTheme('neon'));
    assert((await colors()).pop() === THEMES.neon.bg[1], 'neon passes its dark background');
    assert((await colors()).every((c) => /^#[0-9a-f]{6}$/i.test(c)), 'always #RRGGBB');
  } finally {
    await g.close();
  }

  // --- remove_ads found at boot is confirmed (monet-8) -------------------------------------------------------
  g = await openNative({ save: saveFor(), fake: { adsRemoved: true } });
  try {
    const { page } = g;
    const s = await state(page);
    const gift = CONFIG.ECONOMY.REMOVE_ADS_GIFT;
    assert(s.toasts.some((x) => x.startsWith('Gift:')) && s.toasts.includes('Ads removed – thank you!'), `boot-time purchase confirmed (${s.toasts})`);
    assert(s.coins === 600 + gift.coins && !s.ads.banner, `gift granted once (${s.coins})`);
  } finally {
    await g.close();
  }

  // --- already_owned never claims a delivery that did not happen (monet-9) --------------------------------------
  g = await openNative({ save: saveFor(), fake: { purchaseStatus: 'already_owned' } });
  try {
    const { page } = g;
    await ev(page, () => window.__blocko.goto('shop'));
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    await tap(page, 'shop.buy.coins_small');
    await page.waitForFunction(() => window.__blocko.state().toasts.some((x) => /still being processed/.test(x)));
    let t = await toasts(page);
    assert(t.includes('Checking your earlier purchase…') && !t.includes('Previous purchase delivered'), `coin pack: neutral wording (${t})`);
    assert((await state(page)).coins === 600 && (await g.nlog('restorePurchases')).length === 1, 'nothing delivered, one restore query');
    await ev(page, () => { window.__fake.restoreOk = false; });
    await ev(page, () => window.__blocko.app.purchase('coins_large'));
    t = await toasts(page);
    assert(t.includes('Couldn’t reach Google Play.'), `restore failure is reported (${t})`);
    await tap(page, 'shop.buy.remove_ads');
    await page.waitForFunction(() => window.__blocko.state().toasts.includes('Previous purchase delivered'));
  } finally {
    await g.close();
  }
}
