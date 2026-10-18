// E2E back table for the meta layer (§4.15; Escape = Platform 'back' in the mock):
// journey / shop / missions / settings / legal (also via settings) → home; dailyReward /
// notifAsk / levelUp / levelStart / langPicker / purchasePending → close (dailyReward: nothing
// claimed; notifAsk: recorded as "Not now"); the theme purchase confirmation → cancel.
// Run: node tests/e2e/run.mjs meta-back
import { openGame, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { unclaimedSave, back, recordPlatform, tapIn } from './meta.helpers.mjs';

export default async function metaBackSpec() {
  const g = await openGame({ save: unclaimedSave({ stats: { gamesPlayed: 6 }, journey: { unlocked: 5 }, coins: 5000 }) });
  const { page } = g;
  try {
    // dailyReward (auto) → close, nothing claimed
    await waitModal(page, 'dailyReward');
    await back(page);
    let s = await state(page);
    assert(s.screen === 'home' && s.modals.length === 0, 'back closes the calendar');
    assert((await ev(page, () => window.__blocko.save().daily.lastClaimDay)) === null, 'nothing claimed');

    // screens → home
    for (const id of ['journey', 'shop', 'missions', 'settings', 'legal']) {
      await ev(page, (x) => window.__blocko.goto(x), id);
      await idle(page);
      await back(page);
      s = await state(page);
      assert(s.screen === 'home' && s.modals.length === 0, `back from ${id} → home (${s.screen})`);
    }
    await tap(page, 'nav.settings');
    await waitState(page, '(st) => st.screen === "settings"');
    await tapIn(page, 'settings.legal');
    await waitState(page, '(st) => st.screen === "legal"');
    await back(page);
    assert((await state(page)).screen === 'home', 'legal (from settings) → home');

    // levelStart → close (stays on the map)
    await tap(page, 'home.journeyCard');
    await waitState(page, '(st) => st.screen === "journey"');
    await idle(page);
    await tap(page, 'journey.node.5');
    await waitModal(page, 'levelStart');
    await back(page);
    s = await state(page);
    assert(s.screen === 'journey' && s.modals.length === 0, 'back closes the level sheet');

    // langPicker → close
    await ev(page, () => window.__blocko.goto('settings'));
    await idle(page);
    await tap(page, 'settings.lang');
    await waitModal(page, 'langPicker');
    await back(page);
    s = await state(page);
    assert(s.screen === 'settings' && s.modals.length === 0 && s.lang === 'en', 'back closes the language picker');

    // theme confirmation → cancel
    await ev(page, () => window.__blocko.goto('shop'));
    await idle(page);
    await tap(page, 'shop.tab.themes');
    await idle(page);
    await tap(page, 'shop.theme.buy.candy');
    await waitModal(page, 'confirm');
    await back(page);
    s = await state(page);
    assert(s.modals.length === 0 && s.coins === 5000 && s.theme === 'jewel', 'back cancels the theme purchase');

    // purchasePending → close
    await recordPlatform(page, ['purchase'], { purchase: { resolve: 'pending' } });
    await tap(page, 'shop.tab.coins');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    await tap(page, 'shop.buy.coins_small');
    await waitModal(page, 'purchasePending');
    await back(page);
    assert((await state(page)).modals.length === 0 && (await state(page)).screen === 'shop', 'back closes the pending sheet');

    // levelUp → close
    await ev(page, () => { window.__blocko.goto('home'); });
    await ev(page, () => window.__blocko.modal('levelUp', { levels: [4], coins: 100, themes: [] }));
    await waitModal(page, 'levelUp');
    await back(page);
    assert((await state(page)).modals.length === 0, 'back closes the level-up');

    // notifAsk → close = "Not now"
    await ev(page, () => window.__blocko.modal('notifAsk', { coins: 75 }));
    await waitModal(page, 'notifAsk');
    await back(page);
    const f = await ev(page, () => window.__blocko.save().flags);
    assert((await state(page)).modals.length === 0 && f.notifDeclines === 1 && !f.notifOptIn, 'back on the soft ask = Not now');
    assertNoErrors(g, 'meta-back');
  } finally {
    await g.close();
  }
}
