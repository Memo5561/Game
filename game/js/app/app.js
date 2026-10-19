// App shell (docs/ARCHITECTURE.md §4.15): boot, screens, modals, toasts, platform events,
// settings / theme / language, ads & purchases plumbing. Run sequencing lives in
// gamecontroller.js; screens and modals in js/ui/screens and js/ui/modals.
//
// ── Extending the app (part B) ─────────────────────────────────────────────────────────────
// Screen:  create js/ui/screens/<id>.js exporting a definition (see js/ui/router.js) and list it
//          in js/ui/screens/index.js. Navigate with app.go(id, params). Build markup with the
//          components in js/ui/components.js; register button handlers with
//          app.action('<id>.<name>', (el, rest) => …) inside build() – `<id>.<prefix>.*` handlers
//          receive the remaining action path (e.g. 'shop.buy.*' gets 'remove_ads').
// Modal:   create js/ui/modals/<id>.js (see js/ui/modals.js for the definition), list it in
//          js/ui/modals/index.js, open with app.modals.open(id, props). Buttons inside use
//          data-action="<id>.<name>" and are routed to the definition's `actions` while on top.
// Popup:   app.popups.register(kind, { priority, check(app) → props|null, modal }) – drained on
//          arrival at home (js/app/popups.js). The meta layer's kinds (dailyReward, levelUp) and
//          the reminder soft ask live in js/app/retention.js (app.retention).
// Strings: add keys to js/ui/strings/en.js and de.js; use t(key, params) or data-i18n="key".
// Icons:   js/ui/icons.js (icon(name)); colors follow the theme CSS variables.
// Events:  app.on('coins' | 'adState' | 'settings' | 'lang' | 'theme' | 'day' | 'entitlements', fn).
// ────────────────────────────────────────────────────────────────────────────────────────────

import { CONFIG } from '../config.js';
import { Platform } from '../platform/bridge.js';
import { Sfx } from '../audio/sfx.js';
import { setStorageBackend, loadSave, defaultSave, requestSave, flushSave, clearSave } from '../meta/storage.js';
import { Progression } from '../meta/progression.js';
import { AdPolicy } from '../meta/adpolicy.js';
import { getTheme, themeCssVars } from '../render/theme.js';
import { clock } from './clock.js';
import { PopupQueue } from './popups.js';
import { installRetention } from './retention.js';
import { GameController } from './gamecontroller.js';
import { installDebug, debugAllowed } from './debug.js';
import { Router } from '../ui/router.js';
import { ModalStack } from '../ui/modals.js';
import { Toasts } from '../ui/toast.js';
import { installIcons } from '../ui/icons.js';
import { setAnimScale, countUp, pop } from '../ui/anim.js';
import { flyCoins } from '../ui/components.js';
import { t, setLang, resolveLang, translateDom, formatNumber, setDebug as setI18nDebug } from '../ui/i18n.js';
import { SCREENS } from '../ui/screens/index.js';
import { MODALS } from '../ui/modals/index.js';

const LANDSCAPE_RATIO = 1.2;
/** Touch targets keep this distance to the bottom edge while a banner can be present (AdMob). */
export const BANNER_CLEARANCE_PX = 48;
const DAY_CHECK_MS = 60000;
const TOAST_LOG = 20;

