// Shop (§4.15 "Shop"), three tabs:
//   Coins    – "No ads" tile (gift: +coins, +1 hammer, +1 shuffle; owned → "Ad-free ✓"), a free
//              coins video (FREE_COINS_ADS_PER_DAY), the coin packs ("Best value" on the large
//              one) and "Restore purchases".
//   Themes   – a card per block theme with a live preview: Selected / Select / price (coins; short
//              → "Need n more") / "Level n" lock. Buying asks for confirmation, then applies.
//   Boosters – hammer and shuffle: count, buy with coins, a free one for a video.
// Product names come from i18n (shop.product.<id>), prices ONLY from Platform.getProducts();
// products missing there are hidden. Purchase buttons show a pending state while Google Play is
// open; results: success → the grant / entitlement toast comes from the App, pending → info
// sheet, cancelled → silent, already_owned → "Previous purchase delivered", error → toast.
// Rewarded buttons are only offered while a video is ready. Neutral wording throughout.
// params: { tab?: 'coins'|'themes'|'boosters', highlight?: 'remove_ads' }

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { Sfx } from '../../audio/sfx.js';
import { THEME_IDS, getTheme, renderThemePreview } from '../../render/theme.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { screenHeader, coinPill, btn, tabBar, setTab } from '../components.js';
import { shake, pop } from '../anim.js';

const TABS = [
  { id: 'coins', labelKey: 'shop.tab.coins', icon: 'coin' },
  { id: 'themes', labelKey: 'shop.tab.themes', icon: 'palette' },
  { id: 'boosters', labelKey: 'shop.tab.boosters', icon: 'hammer' },
];
const BOOSTERS = ['hammer', 'shuffle'];
const PACKS = ['coins_small', 'coins_large'];
const PACK_ICON = { coins_small: 'bag', coins_large: 'chest-open' };

let el = null;
let body = null;
let tab = 'coins';
let highlight = '';
/** @type {Array<{id: string, title: string, price: string}>|null} null while loading */
let products = null;
/** product id whose Google Play flow is open */
let pending = '';

export const shopScreen = {
  id: 'shop',

  build(app) {
    el = fromHtml(`<section class="screen--shop">
      ${screenHeader('shop.title', { right: coinPill('shop.tab.coins') })}
      <div class="shop-tabs">${tabBar('shop.tab', TABS, tab)}</div>
      <div class="screen-body shop-body" data-ref="body"></div>
    </section>`);
    body = el.querySelector('[data-ref="body"]');

    app.action('shop.tab.*', (b, id) => {
      if (!TABS.some((x) => x.id === id) || id === tab) return;
      tab = id;
      highlight = '';
      body.scrollTop = 0;
      render(app);
    });
    app.action('shop.buy.*', (b, id) => buyProduct(app, id));
    app.action('shop.restore', async (b) => {
      if (b.disabled) return;
      b.disabled = true;
      await app.restorePurchases();
      b.disabled = false;
      render(app);
    });
    app.action('shop.freeCoins', (b) => freeCoins(app, b));
    app.action('shop.theme.buy.*', (b, id) => buyTheme(app, id, b));
    app.action('shop.theme.select.*', (b, id) => selectTheme(app, id));
    app.action('shop.theme.locked.*', (b, id) => {
      shake(b);
      app.toast(t('shop.theme.lockedToast', { n: CONFIG.ECONOMY.THEMES[id].unlockLevel }), { icon: 'lock' });
    });
    app.action('shop.booster.buy.*', (b, type) => buyBooster(app, type, b));
    app.action('shop.booster.watch.*', (b, type) => watchBooster(app, type, b));
    app.on('adState', () => {
      if (app.router.current === 'shop' && tab !== 'themes') render(app);
    });
    app.on('entitlements', () => {
      if (app.router.current === 'shop') render(app);
    });
    return el;
  },

  enter(params, app) {
    tab = TABS.some((x) => x.id === params.tab) ? params.tab : 'coins';
    highlight = params.highlight || '';
    body.scrollTop = 0;
    app.refreshCoins({ instant: true });
    render(app);
    loadProducts(app);
  },

  refresh(reason, app) {
    if (app.router.current !== 'shop') return;
    render(app);
  },
};

