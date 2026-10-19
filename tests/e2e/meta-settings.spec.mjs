// E2E settings + legal (§4.15 Settings): sound / music / vibration persist; the language picker
// switches between Automatic and all 8 languages (names in their own language) without missing
// keys for en/de; remove ads → shop (highlighted); restore; privacy settings only while
// Platform.isPrivacyOptionsRequired(); privacy policy / rate (Play Store page, never the review
// card) / share (store link) / legal notice; reset progress (confirm) keeps purchases (ads stay
// removed, gift not granted twice) and settings; version line. Legal screen: CONFIG.LEGAL offline,
// mailto, online links, licenses, ads / in-app purchases note.
// Run: node tests/e2e/run.mjs meta-settings
import { CONFIG } from '../../game/js/config.js';
import { LANGS, LANG_NAMES } from '../../game/js/ui/i18n.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { waitForDebug } from './harness.mjs';
import { text, recordPlatform, calls, shotB, tapIn } from './meta.helpers.mjs';

const TITLES = { en: 'Settings', de: 'Einstellungen' };

async function gotoSettings(page) {
  await ev(page, () => window.__blocko.goto('settings'));
  await idle(page);
}

export default async function metaSettingsSpec() {
  let g = await openGame({ save: veteranSave({ coins: 777, stats: { bestScore: 4321 } }) });
  try {
    const { page } = g;
    await tap(page, 'nav.settings');
    await waitState(page, '(st) => st.screen === "settings"');
    await idle(page);
    assert(/Version 1\.0\.0/.test(await text(page, '[data-ref="version"]')) && /Blocko 1\.0\.0 · web 1\.0\.0/.test(await text(page, '[data-ref="debug"]')), 'version + debug line');
    assert(!(await page.$('.screen.is-active [data-action="settings.privacy"]')), 'no privacy settings row unless required');

    // --- toggles ------------------------------------------------------------------------------------
    for (const key of ['sound', 'music', 'haptics']) {
      await tap(page, `settings.toggle.${key}`);
      const v = await ev(page, (k) => window.__blocko.save().settings[k], key);
      const aria = await ev(page, (k) => document.querySelector(`[data-action="settings.toggle.${k}"]`).getAttribute('aria-checked'), key);
      assert(v === false && aria === 'false', `${key} off`);
      await tap(page, `settings.toggle.${key}`);
      assert(await ev(page, (k) => window.__blocko.save().settings[k], key) === true, `${key} on again`);
    }

    // --- language picker ------------------------------------------------------------------------------
    assert(/English/.test(await text(page, '[data-ref="langValue"]')) && /Automatic/.test(await text(page, '[data-ref="langSub"]')), 'auto language shown');
    await tap(page, 'settings.lang');
    await waitModal(page, 'langPicker');
    const names = await ev(page, () => [...document.querySelectorAll('[data-modal="langPicker"] .row__label')].map((e) => e.textContent.trim()));
    assert(names.length === 9 && LANGS.every((c) => names.includes(LANG_NAMES[c])), `Auto + 8 languages (${names})`);
    await shotB(page, 'settings-langPicker');
    for (const code of [...LANGS.filter((c) => c !== 'en'), 'en']) {
      if ((await state(page)).modals.join() !== 'langPicker') {
        await tap(page, 'settings.lang');
        await waitModal(page, 'langPicker');
      }
      await tap(page, `langPicker.pick.${code}`);
      await waitState(page, `(st) => st.lang === "${code}" && st.modals.length === 0`);
      await idle(page);
      assert(await ev(page, () => document.documentElement.lang) === code, `html lang ${code}`);
      assert(await text(page, '[data-ref="langValue"]') === LANG_NAMES[code], `value shows ${LANG_NAMES[code]}`);
      if (TITLES[code]) assert(await text(page, '.screen.is-active .screen-header__title') === TITLES[code], `title in ${code}`);
      assert((await ev(page, () => window.__blocko.save().settings.lang)) === code, `saved ${code}`);
    }
    await tap(page, 'settings.lang');
    await waitModal(page, 'langPicker');
    await tap(page, 'langPicker.pick.auto');
    await waitState(page, '(st) => st.modals.length === 0');
    assert((await ev(page, () => window.__blocko.save().settings.lang)) === 'auto', 'back to automatic');
    const missing = (await ev(page, () => window.__blocko.missingKeys())).filter((k) => k.startsWith('en:') || k.startsWith('de:'));
    assert(missing.length === 0, `no missing en/de keys (${missing})`);

    // --- rows that leave the app ----------------------------------------------------------------------
    await recordPlatform(page, ['openUrl', 'share', 'requestReview', 'showPrivacyOptions'], { openUrl: { value: undefined }, share: { value: undefined } });
    await tapIn(page, 'settings.rate');
    await tapIn(page, 'settings.share');
    await tapIn(page, 'settings.privacyPolicy');
    const urls = (await calls(page, 'openUrl')).map((a) => a[0]);
    assert(urls[0] === CONFIG.PLAY_STORE_MARKET_URL && urls[1] === CONFIG.PRIVACY_POLICY_URL, `rate + privacy policy URLs (${urls})`);
    assert((await calls(page, 'requestReview')).length === 0, 'rate never uses the in-app review card');
    const shared = (await calls(page, 'share'))[0][0];
    assert(shared.includes(CONFIG.PLAY_STORE_URL) && shared.includes('4,321'), `share text (${shared})`);

    // --- restore + remove ads → shop ----------------------------------------------------------------
    await tapIn(page, 'settings.restore');
    await waitState(page, '(st) => st.toasts.includes("No purchases to restore.")');
    await tapIn(page, 'settings.removeAds');
    await waitState(page, '(st) => st.screen === "shop"');
    await page.waitForSelector('.screen.is-active .shop-card--noads.is-highlight');

    // --- legal notice --------------------------------------------------------------------------------
    await gotoSettings(page);
    await tapIn(page, 'settings.legal');
    await waitState(page, '(st) => st.screen === "legal"');
    await idle(page);
    const legal = await text(page, '.screen.is-active .legal');
    const L = CONFIG.LEGAL;
    for (const part of ['§ 5 ECG', L.OWNER_NAME, ...L.ADDRESS_LINES, L.EMAIL, 'Nunito', 'SIL Open Font License 1.1', 'synthesized', 'Contains ads', 'In-app purchases']) {
      assert(legal.includes(part), `legal notice contains "${part}"`);
    }
    await tapIn(page, 'legal.email');
    await tapIn(page, 'legal.online');
    await tapIn(page, 'legal.privacy');
    const legalUrls = (await calls(page, 'openUrl')).map((a) => a[0]).slice(-3);
    assert(legalUrls.join() === [`mailto:${L.EMAIL}`, CONFIG.IMPRINT_URL, CONFIG.PRIVACY_POLICY_URL].join(), `legal links (${legalUrls})`);
    assert(await ev(page, () => getComputedStyle(document.querySelector('.screen.is-active .legal')).userSelect) === 'text', 'legal text selectable');
    await ev(page, () => window.__blocko.setLang('de'));
    await idle(page);
    assert(/Angaben gemäß § 5 ECG/.test(await text(page, '.screen.is-active .legal')) && await text(page, '.screen.is-active .screen-header__title') === 'Impressum', 'German: Impressum');
    await shotB(page, 'legal-de-phone');
    await gotoSettings(page);
    const labels = await ev(page, () => [...document.querySelectorAll('.screen.is-active .row__label')].map((e) => e.textContent.trim()));
    for (const label of ['Fortschritt zurücksetzen', 'Käufe wiederherstellen', 'Impressum', 'Bewerten']) assert(labels.includes(label), `German label "${label}"`);
    await shotB(page, 'settings-de-phone');
    await ev(page, () => window.__blocko.setLang('en'));

    // --- reset progress keeps purchases ------------------------------------------------------------
    await ev(page, () => { const P = window.__blocko.platform; P.openUrl = P.__orig_openUrl; });
    await tapIn(page, 'settings.removeAds');
    await waitState(page, '(st) => st.screen === "shop"');
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.remove_ads"]');
    await tap(page, 'shop.buy.remove_ads');
    await waitState(page, '(st) => !st.ads.banner');
    const before = await ev(page, () => window.__blocko.save());
    assert(before.iap.adsRemoved && before.iap.adsGiftGranted, 'remove_ads owned');
    await ev(page, () => { window.__blocko.setLang('de'); window.__blocko.save({ settings: { music: false } }); });
    await gotoSettings(page);
    await tapIn(page, 'settings.reset');
    await waitModal(page, 'confirm');
    assert(/Käufe bleiben erhalten/.test(await text(page, '[data-modal="confirm"] .modal__text')), 'clear warning (purchases kept)');
    await shotB(page, 'settings-reset-confirm-de');
    await Promise.all([page.waitForEvent('load'), tap(page, 'confirm.ok')]);
    await waitForDebug(page);
    await page.waitForFunction(() => window.__blockoBooted === true);
    const after = await ev(page, () => window.__blocko.save());
    const s = await state(page);
    assert(after.iap.adsRemoved && after.iap.adsGiftGranted && after.iap.grantedTokens.length === before.iap.grantedTokens.length, 'purchases kept');
    assert(after.coins === CONFIG.ECONOMY.STARTING_COINS, `coins reset and gift not granted again (${after.coins})`);
    assert(after.stats.gamesPlayed === 0 && after.xp === 0 && after.stats.bestScore === 0 && after.themes.owned.join() === 'jewel', 'progress reset');
    assert(after.settings.lang === 'de' && after.settings.music === false, 'settings kept');
    assert(after.flags.tutorialDone && s.screen === 'home' && !s.ads.banner, 'home without banner after the reset');
    assertNoErrors(g, 'settings');
  } finally {
    await g.close();
  }

  // --- privacy settings row only when required (?privacy=1 in the mock) --------------------------
  g = await openGame({ save: veteranSave(), query: 'debug=1&mock=fast&privacy=1' });
  try {
    const { page } = g;
    await gotoSettings(page);
    await page.waitForSelector('.screen.is-active [data-action="settings.privacy"]');
    assert(/Privacy settings/.test(await text(page, '[data-action="settings.privacy"]')), 'privacy settings row');
    await tapIn(page, 'settings.privacy');
    for (let i = 0; i < 40 && !g.consoleLog.some((l) => l.includes('[Platform mock] showPrivacyOptions')); i++) await page.waitForTimeout(50);
    assert(g.consoleLog.some((l) => l.includes('[Platform mock] showPrivacyOptions')), 'showPrivacyOptions()');
    await ev(page, () => window.__blocko.setLang('de'));
    assert(/Datenschutz-Einstellungen/.test(await text(page, '[data-action="settings.privacy"]')), 'German label');
    assertNoErrors(g, 'privacy');
  } finally {
    await g.close();
  }
}