export class App {
  constructor() {
    /** @type {Object} SaveData (the one shared object) */
    this.save = null;
    /** @type {Progression} */
    this.progression = null;
    /** @type {AdPolicy} */
    this.adPolicy = null;
    /** @type {Router} */
    this.router = null;
    /** @type {ModalStack} */
    this.modals = null;
    /** @type {Toasts} */
    this.toasts = null;
    /** @type {PopupQueue} */
    this.popups = null;
    /** @type {GameController} */
    this.game = null;
    this.clock = clock;
    /** this session started with the tutorial (no auto popups) */
    this.firstLaunch = false;
    /** Platform.initAds() was called (after the first result screen / at boot later on) */
    this.adsStarted = false;
    this.bannerVisible = false;
    this.appPaused = false;
    this.themeId = 'jewel';
    this.timeScale = 1;
    this.debug = false;
    this.notifPermission = 'unsupported';
    /** performance.now() of the last purchase flow (no interstitial after a purchase) */
    this.lastPurchaseAt = 0;
    /** @type {string[]} recent toast texts (debug / tests) */
    this.toastLog = [];
    this._pausedAtMs = 0;
    /** resetProgress() is reloading the page – never flush the old state again */
    this._resetting = false;
    this._dayKey = '';
    this._dayTimer = 0;
    /** confirmations that arrived before the shell existed (entitlements at boot), shown once it does */
    this._bootNotices = [];
    /** mission completions of a running game, shown as toasts once the player leaves the game screen */
    this._missionQueue = [];
    /** free booster videos watched today when the meta layer has no persisted counter (fallback) */
    this._freeBoosterFallback = { day: '', count: 0 };
    /** @type {Map<string, Function>} */
    this._actions = new Map();
    /** @type {Map<string, Set<Function>>} */
    this._events = new Map();
  }

  // -------------------------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------------------------

  /**
   * Boot order (§4.15): save → Progression/AdPolicy → Platform.on(…) → await Platform.init()
   * (installs the native dispatcher and calls ready(); native queues events until then) → i18n +
   * fonts → first screen → debug API → window.__blockoBooted. Every step is guarded: a failing
   * step is logged and the app still ends up on a playable screen.
   */
  async boot() {
    const step = (name, fn) => {
      try {
        return fn();
      } catch (e) {
        console.error(`[boot] ${name} failed`, e);
        return undefined;
      }
    };
    try {
      step('save', () => this.initSave());
      if (!this.progression || !this.adPolicy) this.initSave(true);
      step('platform events', () => this.wirePlatform());
      try {
        await Platform.init();
      } catch (e) {
        console.error('[boot] Platform.init failed', e);
      }
      step('entitlements', () => this.syncEntitlements());
      step('notification permission', () => { this.notifPermission = Platform.getNotificationPermission(); });
      step('i18n', () => this.initI18n());
      step('shell', () => this.initShell());
      try {
        await Promise.all([this.initGame(), this.loadUiFonts()]);
      } catch (e) {
        console.error('[boot] game init failed', e);
      }
      step('first screen', () => this.showFirstScreen());
      if (!this.router || !this.router.current) step('fallback screen', () => this.fallbackScreen());
      step('debug', () => {
        if (debugAllowed(Platform)) installDebug(this);
      });
    } finally {
      window.__blockoBooted = true;
      const fallback = document.getElementById('webview-fallback');
      if (fallback) fallback.remove();
    }
  }

  /**
   * Save + meta objects (Progression / AdPolicy share the one save object).
   * @param {boolean} [memoryOnly] boot fallback: play on defaults without ever overwriting the
   *   stored save (used only if loading the real save failed)
   */
  initSave(memoryOnly = false) {
    if (memoryOnly) {
      setStorageBackend({ getItem: () => null, setItem: () => {}, removeItem: () => {}, saveData: () => {} });
      this.save = defaultSave();
    } else {
      setStorageBackend({ saveData: (json) => Platform.saveData(json) });
      this.save = loadSave(Platform.loadData());
    }
    this.firstLaunch = !this.save.flags.tutorialDone;
    const onChange = (save) => requestSave(save);
    this.progression = new Progression(this.save, { now: () => clock.now(), onChange });
    this.adPolicy = new AdPolicy(this.save, { nowMs: () => clock.nowMs(), onChange });
    this.adPolicy.onSessionStart();
    this._dayKey = clock.today();
  }

  wirePlatform() {
    Platform.on('pause', (e) => this.onPause(e || {}));
    Platform.on('resume', (e) => this.onResume(e || {}));
    Platform.on('back', () => this.back());
    Platform.on('entitlements', (e) => this.onEntitlements(e || {}));
    Platform.on('grant', (e) => this.onGrant(e || {}));
    Platform.on('adState', (e) => this.emit('adState', e));
    Platform.on('insets', (e) => {
      if (this.game && this.game.renderer) this.game.renderer.setInsets(e);
    });
  }