function loadProducts(app) {
  Platform.getProducts().then((list) => {
    products = Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string') : [];
    if (app.router.current === 'shop') render(app);
  }, () => {
    products = [];
  });
}

function product(id) {
  return products ? products.find((p) => p.id === id) || null : null;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function render(app) {
  setTab(el, tab);
  if (tab === 'coins') body.innerHTML = coinsTab(app);
  else if (tab === 'themes') body.innerHTML = themesTab(app);
  else body.innerHTML = boostersTab(app);
  body.setAttribute('data-tab', tab);
  if (tab === 'themes') {
    requestAnimationFrame(() => {
      for (const c of body.querySelectorAll('canvas[data-theme]')) renderThemePreview(c, getTheme(c.getAttribute('data-theme')));
    });
  }
  if (highlight) {
    const target = body.querySelector(`[data-product="${highlight}"]`);
    if (target) {
      target.classList.add('is-highlight');
      requestAnimationFrame(() => pop(target, 1.04));
    }
  }
}

/** Price button of an in-app product (pending state while Google Play is open). */
function priceButton(id, price, variant = 'primary') {
  const busy = pending === id;
  return `<button type="button" class="btn btn--${variant} btn--sm shop__price${busy ? ' is-pending' : ''}" data-action="shop.buy.${id}"${pending ? ' disabled' : ''}>
      ${busy ? '<span class="spinner" aria-hidden="true"></span>' : ''}<span class="btn__label">${esc(price)}</span></button>`;
}

function coinsTab(app) {
  const save = app.save;
  const owned = save.iap.adsRemoved;
  const parts = [];
  // --- remove ads (an owned one moves to the bottom as a status card) -------------------------
  const noAds = product('remove_ads');
  const gift = CONFIG.ECONOMY.REMOVE_ADS_GIFT;
  const noAdsCard = `<div class="shop-card shop-card--noads${owned ? ' is-owned' : ''}" data-product="remove_ads">
      <span class="shop-card__icon">${icon('noads')}</span>
      <span class="shop-card__text">
        <span class="shop-card__title">${esc(t('shop.product.remove_ads'))}</span>
        <span class="shop-card__desc">${esc(t('shop.removeAds.desc'))}</span>
        ${owned ? '' : `<span class="shop-gift" role="img" aria-label="${esc(t('shop.removeAds.giftLine', { coins: gift.coins, hammer: gift.hammer, shuffle: gift.shuffle }))}">
          ${icon('gift', 'shop-gift__icon')}<span class="shop-gift__label">${esc(t('shop.removeAds.giftLabel'))}</span>
          <span class="shop-gift__item">${icon('coin')}+${esc(formatNumber(gift.coins))}</span>
          <span class="shop-gift__item">${icon('hammer')}+${esc(formatNumber(gift.hammer))}</span>
          <span class="shop-gift__item">${icon('shuffle')}+${esc(formatNumber(gift.shuffle))}</span></span>`}
      </span>
      <span class="shop-card__action">${owned
    ? `<span class="shop-tile__owned">${icon('check')}<span>${esc(t('shop.adFree'))}</span></span>`
    : noAds ? priceButton('remove_ads', noAds.price) : ''}</span>
    </div>`;
  if (!owned && noAds) parts.push(noAdsCard);
  // --- coin packs -------------------------------------------------------------------------------
  const packs = PACKS.filter((id) => product(id));
  if (packs.length) {
    parts.push(`<div class="pack-grid">${packs.map((id) => {
      const p = product(id);
      return `<div class="pack${id === 'coins_large' ? ' pack--best' : ''}" data-product="${id}">
          ${id === 'coins_large' ? `<span class="badge badge--best pack__badge">${esc(t('shop.bestValue'))}</span>` : ''}
          <span class="pack__icon">${icon(PACK_ICON[id])}</span>
          <span class="pack__amount">${icon('coin')}${esc(formatNumber(CONFIG.PRODUCTS[id].coins))}</span>
          <span class="pack__name">${esc(t(`shop.product.${id}`))}</span>
          ${priceButton(id, p.price, 'secondary')}
        </div>`;
    }).join('')}</div>`);
  }
  // --- free coins (video) -------------------------------------------------------------------
  const left = app.progression.freeCoinsLeft();
  const amount = CONFIG.ECONOMY.FREE_COINS_AD_AMOUNT;
  if (app.isRewardedAvailable() || left === 0) {
    parts.push(`<div class="shop-card shop-card--free">
        <span class="shop-card__icon shop-card__icon--coin">${icon('coin')}</span>
        <span class="shop-card__text">
          <span class="shop-card__title">${esc(t('shop.free.title'))}</span>
          <span class="shop-card__desc">${esc(left > 0 ? t('shop.free.left', { n: left }) : t('shop.free.none'))}</span>
        </span>
        ${left > 0 ? `<span class="shop-card__action">${btn({ action: 'shop.freeCoins', label: t('shop.freeCoins', { n: amount }), icon: 'ad', variant: 'ad', size: 'sm' })}</span>` : ''}
      </div>`);
  }
  if (owned) parts.push(noAdsCard);
  if (products && !products.length && !owned) parts.push(`<p class="screen-note">${esc(t('shop.unavailable'))}</p>`);
  if (!products) parts.push('<div class="shop-loading"><span class="spinner"></span></div>');
  parts.push(`<div class="shop-foot">
      <button type="button" class="link-btn" data-action="shop.restore">${esc(t('settings.restore'))}</button>
    </div>`);
  return parts.join('');
}

function themesTab(app) {
  const P = app.progression;
  const level = P.levelInfo().level;
  const coins = P.coins;
  const cards = THEME_IDS.map((id) => {
    const info = P.themeUnlockInfo(id);
    const selected = P.selectedTheme === id;
    let action;
    let state = '';
    if (selected) {
      state = 'is-selected';
      action = `<span class="theme-card__state">${icon('check')}<span>${esc(t('shop.theme.selected'))}</span></span>`;
    } else if (info.owned) {
      action = btn({ action: `shop.theme.select.${id}`, labelKey: 'shop.theme.select', variant: 'secondary', size: 'sm' });
    } else if (level < info.unlockLevel) {
      state = 'is-locked';
      action = `<button type="button" class="theme-card__lock" data-action="shop.theme.locked.${id}">${icon('lock')}<span>${esc(t('shop.theme.level', { n: info.unlockLevel }))}</span></button>`;
    } else {
      const short = coins < info.price;
      action = `${btn({ action: `shop.theme.buy.${id}`, label: formatNumber(info.price), icon: 'coin', size: 'sm', cls: short ? 'is-short' : '' })}
        ${short ? `<span class="theme-card__need">${esc(t('shop.theme.need', { n: info.price - coins }))}</span>` : ''}`;
    }
    return `<div class="theme-card ${state}" data-theme-card="${id}">
        <canvas class="theme-canvas theme-card__preview" data-theme="${id}"></canvas>
        <span class="theme-card__name">${esc(t(`theme.${id}`))}</span>
        <div class="theme-card__action">${action}</div>
      </div>`;
  }).join('');
  return `<div class="theme-grid">${cards}</div>`;
}

function boostersTab(app) {
  const P = app.progression;
  const canWatch = app.isRewardedAvailable() && app.freeBoostersLeft() > 0;
  const cards = BOOSTERS.map((type) => {
    const price = CONFIG.ECONOMY.BOOSTER_PRICES[type];
    const name = t(`booster.${type}`);
    return `<div class="booster-card" data-booster="${type}">
        <span class="booster-card__icon">${icon(type)}<span class="booster-card__count" data-ref="count">×${esc(formatNumber(P.boosterCount(type)))}</span></span>
        <span class="booster-card__text">
          <span class="booster-card__title">${esc(name)}</span>
          <span class="booster-card__desc">${esc(t(`booster.${type}.desc`))}</span>
        </span>
        <div class="booster-card__actions">
          ${btn({ action: `shop.booster.buy.${type}`, label: formatNumber(price), icon: 'coin', size: 'sm', cls: P.coins < price ? 'is-short' : '' })}
          ${canWatch ? btn({ action: `shop.booster.watch.${type}`, label: t('shop.booster.watch'), icon: 'ad', variant: 'ad', size: 'sm', attrs: `aria-label="${esc(t('booster.watch', { name }))}"` }) : ''}
        </div>
      </div>`;
  }).join('');
  return `<div class="booster-list">${cards}</div>
    <p class="shop-hint">${icon('info')}<span>${esc(t('shop.booster.hint'))}</span></p>`;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

async function buyProduct(app, id) {
  if (pending || !product(id)) return;
  if (id === 'remove_ads' && app.save.iap.adsRemoved) return;
  pending = id;
  render(app);
  let status = 'error';
  try {
    status = await app.purchase(id);
  } finally {
    pending = '';
  }
  if (app.router.current === 'shop') render(app);
  return status;
}

async function freeCoins(app, b) {
  if (b.disabled || app.progression.freeCoinsLeft() < 1) return;
  b.disabled = true;
  const ok = await app.showRewarded('free_coins');
  const coins = ok ? app.progression.grantFreeCoins() : 0;
  if (app.router.current !== 'shop') return;
  if (coins > 0) {
    Sfx.play('reward');
    const from = b.closest('.shop-card') || b;
    await app.flyCoins(from, coins);
  }
  render(app);
}

function buyTheme(app, id, b) {
  const P = app.progression;
  const info = P.themeUnlockInfo(id);
  if (info.owned) return;
  if (P.coins < info.price) {
    shake(b);
    app.toast(t('shop.theme.short', { n: info.price - P.coins }), { icon: 'coin' });
    return;
  }
  app.modals.open('confirm', {
    titleKey: 'shop.theme.confirmTitle',
    bodyKey: 'shop.theme.confirmBody',
    params: { name: t(`theme.${id}`), n: info.price },
    okKey: 'shop.theme.unlock',
    okIcon: 'palette',
    icon: 'palette',
    onConfirm: () => {
      if (!P.buyTheme(id)) {
        app.toast(t('toast.notEnoughCoins'), { icon: 'coin' });
        return;
      }
      P.selectTheme(id);
      app.applyTheme(id);
      app.refreshCoins();
      Sfx.play('unlock');
      app.haptic('success');
      app.toast(t('shop.theme.unlocked', { name: t(`theme.${id}`) }), { icon: 'palette', tone: 'good' });
      render(app);
      const card = body.querySelector(`[data-theme-card="${id}"]`);
      if (card) pop(card, 1.06);
    },
  });
}

function selectTheme(app, id) {
  if (!app.progression.selectTheme(id)) return;
  app.applyTheme(id);
  Sfx.play('click');
  app.toast(t('shop.theme.applied', { name: t(`theme.${id}`) }), { icon: 'palette', tone: 'good', ms: 1600 });
  render(app);
}

function buyBooster(app, type, b) {
  if (!app.progression.buyBooster(type)) {
    shake(b);
    app.toast(t('toast.notEnoughCoins'), { icon: 'coin' });
    return;
  }
  app.refreshCoins();
  Sfx.play('reward');
  app.toast(t('shop.booster.got', { name: t(`booster.${type}`) }), { icon: type, tone: 'good', ms: 1600 });
  render(app);
  bumpCount(type);
}

async function watchBooster(app, type, b) {
  if (b.disabled || app.freeBoostersLeft() < 1) return;
  b.disabled = true;
  const ok = await app.showRewarded('booster');
  if (ok) {
    app.grantFreeBooster(type);
    Sfx.play('reward');
    app.toast(t('shop.booster.got', { name: t(`booster.${type}`) }), { icon: type, tone: 'good', ms: 1600 });
  }
  if (app.router.current !== 'shop') return;
  render(app);
  if (ok) bumpCount(type);
}

function bumpCount(type) {
  const c = body.querySelector(`[data-booster="${type}"] [data-ref="count"]`);
  if (c) pop(c, 1.4);
}
