// JS side of the Android bridge (see docs/ARCHITECTURE.md §4.14).
// On Android the native shell injects `window.BlockoNative` (GameBridge.kt) and answers
// asynchronously through `window.__blockoNative.dispatch(event)`.
// In a normal browser everything is simulated so the game is fully playable and testable.
import { CONFIG } from '../config.js';

const hasWindow = typeof window !== 'undefined';
const native = hasWindow && window.BlockoNative ? window.BlockoNative : null;
const APP_HOST = 'appassets.androidplatform.net';
const onAppHost = hasWindow && window.location.hostname === APP_HOST;
// The browser mock (free purchases, test ad overlays) must never be active inside the app.
const mockEnabled = !native && !onAppHost;
const params = hasWindow ? new URLSearchParams(window.location.search) : new URLSearchParams();
const mockMode = params.get('mock') || ''; // '' | 'fast' | 'nofill'

const MOCK_ADS_REMOVED_KEY = 'blocko.mock.adsRemoved';
const MOCK_SAVE_KEY = 'blocko.mock.nativeSave';
const LONG_TIMEOUT = 30 * 60 * 1000; // safety net only – native answers every request exactly once

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();
/** events that arrive before anyone listens are buffered and flushed to the first subscriber */
const STICKY_TYPES = new Set(['grant', 'entitlements', 'adState', 'insets']);
/** @type {Map<string, any[]>} */
const queued = new Map();
/** @type {Map<string, {resolve: Function, timer: any, fallback: any, modal: boolean}>} */
const pending = new Map();
/** ids of pending requests that put native UI over the WebView (ad, purchase flow, dialogs) */
const modalPending = new Set();
let requestCounter = 0;
let mockOverlayVisible = false;
let adsRemoved = false;
let adsInitRequested = false;
let adState = { canRequestAds: false, rewardedReady: false, interstitialReady: false, privacyOptionsRequired: false };
let info = null;
let initPromise = null;

function emit(type, payload) {
  const set = listeners.get(type);
  if (!set || set.size === 0) {
    if (STICKY_TYPES.has(type)) {
      if (!queued.has(type)) queued.set(type, []);
      queued.get(type).push(payload);
    }
    return;
  }
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (e) {
      console.error('[Platform] listener error', type, e);
    }
  }
}

function nextRequestId() {
  requestCounter += 1;
  return `r${requestCounter}_${Date.now().toString(36)}`;
}

/**
 * Sends a request to native and resolves with the matching *Result event (or fallback on timeout/error).
 * `modal` requests put native UI over the WebView (interstitial, rewarded, purchase flow, privacy
 * options, notification permission) and are the only ones that make isBusy() true.
 */
function request(send, timeoutMs, fallback, modal = false) {
  const id = nextRequestId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      forget(id);
      resolve(fallback);
    }, timeoutMs);
    pending.set(id, { resolve, timer, fallback, modal });
    if (modal) modalPending.add(id);
    try {
      send(id);
    } catch (e) {
      console.error('[Platform] native call failed', e);
      clearTimeout(timer);
      forget(id);
      resolve(fallback);
    }
  });
}

function forget(id) {
  pending.delete(id);
  modalPending.delete(id);
}

function settle(requestId, value) {
  const p = pending.get(requestId);
  if (!p) return;
  forget(requestId);
  clearTimeout(p.timer);
  p.resolve(value);
}

function applyAdState(evt) {
  adState = {
    canRequestAds: !!evt.canRequestAds,
    rewardedReady: !!evt.rewardedReady,
    interstitialReady: !!evt.interstitialReady,
    privacyOptionsRequired: !!evt.privacyOptionsRequired,
  };
  if (info) info.privacyOptionsRequired = adState.privacyOptionsRequired;
}

