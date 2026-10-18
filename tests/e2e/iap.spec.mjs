// E2E purchases (§4.14 grant/entitlements, §4.15): mock purchase of remove_ads → banner hidden +
// one-time gift (also after re-sent entitlements and a reload); coins_small → grant → coins added
// once, a duplicate token and an unknown product change nothing.
// Run: node tests/e2e/run.mjs iap
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { waitForDebug } from './harness.mjs';

export default async function iapSpec() {
  const g = await openGame({ save: veteranSave({ coins: 100 }) });
  const { page } = g;
  try {
    let s = await state(page);
    assert(s.ads.started && s.ads.banner, 'banner visible for a returning player');
    const gift = CONFIG.ECONOMY.REMOVE_ADS_GIFT;
    const before = await ev(page, () => window.__blocko.save());

    // --- remove_ads ----------------------------------------------------------------------------
    await tap(page, 'nav.shop');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.remove_ads"]');
    await tap(page, 'shop.buy.remove_ads');
    s = await waitState(page, '(st) => !st.ads.banner');
    let sv = await ev(page, () => window.__blocko.save());
    assert(sv.iap.adsRemoved && sv.iap.adsGiftGranted, 'adsRemoved + gift flag');
    assert(sv.coins === before.coins + gift.coins, `gift coins (${sv.coins})`);
    assert(sv.boosters.hammer === before.boosters.hammer + gift.hammer && sv.boosters.shuffle === before.boosters.shuffle + gift.shuffle, 'gift boosters');
    assert(s.toasts.some((x) => x.startsWith('Gift:')), 'gift toast');
    await page.waitForSelector('.screen.is-active .shop-tile__owned');

    await ev(page, () => window.__blocko.simulate({ type: 'entitlements', adsRemoved: true }));
    await idle(page);
    assert((await ev(page, () => window.__blocko.save())).coins === sv.coins, 'gift only once (re-sent entitlements)');
    await page.reload({ waitUntil: 'load' });
    await waitForDebug(page);
    await page.waitForFunction(() => window.__blockoBooted === true);
    s = await state(page);
    assert(s.coins === sv.coins && !s.ads.banner, 'gift only once after a reload; banner stays hidden');

    // --- coins_small: grant + duplicate token ---------------------------------------------------
    const coins0 = s.coins;
    await tap(page, 'nav.shop');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    await tap(page, 'shop.buy.coins_small');
    s = await waitState(page, `(st) => st.coins === ${coins0 + CONFIG.PRODUCTS.coins_small.coins}`);
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.iap.grantedTokens.length === 1, 'grant token recorded');
    const token = sv.iap.grantedTokens[0];
    await ev(page, (tk) => window.__blocko.simulate({ type: 'grant', token: tk, productId: 'coins_small' }), token);
    await ev(page, () => window.__blocko.simulate({ type: 'grant', token: 'x-unknown', productId: 'not_a_product' }));
    await idle(page);
    s = await state(page);
    assert(s.coins === coins0 + CONFIG.PRODUCTS.coins_small.coins, `duplicate / unknown grants ignored (${s.coins})`);
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.iap.grantedTokens.length === 1, 'no token for the unknown product');
    assert(s.toasts.filter((x) => x === `+${CONFIG.PRODUCTS.coins_small.coins.toLocaleString('en-US')} coins`).length === 1, 'one "+N coins" toast');
    assertNoErrors(g, 'iap');
  } finally {
    await g.close();
  }
}
