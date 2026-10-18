// Tiny DOM helpers (no framework). Markup is built with template strings; every dynamic text
// that does not come from our own string tables goes through esc().

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

/**
 * Shrinks the font of a single-line number (`white-space: nowrap`) until `text` fits the element's
 * box; restores the CSS size when it fits. Layout is read only for long texts (≥ 7 characters,
 * i.e. scores from 100,000), so normal play never forces a reflow.
 * @param {HTMLElement|null} el
 * @param {string} text the text that will be shown
 */
export function fitText(el, text) {
  if (!el) return;
  if (el.style.fontSize) el.style.fontSize = '';
  if (String(text).length < 7) return;
  const prev = el.textContent;
  el.textContent = text;
  const need = el.scrollWidth;
  const have = el.clientWidth;
  if (have > 0 && need > have) {
    const base = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.style.fontSize = `${Math.floor((base * have * 100) / need) / 100 - 0.5}px`;
  }
  el.textContent = prev;
}

/** Sets textContent only when it changed (no needless style invalidation). */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Toggles a class only when needed. */
export function toggleClass(el, cls, on) {
  if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}
