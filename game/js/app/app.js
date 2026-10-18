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
//          arrival at home (js/app/popups.js).
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
    this._dayKey = '';
    this._dayTimer = 0;
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
      if (!this.save) this.initSave(defaultSave());
      step('platform events', () => this.wirePlatform());
      try {
        await Platform.init();
      } catch (e) {
        console.error('[boot] Platform.init failed', e);
      }
      step('entitlements', () => this.syncEntitlements());
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

  /** Save + meta objects (Progression / AdPolicy share the one save object). */
  initSave(preset) {
    setStorageBackend({ saveData: (json) => Platform.saveData(json) });
    this.save = preset || loadSave(Platform.loadData());
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
    this.registerGlobalActions();
  }

  async initGame() {
    this.game = new GameController(this);
    await this.game.init();
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
    }
    clearInterval(this._dayTimer);
    if (id === 'home') this._dayTimer = setInterval(() => this.checkDay(), DAY_CHECK_MS);
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
      if (gift && this.toasts) {
        this.toast(t('toast.gift', { coins: gift.coins, hammer: gift.hammer, shuffle: gift.shuffle }), { icon: 'gift', tone: 'good', ms: 3600 });
        Sfx.play('reward');
        this.refreshCoins();
      }
    }
    requestSave(this.save);
    this.updateBanner();
    if (was !== !!adsRemoved) {
      if (adsRemoved && this.toasts) this.toast(t('toast.adsRemoved'), { icon: 'noads', tone: 'good' });
      this.emit('entitlements', { adsRemoved: !!adsRemoved });
      if (this.router) this.router.refresh('data');
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
    if (Platform.isBusy()) return 'busy';
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
    const msg = {
      pending: 'toast.purchasePending', error: 'toast.purchaseError', unavailable: 'toast.purchaseUnavailable', already_owned: 'toast.alreadyOwned',
    }[status];
    if (msg) this.toast(t(msg), { icon: status === 'pending' ? 'info' : 'close', tone: status === 'pending' || status === 'already_owned' ? 'info' : 'warn' });
    if (status === 'already_owned') Platform.restorePurchases();
    return status;
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
    const visible = this.adsStarted && CONFIG.ADS.BANNER_ENABLED && !this.save.iap.adsRemoved;
    if (visible === this.bannerVisible) return;
    this.bannerVisible = visible;
    Platform.setBannerVisible(visible);
  }

  /** Rewarded buttons are offered only when a video is ready (§4.15). */
  isRewardedAvailable() {
    return !!Platform.adState.rewardedReady || (Platform.isMock && Platform.isRewardedReady());
  }

  /**
   * Shows a rewarded video. Every rewarded ad that resolved true → adPolicy.markRewardedShown().
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
    let ok = false;
    try {
      ok = await Platform.showRewarded(placement);
    } catch (e) {
      console.error('[app] rewarded failed', e);
    } finally {
      if (!this.appPaused) Sfx.resume();
    }
    if (ok) this.adPolicy.markRewardedShown();
    else this.toast(t('toast.noReward'), { icon: 'info' });
    return ok;
  }

  /**
   * Interstitial gate for result-screen buttons (§4.15): only after the screen was visible
   * ≥ RESULT_SCREEN_MIN_MS, only with the result modal alone on screen, never right after a
   * purchase, and only if AdPolicy agrees.
   * @param {number} shownAt performance.now() when the result screen became visible
   * @returns {Promise<boolean>} shown
   */
  async maybeInterstitial(shownAt) {
    if (!shownAt || performance.now() - shownAt < CONFIG.ADS.RESULT_SCREEN_MIN_MS) return false;
    if (this.modals.stack.length !== 1 || this.lastPurchaseAt > shownAt) return false;
    if (!this.adsStarted || !this.adPolicy.shouldShowInterstitial()) return false;
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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--bg-top']);
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

  /** Completed missions → one toast each. */
  announceMissions(list) {
    for (const m of list) {
      this.toast(t('toast.missionDone', { text: t(m.textKey, { n: m.target }) }), { icon: 'missions', tone: 'good', ms: 3000 });
    }
    if (list.length) Sfx.play('unlock');
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

  /** Settings → reset progress (after confirm): wipes the save and reloads. */
  resetProgress() {
    clearSave();
    flushSave(defaultSave());
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
