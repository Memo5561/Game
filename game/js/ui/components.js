// Reusable UI components of the design system (markup builders + small DOM behaviours).
// Styles live in css/style.css under the same class names.
//
//   btn({ action, label, icon, variant, size })   chunky 3D button (primary|secondary|ad|ghost|danger)
//   iconBtn({ action, icon, aria, badge })         round icon button
//   coinPill()                                    coin balance pill (updated by App.refreshCoins)
//   bar(cls) / setBar(el, ratio)                  progress bar
//   starsRow(count, of)                           star rating icons
//   switchBtn({ action, on, label, icon })         settings toggle row
//   flyCoins(from, to, count)                     coins flying to a pill (effects layer #fx)
//
// Every interactive element carries data-action="<screen|modal>.<action>"; App dispatches clicks.

import { icon } from './icons.js';
import { esc } from './dom.js';
import { t } from './i18n.js';
import { animate, dur } from './anim.js';

/**
 * Chunky button.
 * @param {Object} o
 * @param {string} o.action data-action
 * @param {string} [o.label] already translated text (escaped here)
 * @param {string} [o.labelKey] i18n key (kept in sync on language change via data-i18n)
 * @param {Object} [o.params] params for labelKey
 * @param {string} [o.icon] icon name
 * @param {'primary'|'secondary'|'ad'|'ghost'|'danger'} [o.variant]
 * @param {'md'|'lg'|'xl'|'sm'} [o.size]
 * @param {string} [o.cls] extra classes
 * @param {string} [o.attrs] extra raw attributes
 * @returns {string}
 */
export function btn({ action, label, labelKey, params, icon: ic, variant = 'primary', size = 'md', cls = '', attrs = '' }) {
  const text = labelKey
    ? `<span class="btn__label" data-i18n="${labelKey}"${params ? ` data-i18n-params='${esc(JSON.stringify(params))}'` : ''}>${esc(t(labelKey, params))}</span>`
    : `<span class="btn__label">${esc(label ?? '')}</span>`;
  return `<button type="button" class="btn btn--${variant} btn--${size}${cls ? ` ${cls}` : ''}" data-action="${action}" ${attrs}>${ic ? icon(ic, 'btn__icon') : ''}${text}</button>`;
}

/**
 * Round icon button.
 * @param {{ action: string, icon: string, aria: string, badge?: boolean, cls?: string }} o aria = i18n key
 */
export function iconBtn({ action, icon: ic, aria, badge = false, cls = '' }) {
  return `<button type="button" class="icon-btn${cls ? ` ${cls}` : ''}" data-action="${action}" data-i18n-aria="${aria}" aria-label="${esc(t(aria))}">${icon(ic)}${badge ? '<span class="icon-btn__badge" hidden></span>' : ''}</button>`;
}

/**
 * Coin balance pill (App.refreshCoins keeps every [data-coins] up to date).
 * @param {string|null} [action] tap action (default: open the shop); null = display only
 */
export function coinPill(action = 'nav.shop') {
  const inner = `${icon('coin', 'coin-pill__coin')}<span class="coin-pill__value" data-coins>0</span>`;
  if (!action) return `<div class="coin-pill coin-pill--static" data-coin-pill>${inner}</div>`;
  return `<button type="button" class="coin-pill" data-action="${action}" data-coin-pill data-i18n-aria="nav.shop" aria-label="${esc(t('nav.shop'))}">
    ${inner}${icon('plus', 'coin-pill__plus')}</button>`;
}

/** Progress bar markup; fill with setBar(). */
export function bar(cls = '', attrs = '') {
  return `<div class="bar${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}><div class="bar__fill"></div></div>`;
}

/**
 * Animates a bar's fill from one ratio to another (transform only).
 * @returns {Promise<void>}
 */
export function animateBar(barEl, from, to, ms = 600, delay = 0) {
  const fill = barEl && barEl.firstElementChild;
  if (!fill) return Promise.resolve();
  const a = Math.max(0, Math.min(1, from || 0));
  const b = Math.max(0, Math.min(1, to || 0));
  fill.style.transform = `scaleX(${b})`;
  return animate(fill, [{ transform: `scaleX(${a})` }, { transform: `scaleX(${b})` }], { duration: ms, delay, fill: 'backwards' });
}

