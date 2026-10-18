// Shop screen – PLACEHOLDER of part A (minimal, functional): the in-app products from
// Platform.getProducts() (missing products are hidden). Part B replaces this file with the full
// shop (themes, boosters, free coins, remove-ads tile with gift …).

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { screenHeader, coinPill } from '../components.js';

const ORDER = ['remove_ads', 'coins_small', 'coins_large'];

let listEl = null;
let products = [];

export const shopScreen = {
  id: 'shop',

  build(app) {
    const el = fromHtml(`<section class="screen--shop">
      ${screenHeader('shop.title', { right: coinPill() })}
      <div class="screen-body"><div class="shop-list" data-ref="list"></div></div>
    </section>`);
    listEl = el.querySelector('[data-ref="list"]');
    app.action('shop.buy.*', async (btn, id) => {
      btn.disabled = true;
      await app.purchase(id);
      btn.disabled = false;
      render(app);
    });
    return el;
  },

  enter(params, app) {
    app.refreshCoins({ instant: true });
    render(app);
    Platform.getProducts().then((list) => {
      products = Array.isArray(list) ? list : [];
      render(app);
    });
  },

  refresh(reason, app) {
    render(app);
  },
};

function render(app) {
  const byId = new Map(products.map((p) => [p.id, p]));
  let html = '';
  for (const id of ORDER) {
    const p = byId.get(id);
    if (!p) continue;
    if (id === 'remove_ads') {
      const owned = app.save.iap.adsRemoved;
      const gift = CONFIG.ECONOMY.REMOVE_ADS_GIFT;
      html += `<div class="shop-tile shop-tile--noads">
          <span class="shop-tile__icon">${icon('noads')}</span>
          <span class="shop-tile__text">
            <span class="shop-tile__title">${esc(t('shop.product.remove_ads'))}</span>
            <span class="shop-tile__desc">${esc(t('shop.removeAds.desc'))}</span>
            <span class="shop-tile__gift">${icon('gift')}${esc(t('shop.removeAds.gift', { n: gift.coins }))}</span>
          </span>
          ${owned
    ? `<span class="shop-tile__owned">${icon('check')}${esc(t('shop.owned'))}</span>`
    : `<button type="button" class="btn btn--primary btn--sm" data-action="shop.buy.${id}"><span class="btn__label">${esc(p.price)}</span></button>`}
        </div>`;
    } else {
      const coins = CONFIG.PRODUCTS[id].coins;
      html += `<div class="shop-tile">
          ${id === 'coins_large' ? `<span class="badge badge--best">${esc(t('shop.bestValue'))}</span>` : ''}
          <span class="shop-tile__icon shop-tile__icon--coins">${icon('coin')}</span>
          <span class="shop-tile__text">
            <span class="shop-tile__title">${esc(t(`shop.product.${id}`))}</span>
            <span class="shop-tile__amount">${icon('coin')}${esc(formatNumber(coins))}</span>
          </span>
          <button type="button" class="btn btn--primary btn--sm" data-action="shop.buy.${id}"><span class="btn__label">${esc(p.price)}</span></button>
        </div>`;
    }
  }
  listEl.innerHTML = html || `<p class="screen-note">${esc(t('shop.unavailable'))}</p>`;
}
