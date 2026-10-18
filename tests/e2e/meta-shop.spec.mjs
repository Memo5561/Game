// E2E shop (§4.15 Shop): tabs; themes (buy with coins after a confirmation → applied to the game
// renderer and the CSS variables, too few coins → "Need n more" + toast, level-locked → "Level n",
// level reached → Use); boosters (buy with coins, free one for a video); remove_ads (pending
// button state, banner hidden, gift once, "Ad-free" in shop and settings); coin packs (grant once);
// free coins video (daily counter); restore; purchase results (pending sheet, cancelled silent,
// already_owned, error); products missing from getProducts() are hidden; coin pill → coins tab.
// Run: node tests/e2e/run.mjs meta-shop
import { CONFIG } from '../../game/js/config.js';
import { getTheme, themeCssVars } from '../../game/js/render/theme.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, recordAds, adLog, assertNoErrors } from './ui.helpers.mjs';
import { text, recordPlatform, shotB } from './meta.helpers.mjs';

const E = CONFIG.ECONOMY;
const sv = (page) => ev(page, () => window.__blocko.save());

async function openShop(page, tab) {
  await ev(page, () => window.__blocko.goto('home'));
  await idle(page);
  await tap(page, 'nav.shop');
  await waitState(page, '(st) => st.screen === "shop"');
  if (tab) await tap(page, `shop.tab.${tab}`);
  await idle(page);
}