  /** The native/mock entitlement state known at init is authoritative for save.iap.adsRemoved. */
  syncEntitlements() {
    if (!(Platform.isNative || Platform.isMock)) return;
    if (Platform.adsRemoved !== this.save.iap.adsRemoved) this.onEntitlements({ adsRemoved: Platform.adsRemoved });
  }

  initI18n() {
    this.debug = debugAllowed(Platform);
    setI18nDebug(this.debug);
    setLang(resolveLang(this.save.settings.lang, this.deviceLocale()));
  }

  /** DOM shell: icons, router, modal stack, toasts, global listeners, theme, audio settings. */
  initShell() {
    installIcons();
    this.router = new Router(document.getElementById('app'), this);
    this.modals = new ModalStack(document.getElementById('modals'), this);
    this.toasts = new Toasts(document.getElementById('toasts'));
    this.popups = new PopupQueue(this);
    for (const def of SCREENS) this.router.register(def);
    for (const def of MODALS) this.modals.register(def);
    this.router.onChange((id, prev) => this.onScreenChange(id, prev));
    this.modals.onChange((type) => {
      if (this.game) this.game.onModal(type);
    });
    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true, capture: true });
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    Sfx.init();
    this.applyAudioSettings();
    Sfx.startMusic();
    this.applyTheme(this.progression.selectedTheme);
    this.applyBannerClearance();
    this.registerGlobalActions();
    installRetention(this);
  }

  async initGame() {
    this.game = new GameController(this);
    await this.game.init();
    this.applyBannerClearance();
  }

  /** DOM font weights used by the UI (local files; never blocks longer than 1.5 s). */
  loadUiFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.race([
      Promise.all([document.fonts.load('800 16px Nunito'), document.fonts.load('900 16px Nunito')]).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }

  showFirstScreen() {
    this.game.restoreSavedRun();
    this.game.expireStaleDaily();
    this.flushBootNotices();
    if (!this.save.flags.tutorialDone) {
      this.router.go('game', null, { instant: true });
      this.game.startTutorial();
    } else {
      this.router.go('home', null, { instant: true });
    }
    // later launches: ads start at boot (first launch: after leaving the first result screen)
    if (this.save.flags.tutorialDone && this.save.stats.gamesPlayed >= 1) this.startAds();
  }

  /** Last resort when the regular first screen failed: a classic run on the game screen. */
  fallbackScreen() {
    this.router.go('game', null, { instant: true });
    this.game.startRun('classic');
  }

  // -------------------------------------------------------------------------------------------
  // Navigation, actions, back
  // -------------------------------------------------------------------------------------------

  /** Navigates to a screen. */
  go(id, params) {
    this.router.go(id, params);
  }

  /**
   * Registers a global action handler. `name` may end in '.*' (prefix handler; receives the rest).
   * @param {string} name
   * @param {(el: Element, rest: string) => void} fn
   */
  action(name, fn) {
    this._actions.set(name, fn);
  }

  onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.closest('.is-covered, .is-closing, .is-leaving')) return;
    e.preventDefault();
    if (!el.hasAttribute('data-silent')) Sfx.play('click');
    this.dispatch(el.getAttribute('data-action'), el);
  }

  /**
   * Runs an action: the top modal first, then global handlers (exact, then prefix.*).
   * @returns {boolean} handled
   */
  dispatch(action, el = null) {
    if (this.modals.dispatch(action, el)) return true;
    let fn = this._actions.get(action);
    let rest = '';
    if (!fn) {
      const parts = action.split('.');
      for (let i = parts.length - 1; i > 0 && !fn; i--) {
        fn = this._actions.get(`${parts.slice(0, i).join('.')}.*`);
        if (fn) rest = parts.slice(i).join('.');
      }
    }
    if (!fn) {
      console.warn(`[app] unhandled action ${action}`);
      return false;
    }
    fn(el, rest);
    return true;
  }

  registerGlobalActions() {
    this.action('nav.back', () => this.back());
    this.action('nav.home', () => this.go('home'));
    this.action('nav.*', (el, id) => {
      if (this.router.defs.has(id)) this.go(id);
    });
    this.action('game.pause', () => this.game.openPause());
    this.action('game.booster.*', (el, type) => this.game.boosterTap(type));
    this.action('tutorial.skip', () => this.game.skipTutorial());
  }

  /** Back table (§4.15). */
  back() {
    if (Platform.isBusy() || !this.router) return;
    if (this.modals.isOpen) {
      this.modals.back();
      return;
    }
    const screen = this.router.current;
    if (screen === 'game') {
      this.game.back();
      return;
    }
    if (screen === 'home') {
      Platform.exitApp();
      return;
    }
    this.router.back();
  }

  onScreenChange(id, prev) {
    if (this.game) {
      if (prev === 'game') this.game.onScreen(false);
      if (id === 'game') this.game.onScreen(true);
      // a daily run left over from a previous day ends here, so the Daily card offers today's level
      if (id !== 'game') this.game.expireStaleDaily();
    }
    clearInterval(this._dayTimer);
    if (id === 'home') this._dayTimer = setInterval(() => this.checkDay(), DAY_CHECK_MS);
    if (id !== 'game') this.flushMissionToasts();
  }

  onResize() {
    const landscape = window.innerWidth / Math.max(1, window.innerHeight) >= LANDSCAPE_RATIO;
    document.body.classList.toggle('landscape', landscape);
    if (this.game && this.game.drag) this.game.onResize();
  }

  // -------------------------------------------------------------------------------------------
  // Platform lifecycle
  // -------------------------------------------------------------------------------------------

  onPause(evt) {
    this.appPaused = true;
    this._pausedAtMs = clock.nowMs();
    Sfx.suspend();
    if (this.game && this.game.drag) this.game.onAppPause();
    if (this.modals) this.modals.pauseTimers();
    if (this._resetting) return;
    flushSave(this.save);
    const g = this.game;
    if (this.router && !Platform.isBusy() && this.router.current === 'game' && !this.modals.isOpen
      && g && g.session && g.session.mode !== 'tutorial' && g.session.status === 'playing' && !g.busy) {
      g.openPause();
    }
    if (evt.reason !== 'ad') this.scheduleReminder();
  }

  onResume(evt) {
    this.appPaused = false;
    Sfx.resume();
    if (this.modals) this.modals.resumeTimers();
    if (evt.reason === 'ad') return;
    this.notifPermission = Platform.getNotificationPermission();
    if (this.save.flags.notifOptIn) Platform.cancelReminder();
    if (this._pausedAtMs && clock.nowMs() - this._pausedAtMs >= CONFIG.ADS.SESSION_GAP_MIN * 60000) {
      this.adPolicy.onSessionStart();
    }
    this.checkDay(true);
  }

  /** Local reminder when leaving the app (opt-in + permission only; neutral text). */
  scheduleReminder() {
    if (!this.save.flags.notifOptIn) return;
    if (Platform.getNotificationPermission() !== 'granted') return;
    Platform.scheduleReminder(CONFIG.RETENTION.REMINDER_DELAY_MINUTES, t('notify.title'), t('notify.body'));
  }

  /** Day rollover: re-render the active screen. */
  checkDay(force = false) {
    const key = clock.today();
    if (key === this._dayKey && !force) return;
    const changed = key !== this._dayKey;
    this._dayKey = key;
    if (!this.router) return;
    if (changed && this.game && this.router.current !== 'game') this.game.expireStaleDaily();
    this.router.refresh(changed ? 'day' : 'data');
    if (changed) this.emit('day', key);
  }

  // -------------------------------------------------------------------------------------------
  // Purchases, entitlements, ads
  // -------------------------------------------------------------------------------------------

  onEntitlements({ adsRemoved }) {
    const was = this.save.iap.adsRemoved;
    this.save.iap.adsRemoved = !!adsRemoved;
    if (adsRemoved) {
      const gift = this.progression.grantRemoveAdsGift();
      if (gift) {
        if (this.toasts) this.showGiftNotice(gift);
        else this._bootNotices.push({ kind: 'gift', gift });
      }
    }
    requestSave(this.save);
    this.updateBanner();
    if (was !== !!adsRemoved) {
      if (adsRemoved) {
        if (this.toasts) this.toast(t('toast.adsRemoved'), { icon: 'noads', tone: 'good' });
        else this._bootNotices.push({ kind: 'adsRemoved' });
      }
      this.emit('entitlements', { adsRemoved: !!adsRemoved });
      if (this.router) this.router.refresh('data');
    }
  }

  showGiftNotice(gift) {
    this.toast(t('toast.gift', { coins: gift.coins, hammer: gift.hammer, shuffle: gift.shuffle }), { icon: 'gift', tone: 'good', ms: 3600 });
    Sfx.play('reward');
    this.refreshCoins();
  }

  /**
   * Remove-ads detected before the shell existed (a pending payment completed while the app was
   * closed, or bought on another device): confirm it now. Skipped during the very first tutorial.
   */
  flushBootNotices() {
    const list = this._bootNotices;
    this._bootNotices = [];
    if (this.firstLaunch) return;
    for (const n of list) {
      if (n.kind === 'gift') this.showGiftNotice(n.gift);
      else if (n.kind === 'adsRemoved') this.toast(t('toast.adsRemoved'), { icon: 'noads', tone: 'good' });
    }
  }

  onGrant({ token, productId }) {
    const r = this.progression.applyGrant(token, productId);
    if (!r.unknown && flushSave(this.save)) Platform.ackGrant(token);
    if (r.coins > 0) {
      this.toast(t('toast.coins', { n: r.coins }), { icon: 'coin', tone: 'good' });
      Sfx.play('reward');
      this.refreshCoins();
    }
  }

  /**
   * Purchase flow for shop screens. Coins arrive via 'grant', remove_ads via 'entitlements'.
   * @param {string} productId
   * @returns {Promise<string>} purchase status
   */
  async purchase(productId) {
    if (Platform.isBusy()) {
      // another native screen (ad, payment, dialog) is open – say so instead of swallowing the tap
      this.toast(t('toast.purchaseError'), { icon: 'close', tone: 'warn' });
      return 'busy';
    }
    flushSave(this.save);
    Sfx.suspend();
    this.lastPurchaseAt = performance.now();
    let status = 'error';
    try {
      status = await Platform.purchase(productId);
    } catch (e) {
      console.error('[app] purchase failed', e);
    } finally {
      Sfx.resume();
      this.lastPurchaseAt = performance.now();
    }
    if (status === 'pending' && this.modals.defs.has('purchasePending') && !this.modals.isOpen) {
      // nothing is granted yet – explain instead of a fleeting toast
      this.modals.open('purchasePending', { productId });
      return status;
    }
    if (status === 'already_owned') {
      await this.deliverEarlierPurchase(productId);
      return status;
    }
    const msg = {
      pending: 'toast.purchasePending', error: 'toast.purchaseError', unavailable: 'toast.purchaseUnavailable',
    }[status];
    if (msg) this.toast(t(msg), { icon: status === 'pending' ? 'info' : 'close', tone: status === 'pending' ? 'info' : 'warn' });
    return status;
  }

  /**
   * An earlier purchase of this product is still open: re-query so native delivers it (remove_ads →
   * entitlements; coins → the pending grant). Nothing is claimed as delivered before it was: the
   * grant toast confirms a coin pack, a pack that is still being processed says so.
   */
  async deliverEarlierPurchase(productId) {
    const consumable = !!(CONFIG.PRODUCTS[productId] && CONFIG.PRODUCTS[productId].type === 'consumable');
    if (!consumable) {
      this.toast(t('toast.alreadyOwned'), { icon: 'check', tone: 'info' });
      Platform.restorePurchases();
      return;
    }
    this.toast(t('toast.alreadyOwnedChecking'), { icon: 'info', tone: 'info' });
    const coinsBefore = this.save.coins;
    const grantsBefore = this.save.iap.grantedTokens.length;
    const r = await Platform.restorePurchases();
    if (!r || !r.ok) this.toast(t('toast.restoreError'), { icon: 'close', tone: 'warn' });
    else if (this.save.iap.grantedTokens.length === grantsBefore && this.save.coins === coinsBefore) {
      this.toast(t('toast.alreadyOwnedPending'), { icon: 'info', tone: 'info' });
    }
  }

  /** Settings → restore purchases. */
  async restorePurchases() {
    const r = await Platform.restorePurchases();
    if (!r.ok) this.toast(t('toast.restoreError'), { icon: 'close', tone: 'warn' });
    else this.toast(t(r.adsRemoved ? 'toast.restored' : 'toast.restoreNone'), { icon: r.adsRemoved ? 'check' : 'info' });
    return r;
  }

  /** Starts consent + ads SDK (idempotent) and shows the banner slot. */
  startAds() {
    if (this.adsStarted) return;
    this.adsStarted = true;
    Platform.initAds();
    this.updateBanner();
  }

  updateBanner() {
    this.applyBannerClearance();
    const visible = this.adsStarted && CONFIG.ADS.BANNER_ENABLED && !this.save.iap.adsRemoved;
    if (visible === this.bannerVisible) return;
    this.bannerVisible = visible;
    Platform.setBannerVisible(visible);
  }

  /**
   * body.has-banner while a banner can be present (the native slot keeps its height even before the
   * first fill): css/app.css then keeps every touch target ≥ 48 px above the bottom edge.
   */
  applyBannerClearance() {
    const present = CONFIG.ADS.BANNER_ENABLED && !this.save.iap.adsRemoved;
    document.body.classList.toggle('has-banner', present);
    if (this.game && this.game.renderer) this.game.renderer.setBottomReserve(present ? BANNER_CLEARANCE_PX : 0);
  }

  /** Rewarded buttons are offered only when a video is ready (§4.15). */
  isRewardedAvailable() {
    return !!Platform.adState.rewardedReady || (Platform.isMock && Platform.isRewardedReady());
  }

  /**
   * Shows a rewarded video. Every video that was displayed – also one the player closed early –
   * counts as a full-screen ad for the interstitial spacing (adPolicy.markRewardedShown()).
   * @param {string} placement 'revive'|'double'|'booster'|'daily'|'coins'
   * @returns {Promise<boolean>} rewarded
   */
  async showRewarded(placement) {
    if (!this.isRewardedAvailable() || Platform.isBusy()) {
      this.toast(t('toast.noVideo'), { icon: 'info' });
      return false;
    }
    flushSave(this.save);
    Sfx.suspend();
    let result = { rewarded: false, shown: false };
    try {
      result = await Platform.showRewardedResult(placement);
    } catch (e) {
      console.error('[app] rewarded failed', e);
    } finally {
      if (!this.appPaused) Sfx.resume();
    }
    const ok = !!(result && result.rewarded);
    if (ok || (result && result.shown)) this.adPolicy.markRewardedShown(this.runPlaySec());
    if (!ok) this.toast(t('toast.noReward'), { icon: 'info' });
    return ok;
  }

  /** Active seconds of the running run (mid-run rewarded ads restart the interstitial clock from here). */
  runPlaySec() {
    const g = this.game;
    if (!g || !g.session || g.finalized || g.session.mode === 'tutorial') return undefined;
    return g.playSecNow();
  }

  /**
   * Interstitial gate for result-screen buttons (§4.15): only after the screen was visible
   * ≥ RESULT_SCREEN_MIN_MS, only with the result modal alone on screen, never right after a
   * purchase, and only if AdPolicy agrees.
   * @param {number} shownAt performance.now() when the result screen became visible
   * @param {{ newBest?: boolean, nearRecord?: boolean, celebration?: boolean }} [context] emotional
   *   moment of the result (AdPolicy skips the ad, the counters stay untouched)
   * @returns {Promise<boolean>} shown
   */
  async maybeInterstitial(shownAt, context = {}) {
    if (!shownAt || performance.now() - shownAt < CONFIG.ADS.RESULT_SCREEN_MIN_MS) return false;
    if (this.modals.stack.length !== 1 || this.lastPurchaseAt > shownAt) return false;
    if (!this.adsStarted || !this.adPolicy.shouldShowInterstitial(context)) return false;
    flushSave(this.save);
    Sfx.suspend();
    let shown = false;
    try {
      shown = await Platform.showInterstitial();
    } catch (e) {
      console.error('[app] interstitial failed', e);
    } finally {
      if (!this.appPaused) Sfx.resume();
    }
    if (shown) this.adPolicy.markInterstitialShown();
    return shown;
  }

  /** Free booster videos left today (persisted by the meta layer; in-memory fallback otherwise). */
  freeBoostersLeft() {
    const P = this.progression;
    if (typeof P.freeBoostersLeft === 'function') return P.freeBoostersLeft();
    const f = this._freeBoosterFallback;
    if (f.day !== this.clock.today()) {
      f.day = this.clock.today();
      f.count = 0;
    }
    return Math.max(0, CONFIG.ADS.FREE_BOOSTER_ADS_PER_DAY - f.count);
  }

  /** Grants one free booster for a watched video (counts against the daily cap). */
  grantFreeBooster(type) {
    const P = this.progression;
    if (typeof P.grantFreeBooster === 'function') return P.grantFreeBooster(type);
    this.freeBoostersLeft();
    this._freeBoosterFallback.count += 1;
    P.addBooster(type, 1);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Settings, theme, language
  // -------------------------------------------------------------------------------------------

  /**
   * @param {'sound'|'music'|'haptics'|'lang'} key
   * @param {boolean|string} value
   */
  setSetting(key, value) {
    if (key === 'lang') {
      this.setLanguage(String(value));
      return;
    }
    this.save.settings[key] = !!value;
    requestSave(this.save);
    this.applyAudioSettings();
    if (key === 'haptics' && value) Platform.haptic('light');
    this.emit('settings', { key, value: !!value });
  }

  applyAudioSettings() {
    Sfx.setSoundEnabled(this.save.settings.sound);
    Sfx.setMusicEnabled(this.save.settings.music);
  }

  /**
   * Language setting ('auto' or a code): re-translates the DOM and the canvas texts.
   * @param {string} setting
   */
  setLanguage(setting) {
    this.save.settings.lang = setting;
    requestSave(this.save);
    setLang(resolveLang(setting, this.deviceLocale()));
    translateDom(document.body);
    if (this.game) {
      this.game.renderer.setTranslator(t);
      this.game.hud.refresh();
    }
    this.router.refresh('lang');
    this.modals.refresh('lang');
    this.refreshCoins({ instant: true }); // number format of the coin pills
    this.emit('lang', setting);
  }

  deviceLocale() {
    return (Platform.info && Platform.info.locale) || navigator.language || 'en';
  }

  /** Applies a block theme to the canvas and the DOM (CSS variables). */
  applyTheme(id) {
    const theme = getTheme(id);
    this.themeId = theme.id;
    const root = document.documentElement;
    const vars = themeCssVars(theme);
    for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
    root.style.colorScheme = vars['--scheme'];
    root.setAttribute('data-theme', theme.id);
    root.setAttribute('data-scheme', vars['--scheme']);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--bg-top']);
    // the native strip behind the banner slot / navigation bar follows the page's bottom colour
    Platform.setThemeColors({ background: theme.bg[1] });
    if (this.game && this.game.renderer) this.game.renderer.setTheme(theme);
    if (this.router) this.router.refresh('theme');
    this.emit('theme', theme.id);
  }

  /** Haptic feedback (respects settings.haptics). */
  haptic(kind) {
    if (this.save.settings.haptics) Platform.haptic(kind);
  }

  // -------------------------------------------------------------------------------------------
  // Feedback helpers
  // -------------------------------------------------------------------------------------------

  /** Toast (also logged for tests). */
  toast(text, opts) {
    this.toastLog.push(text);
    if (this.toastLog.length > TOAST_LOG) this.toastLog.shift();
    if (this.toasts) this.toasts.show(text, opts);
  }

  /**
   * Completed missions: a sound cue now; the toast waits while the game screen is up (it would
   * cover score, best and combo) and shows once the player is on another screen. A run's result
   * screen lists the missions itself (takeQueuedMissions).
   */
  announceMissions(list) {
    if (!list.length) return;
    Sfx.play('unlock');
    if (this.router && this.router.current === 'game') this._missionQueue.push(...list);
    else this.showMissionToasts(list);
  }

  showMissionToasts(list) {
    for (const m of list) {
      this.toast(t('toast.missionDone', { text: t(m.textKey, { n: m.target }) }), { icon: 'missions', tone: 'good', ms: 3000 });
    }
  }

  /** Shows the queued mission toasts (the player left the game screen without a result screen). */
  flushMissionToasts() {
    if (!this._missionQueue.length || !this.toasts) return;
    const list = this._missionQueue.splice(0);
    this.showMissionToasts(list);
  }

  /** @returns {Object[]} missions completed during the run so far (removed from the toast queue) */
  takeQueuedMissions() {
    return this._missionQueue.splice(0);
  }

  /**
   * Updates every coin pill ([data-coins]) to the balance with a count-up.
   * @param {{ instant?: boolean, from?: number }} [opts]
   */
  refreshCoins({ instant = false, from } = {}) {
    for (const el of document.querySelectorAll('[data-coins]')) {
      countUp(el, this.save.coins, { from, ms: instant ? 0 : 600, format: formatNumber });
    }
    this.emit('coins', this.save.coins);
  }

  /**
   * Coins fly from `fromEl` into the visible coin pill, which then counts up.
   * @param {Element} fromEl
   * @param {number} amount
   */
  flyCoins(fromEl, amount) {
    const scope = this.modals.top() ? this.modals.top().el : this.router.el(this.router.current);
    const pill = scope.querySelector('[data-coin-pill]');
    if (!pill || !(amount > 0)) {
      this.refreshCoins();
      return Promise.resolve();
    }
    Sfx.play('coin');
    return flyCoins(fromEl, pill, Math.ceil(Math.min(10, amount / 5))).then(() => {
      this.refreshCoins();
      pop(pill, 1.15);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Misc
  // -------------------------------------------------------------------------------------------

  /** Speeds up / freezes all UI + canvas animations (debug, tests). */
  setTimeScale(x) {
    this.timeScale = x;
    setAnimScale(x);
    if (this.game && this.game.renderer) this.game.renderer.timeScale = x;
  }

  /**
   * Settings → reset progress (after confirm): starts over with a fresh save and reloads.
   * Kept: purchases (save.iap – so ads stay removed and the remove-ads gift is not granted twice;
   * granted purchase tokens stay idempotent), settings (sound, music, vibration, language) and the
   * one-time flags that must never repeat (tutorial, reminder opt-in / asks, review request).
   * The fresh data replaces the shared save object in place, so a late pause/flush can only ever
   * write the reset state.
   */
  resetProgress() {
    const old = JSON.parse(JSON.stringify(this.save));
    const fresh = defaultSave();
    fresh.iap = {
      adsRemoved: !!old.iap.adsRemoved,
      adsGiftGranted: !!old.iap.adsGiftGranted,
      grantedTokens: Array.isArray(old.iap.grantedTokens) ? old.iap.grantedTokens.slice() : [],
    };
    fresh.settings = { ...fresh.settings, ...old.settings };
    for (const key of ['tutorialDone', 'notifAsked', 'notifOptIn', 'notifDeclines', 'reviewAsked']) fresh.flags[key] = old.flags[key];
    if (this.game) this.game.discardRun();
    for (const key of Object.keys(this.save)) delete this.save[key];
    Object.assign(this.save, fresh);
    this._resetting = true;
    clearSave();
    flushSave(this.save);
    window.location.reload();
  }

  /** @param {string} type @param {Function} fn @returns {() => void} unsubscribe */
  on(type, fn) {
    if (!this._events.has(type)) this._events.set(type, new Set());
    this._events.get(type).add(fn);
    return () => this._events.get(type).delete(fn);
  }

  emit(type, data) {
    const set = this._events.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (e) {
        console.error(`[app] ${type} listener failed`, e);
      }
    }
  }
}
