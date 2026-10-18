// Fake native bridge for e2e tests that exercise the real `window.BlockoNative` path of
// js/platform/bridge.js (requests answered asynchronously by events, like GameBridge.kt).
// Not a spec itself (run.mjs only runs *.spec.mjs).
import { chromium } from 'playwright';
import { startServer } from '../../tools/serve.mjs';
import { waitForDebug } from './harness.mjs';

/**
 * window.BlockoNative stand-in (runs inside the page). `cfg.fake` seeds window.__fake, which the
 * test may change at any time: { adsRemoved, rewardOutcome, rewardShown, interstitialOutcome,
 * purchaseStatus, adDelay, productsDelay, restoreOk, nofill }. Every native call is logged to
 * window.__nlog as { t, name, args }.
 */
function installFakeNative(cfg) {
  const log = [];
  window.__nlog = log;
  window.__fake = Object.assign({
    adsRemoved: false, rewardOutcome: true, rewardShown: true, interstitialOutcome: true, purchaseStatus: 'success',
    adDelay: 60, productsDelay: 10, restoreOk: true, nofill: false,
  }, cfg.fake || {});
  const F = window.__fake;
  const send = (evt, ms = 10) => setTimeout(() => window.__blockoNative && window.__blockoNative.dispatch(evt), ms);
  const rec = (name, args) => log.push({
    t: Math.round(performance.now()), name, args: [...args].map((a) => (typeof a === 'string' && a.length > 120 ? `${a.slice(0, 40)}…` : a)),
  });
  let saved = cfg.save ? JSON.stringify(cfg.save) : '';
  let adState = { canRequestAds: false, rewardedReady: false, interstitialReady: false, privacyOptionsRequired: false };
  const pushAdState = () => send({ type: 'adState', ...adState }, 5);
  const products = [{ id: 'remove_ads', title: 'x', price: '4,99 €' }, { id: 'coins_small', title: 'x', price: '1,99 €' }, { id: 'coins_large', title: 'x', price: '4,99 €' }];
  window.__setAdState = (patch) => { adState = { ...adState, ...patch }; pushAdState(); };
  window.BlockoNative = {
    getInfo() {
      rec('getInfo', arguments);
      return JSON.stringify({
        platform: 'android', appVersion: '1.0.0', versionCode: 1, sdkInt: 34, webViewVersion: '130.0', locale: cfg.locale || 'en-US', debug: true,
        adsRemoved: F.adsRemoved, ...adState, notificationPermission: 'prompt', bannerHeightDp: 60,
        insets: { top: 0, right: 0, bottom: 0, left: 0, gestureLeft: 0, gestureRight: 0 },
      });
    },
    ready() { rec('ready', arguments); send({ type: 'entitlements', adsRemoved: F.adsRemoved }); pushAdState(); },
    pageUnloading() { rec('pageUnloading', arguments); },
    loadData() { return saved; },
    saveData(json) { saved = json; },
    initAds() {
      rec('initAds', arguments);
      setTimeout(() => {
        adState = { canRequestAds: true, rewardedReady: !F.nofill, interstitialReady: !F.nofill && !F.adsRemoved, privacyOptionsRequired: false };
        pushAdState();
      }, 30);
    },
    showInterstitial(id) { rec('showInterstitial', arguments); send({ type: 'interstitialResult', requestId: id, shown: F.interstitialOutcome }, F.adDelay); },
    showRewarded(id, placement) {
      rec('showRewarded', arguments);
      send({ type: 'rewardedResult', requestId: id, rewarded: F.rewardOutcome, shown: F.rewardShown }, F.adDelay);
    },
    isRewardedReady() { return adState.rewardedReady; },
    setBannerVisible() { rec('setBannerVisible', arguments); },
    setThemeColors() { rec('setThemeColors', arguments); },
    queryProducts(id) { rec('queryProducts', arguments); send({ type: 'productsResult', requestId: id, products }, F.productsDelay); },
    purchase(id, productId) {
      rec('purchase', arguments);
      const st = F.purchaseStatus;
      if (st === 'success') {
        if (productId === 'remove_ads') send({ type: 'entitlements', adsRemoved: true }, 20);
        else send({ type: 'grant', token: `tok-${productId}-${Date.now()}`, productId }, 20);
      }
      send({ type: 'purchaseResult', requestId: id, productId, status: st }, 40);
    },
    restorePurchases(id) { rec('restorePurchases', arguments); send({ type: 'restoreResult', requestId: id, ok: F.restoreOk, adsRemoved: F.adsRemoved }, 20); },
    ackGrant() { rec('ackGrant', arguments); },
    haptic() {},
    share() {},
    requestReview() { rec('requestReview', arguments); },
    openUrl() { rec('openUrl', arguments); },
    isPrivacyOptionsRequired() { return false; },
    showPrivacyOptions(id) { rec('showPrivacyOptions', arguments); send({ type: 'privacyOptionsResult', requestId: id }); },
    getNotificationPermission() { return 'prompt'; },
    requestNotificationPermission(id) { rec('requestNotificationPermission', arguments); send({ type: 'notificationPermissionResult', requestId: id, granted: true }); },
    openNotificationSettings() {},
    scheduleReminder() {},
    cancelReminder() {},
    exitApp() { rec('exitApp', arguments); },
    log() {},
  };
}

/**
 * Opens the game with the fake native bridge.
 * @param {{ save?: Object|null, fake?: Object, viewport?: Object, query?: string, locale?: string, timeScale?: number }} [o]
 */
export async function openNative({
  save = null, fake = {}, viewport = { width: 360, height: 700, deviceScaleFactor: 2 }, query = 'debug=1', locale = 'en-US', timeScale = 20,
} = {}) {
  const server = await startServer(0);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor || 1, isMobile: true, hasTouch: true, locale,
  });
  await context.addInitScript(installFakeNative, { save, fake, locale });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  await page.goto(`${server.url}index.html?${query}`, { waitUntil: 'load' });
  await waitForDebug(page, 15000);
  await page.waitForFunction(() => window.__blockoBooted === true);
  if (timeScale) await page.evaluate((x) => window.__blocko.setTimeScale(x), timeScale);
  return {
    page,
    errors,
    /** native calls so far (optionally only `name`) */
    nlog: (name) => page.evaluate((n) => window.__nlog.filter((e) => !n || e.name === n), name || ''),
    async close() {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