export default async function metaShopSpec() {
  // xp 0 → player level 1 (Neon unlocks at level 3)
  const g = await openGame({ save: veteranSave({ coins: 2000, xp: 0 }) });
  const { page } = g;
  try {
    await recordAds(page);
    // --- coin pill → coins tab; tabs --------------------------------------------------------------
    await tap(page, 'home.coins');
    await waitState(page, '(st) => st.screen === "shop"');
    assert(await ev(page, () => document.querySelector('.screen.is-active .shop-body').getAttribute('data-tab')) === 'coins', 'coin pill opens the coins tab');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_large"]');
    assert(/Best value/i.test(await text(page, '.screen.is-active [data-product="coins_large"]')), '"Best value" on the large pack');

    // --- themes --------------------------------------------------------------------------------
    await tap(page, 'shop.tab.themes');
    await idle(page);
    assert((await page.$$('.screen.is-active .theme-card')).length === 6, '6 theme cards');
    const painted = await ev(page, () => [...document.querySelectorAll('.screen.is-active canvas[data-theme]')].every((c) => c.width > 0));
    assert(painted, 'previews rendered');
    assert(/In use/.test(await text(page, '[data-theme-card="jewel"]')), 'Jewel in use');
    assert(/Level 3/.test(await text(page, '[data-theme-card="neon"]')), 'Neon locked to level 3');
    await tap(page, 'shop.theme.locked.neon');
    let s = await state(page);
    assert(s.toasts.some((x) => /level 3/.test(x)) && s.modals.length === 0, 'level lock toast');
    // too few coins for Wood (price > 2,000)
    const short = CONFIG.ECONOMY.THEMES.wood.price - 2000;
    const shortText = short.toLocaleString('en-US');
    assert(short > 0 && new RegExp(`Need ${shortText} more`).test(await text(page, '[data-theme-card="wood"]')), `"Need ${shortText} more"`);
    await tap(page, 'shop.theme.buy.wood');
    s = await state(page);
    assert(s.modals.length === 0 && s.toasts.some((x) => x.includes(`${shortText} more coins`)) && s.coins === 2000, 'short: toast, nothing bought');
    // buy Candy (1,500) → confirm → applied
    await tap(page, 'shop.theme.buy.candy');
    await waitModal(page, 'confirm');
    assert(/Candy for 1,500 coins/.test(await text(page, '[data-modal="confirm"] .modal__text')), 'confirmation names theme + price');
    await shotB(page, 'shop-theme-confirm');
    await tap(page, 'confirm.ok');
    await waitState(page, '(st) => st.modals.length === 0 && st.theme === "candy"');
    let save = await sv(page);
    assert(save.coins === 2000 - E.THEMES.candy.price && save.themes.owned.includes('candy') && save.themes.selected === 'candy', `candy bought (${save.coins})`);
    const css = await ev(page, () => getComputedStyle(document.documentElement).getPropertyValue('--bg-top').trim());
    assert(css.toLowerCase() === themeCssVars(getTheme('candy'))['--bg-top'].toLowerCase(), `CSS vars follow the theme (${css})`);
    assert(await ev(page, () => window.__blocko.app.game.renderer.theme.id) === 'candy', 'renderer theme');
    await shotB(page, 'shop-themes-candy');
    // the game uses it
    await ev(page, () => window.__blocko.startGame('classic', { seed: 5 }));
    assert(await ev(page, () => window.__blocko.app.game.renderer.theme.id) === 'candy', 'game renderer draws candy');
    // level 3 → Neon owned → Use
    await ev(page, () => window.__blocko.save({ xp: 300 }));
    await openShop(page, 'themes');
    await tap(page, 'shop.theme.select.neon');
    s = await waitState(page, '(st) => st.theme === "neon"');
    assert((await sv(page)).themes.selected === 'neon', 'neon selected');
    await tap(page, 'shop.theme.select.jewel');
    await waitState(page, '(st) => st.theme === "jewel"');

    // --- boosters --------------------------------------------------------------------------------
    await tap(page, 'shop.tab.boosters');
    await idle(page);
    save = await sv(page);
    const coins0 = save.coins;
    const b0 = save.boosters;
    await tap(page, 'shop.booster.buy.hammer');
    save = await sv(page);
    assert(save.boosters.hammer === b0.hammer + 1 && save.coins === coins0 - E.BOOSTER_PRICES.hammer, 'hammer bought with coins');
    assert(new RegExp(`×${b0.hammer + 1}`).test(await text(page, '[data-booster="hammer"] [data-ref="count"]')), 'count updated');
    await tap(page, 'shop.booster.watch.shuffle');
    await page.waitForFunction((n) => window.__blocko.save().boosters.shuffle === n, b0.shuffle + 1);
    assert((await adLog(page)).join() === 'Rewarded (booster)', 'free booster via a rewarded video');
    await ev(page, () => window.__blocko.save({ coins: 10 }));
    await openShop(page, 'boosters');
    await tap(page, 'shop.booster.buy.shuffle');
    s = await state(page);
    assert(s.toasts.some((x) => /Not enough coins/.test(x)) && s.coins === 10, 'booster: not enough coins');

    // --- free coins video --------------------------------------------------------------------------
    await openShop(page, 'coins');
    const perDay = CONFIG.ADS.FREE_COINS_ADS_PER_DAY;
    assert(new RegExp(`${perDay} videos left today`).test(await text(page, '.shop-card--free')), `free coins counter (${perDay} a day)`);
    await tap(page, 'shop.freeCoins');
    await page.waitForFunction((n) => window.__blocko.save().coins === n, 10 + E.FREE_COINS_AD_AMOUNT);
    await page.waitForFunction((n) => new RegExp(`${n} videos left today`).test(document.querySelector('.screen.is-active .shop-card--free')?.textContent || ''), perDay - 1);
    assert((await adLog(page)).slice(-1)[0] === 'Rewarded (free_coins)', 'placement free_coins');

    // --- purchase results (stubbed Platform.purchase) --------------------------------------------
    await recordPlatform(page, ['purchase'], { purchase: { resolve: 'pending' } });
    await tap(page, 'shop.buy.coins_small');
    await waitModal(page, 'purchasePending');
    assert(/processing your payment/.test(await text(page, '[data-modal="purchasePending"] .modal__text')), 'pending → info sheet');
    await shotB(page, 'shop-pending');
    await tap(page, 'purchasePending.ok');
    await waitState(page, '(st) => st.modals.length === 0');
    const toastsBefore = (await state(page)).toasts.length;
    await recordPlatform(page, ['purchase'], { purchase: { resolve: 'cancelled' } });
    await tap(page, 'shop.buy.coins_small');
    await idle(page);
    s = await state(page);
    assert(s.toasts.length === toastsBefore && s.modals.length === 0, 'cancelled → silent');
    await recordPlatform(page, ['purchase'], { purchase: { resolve: 'already_owned' } });
    await tap(page, 'shop.buy.coins_small');
    // a coin pack is never reported as delivered before its grant arrived
    s = await waitState(page, '(st) => st.toasts.some((x) => /still being processed/.test(x))');
    assert(s.toasts.includes('Checking your earlier purchase…') && !s.toasts.includes('Previous purchase delivered'), `already_owned (coin pack): neutral wording (${s.toasts})`);
    await recordPlatform(page, ['purchase'], { purchase: { resolve: 'error' } });
    await tap(page, 'shop.buy.coins_small');
    s = await waitState(page, '(st) => st.toasts.some((x) => /didn’t go through/.test(x))');
    // pending state of the button while Google Play is open
    await ev(page, () => {
      const P = window.__blocko.platform;
      P.purchase = () => new Promise((resolve) => { window.__finishPurchase = resolve; });
    });
    await tap(page, 'shop.buy.coins_large');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_large"].is-pending .spinner');
    const disabled = await ev(page, () => [...document.querySelectorAll('.screen.is-active [data-action^="shop.buy."]')].every((b) => b.disabled));
    assert(disabled, 'all purchase buttons disabled while one is pending');
    await ev(page, () => window.__finishPurchase('cancelled'));
    await page.waitForFunction(() => !document.querySelector('.screen.is-active .is-pending'));
    await ev(page, () => { const P = window.__blocko.platform; P.purchase = P.__orig_purchase; });

    // --- coin packs (mock grants) -------------------------------------------------------------------
    save = await sv(page);
    await tap(page, 'shop.buy.coins_large');
    await page.waitForFunction((n) => window.__blocko.save().coins === n, save.coins + CONFIG.PRODUCTS.coins_large.coins);
    assert((await sv(page)).iap.grantedTokens.length === save.iap.grantedTokens.length + 1, 'grant token recorded once');

    // --- remove ads: banner hidden, gift once, owned everywhere --------------------------------------
    s = await state(page);
    assert(s.ads.banner, 'banner before');
    save = await sv(page);
    await tap(page, 'shop.buy.remove_ads');
    s = await waitState(page, '(st) => !st.ads.banner');
    const after = await sv(page);
    assert(after.iap.adsRemoved && after.iap.adsGiftGranted && after.coins === save.coins + E.REMOVE_ADS_GIFT.coins, 'remove_ads + gift');
    await page.waitForSelector('.screen.is-active .shop-card--noads.is-owned .shop-tile__owned');
    assert(/Ad-free/.test(await text(page, '.shop-card--noads')), '"Ad-free" in the shop');
    assert(!(await page.$('.screen.is-active [data-action="shop.buy.remove_ads"]')), 'no price once owned');
    await shotB(page, 'shop-coins-owned');
    await ev(page, () => window.__blocko.simulate({ type: 'entitlements', adsRemoved: true }));
    await idle(page);
    assert((await sv(page)).coins === after.coins, 'gift only once');
    await ev(page, () => window.__blocko.goto('settings'));
    await idle(page);
    assert(/Ad-free/.test(await text(page, '[data-ref="removeAdsSlot"]')), 'settings shows Ad-free');

    // --- restore -------------------------------------------------------------------------------------
    await openShop(page, 'coins');
    await tap(page, 'shop.restore');
    await waitState(page, '(st) => st.toasts.includes("Purchases restored.")');

    // --- products missing from getProducts() are hidden ----------------------------------------------
    await recordPlatform(page, ['getProducts'], { getProducts: { resolve: [{ id: 'coins_small', title: 'x', price: '0,99 €' }] } });
    await openShop(page, 'coins');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    assert(!(await page.$('.screen.is-active [data-product="coins_large"]')), 'missing product hidden');
    assert(/0,99 €/.test(await text(page, '.screen.is-active [data-product="coins_small"]')), 'price only from getProducts()');
    assertNoErrors(g, 'meta-shop');
  } finally {
    await g.close();
  }
}
