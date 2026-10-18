// Tiny DOM helpers (no framework). Markup is built with template strings; every dynamic text
// that does not come from our own string tables goes through esc().

/** @returns {Element|null} */
export const $ = (sel, root = document) => root.querySelector(sel);

/** @returns {Element[]} */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes a value for text or attribute positions. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

/**
 * Creates an element from markup (first element of the string).
 * @param {string} markup
 * @returns {HTMLElement}
 */
export function fromHtml(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return /** @type {HTMLElement} */ (tpl.content.firstElementChild);
}

/** Sets textContent only when it changed (no needless style invalidation). */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Toggles a class only when needed. */
export function toggleClass(el, cls, on) {
  if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}

/** JSON for a data-i18n-params attribute. */
export function i18nParams(params) {
  return esc(JSON.stringify(params));
}
