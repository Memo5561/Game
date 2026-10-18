// JS side of the Android bridge (see docs/ARCHITECTURE.md §4.14).
// On Android the native shell injects `window.BlockoNative` (GameBridge.kt) and answers
// asynchronously through `window.__blockoNative.dispatch(event)`.
// In a normal browser everything is simulated so the game is fully playable and testable.
import { CONFIG } from '../config.js';

const hasWindow = typeof window !== 'undefined';
const native = hasWindow && window.BlockoNative ? window.BlockoNative : null;
const params = hasWindow ? new URLSearchParams(window.location.search) : new URLSearchParams();
const mockMode = params.get('mock') || ''; // '' | 'fast' | 'nofill'

const MOCK_STORE_KEY = 'blocko.mock.adsRemoved';

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();
/** events that arrived before anyone listened (delivered on first subscription) */
const STICKY_TYPES = new Set(['grant', 'entitlements']);
/** @type {Map<string, any[]>} */
const queued = new Map();
/** @type {Map<string, {resolve: Function, timer: any, fallback: any}>} */
const pending = new Map();
let requestCounter = 0;
let adsRemoved = false;
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

/** Sends a request to native and resolves with the matching *Result event (or fallback on timeout/error). */
function request(send, timeoutMs, fallback) {
  const id = nextRequestId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(fallback);
    }, timeoutMs);
    pending.set(id, { resolve, timer, fallback });
    try {
      send(id);
    } catch (e) {
      console.error('[Platform] native call failed', e);
      clearTimeout(timer);
      pending.delete(id);
      resolve(fallback);
    }
  });
}

function settle(requestId, value) {
  const p = pending.get(requestId);
  if (!p) return;
  pending.delete(requestId);
  clearTimeout(p.timer);
  p.resolve(value);
}