/**
 * Sets a bar's fill (transform only).
 * @param {Element} barEl `.bar` element
 * @param {number} ratio 0..1
 */
export function setBar(barEl, ratio) {
  const fill = barEl && barEl.firstElementChild;
  if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio || 0))})`;
}

/**
 * Star rating (lit stars get .is-on).
 * @param {number} count lit stars
 * @param {number} [of]
 * @param {string} [cls]
 * @param {string} [attrs] extra raw attributes
 */
export function starsRow(count, of = 3, cls = '', attrs = '') {
  let out = '';
  for (let i = 0; i < of; i++) out += `<span class="star${i < count ? ' is-on' : ''}">${icon('star-empty', 'star__bg')}${icon('star', 'star__fg')}</span>`;
  return `<span class="stars${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${out}</span>`;
}

/**
 * Settings toggle row (role=switch).
 * @param {{ action: string, on: boolean, labelKey: string, icon: string }} o
 */
export function switchRow({ action, on, labelKey, icon: ic }) {
  return `<button type="button" class="row row--switch" role="switch" aria-checked="${on}" data-action="${action}">
    ${icon(ic, 'row__icon')}<span class="row__label" data-i18n="${labelKey}">${esc(t(labelKey))}</span>
    <span class="switch" aria-hidden="true"><span class="switch__knob"></span></span></button>`;
}

/** Updates a toggle rendered by switchRow. */
export function setSwitch(el, on) {
  if (el) el.setAttribute('aria-checked', String(!!on));
}

/**
 * Coins fly from `from` to `to` (both elements or DOMRects) on the #fx layer.
 * @param {Element|DOMRect} from
 * @param {Element|DOMRect} to
 * @param {number} [count] coin sprites (≤ 10)
 * @returns {Promise<void>} resolves when the first coin arrives (the caller then counts up)
 */
export function flyCoins(from, to, count = 8) {
  const layer = document.getElementById('fx');
  const a = rectOf(from);
  const b = rectOf(to);
  if (!layer || !a || !b || dur(1) === 0) return Promise.resolve();
  const n = Math.max(1, Math.min(10, count));
  const sx = a.left + a.width / 2;
  const sy = a.top + a.height / 2;
  const tx = b.left + b.width / 2;
  const ty = b.top + b.height / 2;
  let first = null;
  for (let i = 0; i < n; i++) {
    const coin = document.createElement('div');
    coin.className = 'fx-coin';
    coin.innerHTML = icon('coin');
    layer.appendChild(coin);
    const ang = (i / n) * Math.PI * 2;
    const spread = 26 + (i % 3) * 10;
    const mx = sx + Math.cos(ang) * spread;
    const my = sy + Math.sin(ang) * spread;
    const p = animate(coin, [
      { transform: `translate(${sx}px, ${sy}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${tx}px, ${ty}px) scale(0.7)`, opacity: 1 },
    ], { duration: 720, delay: i * 45, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'both' }).then(() => coin.remove());
    if (!first) first = p;
  }
  return first;
}

function rectOf(x) {
  if (!x) return null;
  if (typeof x.getBoundingClientRect === 'function') {
    const r = x.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  return x;
}

/**
 * Header of a secondary screen: back button, title, optional right-hand content.
 * @param {string} titleKey i18n key
 * @param {{ right?: string }} [opts] markup for the right side (e.g. coinPill())
 */
export function screenHeader(titleKey, { right = '' } = {}) {
  return `<header class="screen-header">
    ${iconBtn({ action: 'nav.back', icon: 'back', aria: 'common.back', cls: 'screen-header__back' })}
    <h1 class="screen-header__title" data-i18n="${titleKey}">${esc(t(titleKey))}</h1>
    <div class="screen-header__right">${right}</div>
  </header>`;
}