/** Entry point for native → JS events. */
function dispatch(evt) {
  if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') return;
  switch (evt.type) {
    case 'interstitialResult':
      settle(evt.requestId, !!evt.shown);
      break;
    case 'rewardedResult':
      // `shown`: the video was displayed at all (a skipped video is shown but not rewarded)
      settle(evt.requestId, { rewarded: !!evt.rewarded, shown: evt.shown === undefined ? !!evt.rewarded : !!evt.shown });
      break;
    case 'productsResult':
      settle(evt.requestId, Array.isArray(evt.products) ? evt.products : []);
      break;
    case 'purchaseResult':
      settle(evt.requestId, typeof evt.status === 'string' ? evt.status : 'error');
      break;
    case 'restoreResult':
      if (evt.ok) adsRemoved = !!evt.adsRemoved;
      settle(evt.requestId, { ok: !!evt.ok, adsRemoved: !!evt.adsRemoved });
      break;
    case 'privacyOptionsResult':
      settle(evt.requestId, undefined);
      break;
    case 'notificationPermissionResult':
      // Android 13+ allows one more system prompt after a first denial, so ask native for the real state.
      if (info) info.notificationPermission = evt.granted ? 'granted' : Platform.getNotificationPermission();
      settle(evt.requestId, !!evt.granted);
      break;
    case 'entitlements':
      adsRemoved = !!evt.adsRemoved;
      emit('entitlements', { adsRemoved });
      break;
    case 'adState':
      applyAdState(evt);
      emit('adState', { ...adState });
      break;
    case 'insets':
      if (info) info.insets = { ...evt };
      emit('insets', evt);
      break;
    default:
      // 'pause' | 'resume' | 'back' | 'grant' | future events
      emit(evt.type, evt);
  }
}

// ---------------------------------------------------------------------------
// Browser mock helpers
// ---------------------------------------------------------------------------

function mockDelay(normalMs) {
  return mockMode === 'fast' ? 50 : normalMs;
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function mockAdsAvailable() {
  return mockEnabled && mockMode !== 'nofill' && adsInitRequested;
}

function refreshMockAdState() {
  if (!mockEnabled) return;
  const available = mockAdsAvailable();
  applyAdState({
    canRequestAds: adsInitRequested,
    rewardedReady: available,
    interstitialReady: available && !adsRemoved,
    privacyOptionsRequired: params.get('privacy') === '1',
  });
  emit('adState', { ...adState });
}

/** Shows a simple full-screen "TEST AD" overlay for `ms` milliseconds. */
function mockAdOverlay(label, ms) {
  mockOverlayVisible = true;
  emit('pause', { type: 'pause', reason: 'ad' });
  return new Promise((resolve) => {
    const finish = () => {
      mockOverlayVisible = false;
      emit('resume', { type: 'resume', reason: 'ad' });
      resolve();
    };
    if (!hasWindow || !document.body) {
      setTimeout(finish, ms);
      return;
    }
    const el = document.createElement('div');
    el.setAttribute('data-mock-ad', label);
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:12px', 'background:rgba(8,6,24,0.94)',
      'color:#fff', 'font:700 22px system-ui,sans-serif', 'letter-spacing:1px', 'text-align:center',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = 'TEST AD';
    const sub = document.createElement('div');
    sub.style.cssText = 'font-weight:500;font-size:14px;opacity:.7';
    sub.textContent = label;
    el.append(title, sub);
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
      finish();
    }, ms);
  });
}

const MOCK_PRODUCTS = [
  { id: 'remove_ads', title: 'Remove ads', price: '4,99 €' },
  { id: 'coins_small', title: '1.500 coins', price: '1,99 €' },
  { id: 'coins_large', title: '6.000 coins', price: '4,99 €' },
];

const HAPTIC_PATTERNS = {
  light: 8,
  medium: 16,
  heavy: 30,
  success: [12, 40, 22],
  error: [30, 40, 30],
};