/** Entry point for native → JS events. */
function dispatch(evt) {
  if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') return;
  switch (evt.type) {
    case 'interstitialResult':
      settle(evt.requestId, !!evt.shown);
      break;
    case 'rewardedResult':
      settle(evt.requestId, !!evt.rewarded);
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
      if (info) info.notificationPermission = evt.granted ? 'granted' : 'denied';
      settle(evt.requestId, !!evt.granted);
      break;
    case 'entitlements':
      adsRemoved = !!evt.adsRemoved;
      emit('entitlements', { adsRemoved });
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

function readMockAdsRemoved() {
  try {
    return hasWindow && window.localStorage.getItem(MOCK_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMockAdsRemoved(v) {
  try {
    window.localStorage.setItem(MOCK_STORE_KEY, v ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/** Shows a simple full-screen "TEST AD" overlay for `ms` milliseconds. */
function mockAdOverlay(label, ms) {
  return new Promise((resolve) => {
    if (!hasWindow || !document.body) {
      setTimeout(resolve, ms);
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
      resolve();
    }, ms);
  });
}

const MOCK_PRODUCTS = [
  { id: 'remove_ads', title: 'Remove ads', price: '2,99 €' },
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const Platform = {
  isNative: !!native,

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
        try {
          info = JSON.parse(native.getInfo());
        } catch (e) {
          console.error('[Platform] getInfo failed', e);
          info = { platform: 'android' };
        }
        adsRemoved = !!(info && info.adsRemoved);
        try {
          native.ready();
        } catch (e) {
          console.error('[Platform] ready failed', e);
        }
      } else {
        adsRemoved = readMockAdsRemoved();
        info = {
          platform: 'web',
          appVersion: CONFIG.VERSION,
          versionCode: 0,
          sdkInt: 0,
          locale: hasWindow ? navigator.language : 'en',
          adsRemoved,
          privacyOptionsRequired: params.get('privacy') === '1',
          notificationPermission: 'prompt',
        };
        if (hasWindow) {
          // Desktop convenience: Escape behaves like the Android back button.
          window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') emit('back', { type: 'back' });
          });
          document.addEventListener('visibilitychange', () => {
            emit(document.hidden ? 'pause' : 'resume', { type: document.hidden ? 'pause' : 'resume' });
          });
        }
      }
    })();
    return initPromise;
  },

  /** Subscribe to 'pause' | 'resume' | 'back' | 'entitlements' | 'grant'. Returns an unsubscribe fn. */
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

  get adsRemoved() {
    return adsRemoved;
  },

  showInterstitial() {
    if (adsRemoved) return Promise.resolve(false);
    if (native) return request((id) => native.showInterstitial(id), 90000, false);
    if (mockMode === 'nofill') return Promise.resolve(false);
    return mockAdOverlay('Interstitial', mockDelay(1500)).then(() => true);
  },

  /** Resolves true only if the user earned the reward. */
  showRewarded(placement) {
    if (native) return request((id) => native.showRewarded(id, String(placement || '')), 150000, false);
    if (mockMode === 'nofill') return Promise.resolve(false);
    return mockAdOverlay(`Rewarded (${placement})`, mockDelay(1500)).then(() => true);
  },

  isRewardedReady() {
    if (native) {
      try {
        return !!native.isRewardedReady();
      } catch {
        return false;
      }
    }
    return mockMode !== 'nofill';
  },

  setBannerVisible(visible) {
    if (!native) return;
    try {
      native.setBannerVisible(!!visible);
    } catch (e) {
      console.error('[Platform] setBannerVisible failed', e);
    }
  },

  /** @returns {Promise<Array<{id: string, title: string, price: string}>>} */
  getProducts() {
    if (native) return request((id) => native.queryProducts(id), 15000, []);
    return Promise.resolve(MOCK_PRODUCTS.map((p) => ({ ...p })));
  },

  /** @returns {Promise<'success'|'cancelled'|'pending'|'error'|'already_owned'|'unavailable'>} */
  purchase(productId) {
    if (native) return request((id) => native.purchase(id, String(productId)), 600000, 'error');
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
          writeMockAdsRemoved(true);
          resolve('success');
          emit('entitlements', { adsRemoved: true });
        } else {
          resolve('success');
          emit('grant', { type: 'grant', token: `mock-${productId}-${Date.now().toString(36)}`, productId });
        }
      }, mockDelay(400));
    });
  },

  /** @returns {Promise<{ok: boolean, adsRemoved: boolean}>} */
  restorePurchases() {
    if (native) return request((id) => native.restorePurchases(id), 30000, { ok: false, adsRemoved });
    adsRemoved = readMockAdsRemoved();
    emit('entitlements', { adsRemoved });
    return Promise.resolve({ ok: true, adsRemoved });
  },

  ackGrant(token) {
    if (!native) return;
    try {
      native.ackGrant(String(token));
    } catch (e) {
      console.error('[Platform] ackGrant failed', e);
    }
  },

  haptic(kind) {
    if (native) {
      try {
        native.haptic(String(kind));
      } catch {
        /* ignore */
      }
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
      try {
        native.share(String(text));
      } catch (e) {
        console.error('[Platform] share failed', e);
      }
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
      try {
        native.requestReview();
      } catch {
        /* ignore */
      }
      return;
    }
    console.info('[Platform mock] requestReview');
  },

  openUrl(url) {
    if (native) {
      try {
        native.openUrl(String(url));
      } catch (e) {
        console.error('[Platform] openUrl failed', e);
      }
      return;
    }
    if (hasWindow) window.open(url, '_blank', 'noopener');
  },

  isPrivacyOptionsRequired() {
    if (native) {
      try {
        return !!native.isPrivacyOptionsRequired();
      } catch {
        return false;
      }
    }
    return !!(info && info.privacyOptionsRequired);
  },

  showPrivacyOptions() {
    if (native) return request((id) => native.showPrivacyOptions(id), 600000, undefined);
    console.info('[Platform mock] showPrivacyOptions');
    return Promise.resolve();
  },

  /** @returns {'granted'|'denied'|'prompt'|'unsupported'} */
  getNotificationPermission() {
    if (native) {
      try {
        const v = String(native.getNotificationPermission());
        return ['granted', 'denied', 'prompt', 'unsupported'].includes(v) ? v : 'unsupported';
      } catch {
        return 'unsupported';
      }
    }
    return (info && info.notificationPermission) || 'prompt';
  },

  requestNotificationPermission() {
    if (native) return request((id) => native.requestNotificationPermission(id), 300000, false);
    if (info) info.notificationPermission = 'granted';
    return Promise.resolve(true);
  },

  scheduleReminder(delayMinutes, title, body) {
    if (native) {
      try {
        native.scheduleReminder(Math.max(1, Math.round(delayMinutes)), String(title), String(body));
      } catch (e) {
        console.error('[Platform] scheduleReminder failed', e);
      }
      return;
    }
    console.info('[Platform mock] scheduleReminder', delayMinutes, title, body);
  },

  cancelReminder() {
    if (native) {
      try {
        native.cancelReminder();
      } catch {
        /* ignore */
      }
      return;
    }
    console.info('[Platform mock] cancelReminder');
  },

  exitApp() {
    if (native) {
      try {
        native.exitApp();
      } catch {
        /* ignore */
      }
      return;
    }
    console.info('[Platform mock] exitApp');
  },

  /** Test/debug helper: inject a platform event as if it came from native. */
  _simulate(evt) {
    dispatch(evt);
  },
};