function callNative(name, ...args) {
  try {
    return native[name](...args);
  } catch (e) {
    console.error(`[Platform] ${name} failed`, e);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const Platform = {
  isNative: !!native,
  isMock: mockEnabled,

  get info() {
    return info;
  },

  /** Reads native info, installs the dispatcher and tells native that JS is ready. */
  init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (hasWindow) {
        window.__blockoNative = { dispatch };
      }
      if (native) {
        // This document goes away (e.g. reload): native queues events for the next one and
        // disables back until that document calls ready() (GameBridge.pageUnloading).
        window.addEventListener('pagehide', () => callNative('pageUnloading'));
        try {
          info = JSON.parse(native.getInfo());
        } catch (e) {
          console.error('[Platform] getInfo failed', e);
          info = { platform: 'android' };
        }
        adsRemoved = !!info.adsRemoved;
        applyAdState(info);
        callNative('ready');
        return;
      }
      if (!mockEnabled) {
        console.error('[Platform] running on the app host without BlockoNative – ads and purchases disabled');
      }
      adsRemoved = mockEnabled && storageGet(MOCK_ADS_REMOVED_KEY) === '1';
      info = {
        platform: mockEnabled ? 'web' : 'android-nobridge',
        appVersion: CONFIG.VERSION,
        versionCode: 0,
        sdkInt: 0,
        webViewVersion: '',
        locale: hasWindow ? navigator.language : 'en',
        debug: mockEnabled,
        adsRemoved,
        canRequestAds: false,
        rewardedReady: false,
        interstitialReady: false,
        privacyOptionsRequired: mockEnabled && params.get('privacy') === '1',
        notificationPermission: mockEnabled ? 'prompt' : 'unsupported',
        bannerHeightDp: 0,
        insets: { top: 0, right: 0, bottom: 0, left: 0, gestureLeft: 0, gestureRight: 0 },
      };
      applyAdState(info);
      if (hasWindow && mockEnabled) {
        // Desktop convenience: Escape behaves like the Android back button.
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') emit('back', { type: 'back' });
        });
        document.addEventListener('visibilitychange', () => {
          emit(document.hidden ? 'pause' : 'resume', { type: document.hidden ? 'pause' : 'resume' });
        });
      }
    })();
    return initPromise;
  },

  /** Subscribe to 'pause'|'resume'|'back'|'entitlements'|'grant'|'adState'|'insets'. Returns an unsubscribe fn. */
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    const backlog = queued.get(type);
    if (backlog && backlog.length) {
      queued.delete(type);
      // deliver asynchronously so the caller finishes wiring first
      setTimeout(() => backlog.forEach((p) => emit(type, p)), 0);
    }
    return () => listeners.get(type)?.delete(fn);
  },

  /**
   * True while native UI covers the WebView: an interstitial / rewarded video, the purchase flow,
   * the privacy options form or the notification permission dialog (or a mock ad overlay).
   * Background queries (queryProducts, restorePurchases) do NOT count: the player keeps control.
   */
  isBusy() {
    return modalPending.size > 0 || mockOverlayVisible;
  },

  get adsRemoved() {
    return adsRemoved;
  },

  get adState() {
    return { ...adState };
  },

  /** Durable native save snapshot ('' if none). */
  loadData() {
    if (native) {
      const v = callNative('loadData');
      return typeof v === 'string' ? v : '';
    }
    return mockEnabled ? storageGet(MOCK_SAVE_KEY) || '' : '';
  },

  /** Hands the latest save snapshot to native, which writes it atomically in the background. */
  saveData(json) {
    if (native) {
      callNative('saveData', String(json));
      return;
    }
    if (mockEnabled) storageSet(MOCK_SAVE_KEY, String(json));
  },

  /** Starts consent + ads SDK (idempotent). Called after the first game-over screen, or at boot later on. */
  initAds() {
    if (adsInitRequested) return;
    adsInitRequested = true;
    if (native) {
      callNative('initAds');
      return;
    }
    refreshMockAdState();
  },

  showInterstitial() {
    if (adsRemoved) return Promise.resolve(false);
    if (native) return request((id) => native.showInterstitial(id), LONG_TIMEOUT, false, true);
    if (!mockAdsAvailable()) return Promise.resolve(false);
    return mockAdOverlay('Interstitial', mockDelay(1500)).then(() => true);
  },

  /** Resolves true only if the user earned the reward. */
  showRewarded(placement) {
    return Platform.showRewardedResult(placement).then((r) => r.rewarded);
  },

  /**
   * Like showRewarded(), but also tells whether a video was displayed at all: a video the player
   * closed early is `{ rewarded: false, shown: true }` and still counts as a full-screen ad.
   * @returns {Promise<{ rewarded: boolean, shown: boolean }>}
   */
  showRewardedResult(placement) {
    if (native) {
      return request((id) => native.showRewarded(id, String(placement || '')), LONG_TIMEOUT, { rewarded: false, shown: false }, true);
    }
    if (!mockAdsAvailable()) return Promise.resolve({ rewarded: false, shown: false });
    return mockAdOverlay(`Rewarded (${placement})`, mockDelay(1500)).then(() => ({ rewarded: true, shown: true }));
  },

  isRewardedReady() {
    if (native) return !!callNative('isRewardedReady');
    return mockAdsAvailable();
  },

  setBannerVisible(visible) {
    if (native) callNative('setBannerVisible', !!visible);
  },

  /**
   * Tints the native strip around the WebView (banner slot, navigation-bar padding) to the theme.
   * @param {{ background?: string }} colors '#RRGGBB'
   */
  setThemeColors({ background } = {}) {
    if (!native || typeof native.setThemeColors !== 'function') return;
    if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) return;
    callNative('setThemeColors', background);
  },

  /** @returns {Promise<Array<{id: string, title: string, price: string}>>} */
  getProducts() {
    if (native) return request((id) => native.queryProducts(id), 15000, []);
    if (!mockEnabled) return Promise.resolve([]);
    return Promise.resolve(MOCK_PRODUCTS.map((p) => ({ ...p })));
  },

  /** @returns {Promise<'success'|'cancelled'|'pending'|'error'|'already_owned'|'unavailable'>} */
  purchase(productId) {
    if (native) return request((id) => native.purchase(id, String(productId)), LONG_TIMEOUT, 'error', true);
    if (!mockEnabled) return Promise.resolve('unavailable');
    const product = CONFIG.PRODUCTS[productId];
    if (!product) return Promise.resolve('unavailable');
    return new Promise((resolve) => {
      setTimeout(() => {
        if (product.type === 'nonconsumable') {
          if (adsRemoved) {
            resolve('already_owned');
            return;
          }
          adsRemoved = true;
          storageSet(MOCK_ADS_REMOVED_KEY, '1');
          emit('entitlements', { adsRemoved: true });
          refreshMockAdState();
          resolve('success');
        } else {
          // like native: the grant is dispatched before the success result
          emit('grant', { type: 'grant', token: `mock-${productId}-${Date.now().toString(36)}`, productId });
          resolve('success');
        }
      }, mockDelay(400));
    });
  },

  /** @returns {Promise<{ok: boolean, adsRemoved: boolean}>} */
  restorePurchases() {
    if (native) return request((id) => native.restorePurchases(id), 30000, { ok: false, adsRemoved });
    if (!mockEnabled) return Promise.resolve({ ok: false, adsRemoved });
    adsRemoved = storageGet(MOCK_ADS_REMOVED_KEY) === '1';
    emit('entitlements', { adsRemoved });
    return Promise.resolve({ ok: true, adsRemoved });
  },

  ackGrant(token) {
    if (native) callNative('ackGrant', String(token));
  },

  haptic(kind) {
    if (native) {
      callNative('haptic', String(kind));
      return;
    }
    if (hasWindow && navigator.vibrate) {
      try {
        navigator.vibrate(HAPTIC_PATTERNS[kind] ?? HAPTIC_PATTERNS.light);
      } catch {
        /* ignore */
      }
    }
  },

  share(text) {
    if (native) {
      callNative('share', String(text));
      return;
    }
    if (!hasWindow) return;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  },

  requestReview() {
    if (native) {
      callNative('requestReview');
      return;
    }
    console.info('[Platform mock] requestReview');
  },

  openUrl(url) {
    if (native) {
      callNative('openUrl', String(url));
      return;
    }
    if (hasWindow && !/^market:/i.test(url)) window.open(url, '_blank', 'noopener');
    else console.info('[Platform mock] openUrl', url);
  },

  isPrivacyOptionsRequired() {
    if (native) return !!callNative('isPrivacyOptionsRequired');
    return adState.privacyOptionsRequired;
  },

  showPrivacyOptions() {
    if (native) return request((id) => native.showPrivacyOptions(id), LONG_TIMEOUT, undefined, true);
    console.info('[Platform mock] showPrivacyOptions');
    return Promise.resolve();
  },

  /** @returns {'granted'|'denied'|'prompt'|'unsupported'} */
  getNotificationPermission() {
    if (native) {
      const v = String(callNative('getNotificationPermission'));
      return ['granted', 'denied', 'prompt', 'unsupported'].includes(v) ? v : 'unsupported';
    }
    return (info && info.notificationPermission) || 'unsupported';
  },

  requestNotificationPermission() {
    if (native) return request((id) => native.requestNotificationPermission(id), LONG_TIMEOUT, false, true);
    if (!mockEnabled) return Promise.resolve(false);
    if (info) info.notificationPermission = 'granted';
    return Promise.resolve(true);
  },

  openNotificationSettings() {
    if (native) callNative('openNotificationSettings');
    else console.info('[Platform mock] openNotificationSettings');
  },

  scheduleReminder(delayMinutes, title, body) {
    if (native) {
      callNative('scheduleReminder', Math.max(1, Math.round(delayMinutes)), String(title), String(body));
      return;
    }
    console.info('[Platform mock] scheduleReminder', delayMinutes, title, body);
  },

  cancelReminder() {
    if (native) callNative('cancelReminder');
    else console.info('[Platform mock] cancelReminder');
  },

  exitApp() {
    if (native) callNative('exitApp');
    else console.info('[Platform mock] exitApp');
  },

  /** Test/debug helper: inject a platform event as if it came from native. */
  _simulate(evt) {
    dispatch(evt);
  },
};
