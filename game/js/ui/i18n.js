// Translations (docs/ARCHITECTURE.md §2 rules, §4.15 i18n keys).
//
// - Supported languages: en, de, es, fr, it, pt, tr, ru. Every key falls back to English when a
//   language lacks it (languages without a string table yet use English entirely).
// - Setting 'auto' resolves from the device language (navigator.language / Platform.info.locale).
// - Values are strings with `{name}` placeholders, or plural objects `{ one, other, few?, many? }`
//   selected with Intl.PluralRules(lang) by the `n` param: en/de/es/fr/it/pt/tr use one + other, ru
//   needs one (1, 21 …) / few (2–4, 22–24 …) / many (0, 5–20 …) / other (fractions; repeats many).
//   A language may use a plural object for a key whose English string is plain (the noun after `{n}`
//   needs agreement there); every form must carry the same placeholders.
// - Numeric params are formatted for the language (1,500 / 1.500).
// - DOM: elements with `data-i18n="key"` get their textContent from translateDom(); optional
//   `data-i18n-params='{"n":3}'`; `data-i18n-aria="key"` sets aria-label.
// - Debug mode (setDebug(true)): a key missing from the current table (or from English) logs one
//   console.warn and is recorded in missingKeys() – the i18n e2e test asserts none.
//
// Adding a language: create strings/<code>.js (same keys as en.js), import it below and add it to
// TABLES. Adding keys: add them to en.js AND de.js (other tables are filled by the translator).

import en from './strings/en.js';
import de from './strings/de.js';
import es from './strings/es.js';
import fr from './strings/fr.js';
import it from './strings/it.js';
import pt from './strings/pt.js';
import tr from './strings/tr.js';
import ru from './strings/ru.js';

/** Supported language codes (settings order). */
export const LANGS = Object.freeze(['en', 'de', 'es', 'fr', 'it', 'pt', 'tr', 'ru']);

/** Language names in their own language (language picker). */
export const LANG_NAMES = Object.freeze({
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', pt: 'Português', tr: 'Türkçe', ru: 'Русский',
});

/** @type {Readonly<Record<string, Record<string, any>>>} */
const TABLES = Object.freeze({ en, de, es, fr, it, pt, tr, ru });

let lang = 'en';
let debug = false;
let numberFormat = null;
let pluralRules = null;
const missing = new Set();

/**
 * Resolves a setting ('auto' or a code) to a supported language.
 * @param {string} setting
 * @param {string} [deviceLang] e.g. 'de-DE'
 * @returns {string}
 */
export function resolveLang(setting, deviceLang) {
  if (setting && setting !== 'auto' && LANGS.includes(setting)) return setting;
  const raw = String(deviceLang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en').toLowerCase();
  const base = raw.split(/[-_]/)[0];
  return LANGS.includes(base) ? base : 'en';
}

/**
 * Switches the active language.
 * @param {string} code supported code (anything else → 'en')
 * @returns {string} the active code
 */
export function setLang(code) {
  lang = LANGS.includes(code) ? code : 'en';
  numberFormat = null;
  pluralRules = null;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

/** @returns {string} active language code */
export function getLang() {
  return lang;
}

/** Missing-key warnings on/off (debug builds). */
export function setDebug(on) {
  debug = !!on;
}

/** @returns {string[]} keys that were looked up but missing (debug mode only) */
export function missingKeys() {
  return [...missing];
}

/**
 * Translates `key`.
 * @param {string} key
 * @param {Record<string, string|number>} [params] `{name}` substitutions; `n` selects plurals
 * @returns {string}
 */
export function t(key, params) {
  const table = TABLES[lang];
  let value = table ? table[key] : undefined;
  if (value === undefined) {
    if (debug && table && !missing.has(`${lang}:${key}`)) {
      missing.add(`${lang}:${key}`);
      console.warn(`[i18n] missing key "${key}" for "${lang}"`);
    }
    value = en[key];
  }
  if (value === undefined) {
    if (debug && !missing.has(`en:${key}`)) {
      missing.add(`en:${key}`);
      console.warn(`[i18n] missing key "${key}"`);
    }
    return key;
  }
  if (typeof value === 'object') value = pluralForm(value, params && params.n);
  return params ? interpolate(value, params) : value;
}

/**
 * Upper-cases for display in the active language. Use this instead of String#toUpperCase for text
 * that comes from translations or Intl (Turkish: i → İ, ı → I; CSS `text-transform` already follows
 * `<html lang>` and needs nothing).
 * @param {string} text
 * @returns {string}
 */
export function upper(text) {
  try {
    return String(text).toLocaleUpperCase(lang);
  } catch {
    return String(text).toUpperCase();
  }
}

/** Formats a number for the active language (grouping separators). */
export function formatNumber(n) {
  if (!numberFormat) {
    try {
      numberFormat = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
    } catch {
      numberFormat = { format: (x) => String(Math.round(x)) };
    }
  }
  return numberFormat.format(Number(n) || 0);
}

/**
 * Short localized date of a day key ('2026-10-18' → 'Oct 18' / '18. Okt.').
 * @param {string} dayKey
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
export function formatDay(dayKey, opts = { day: 'numeric', month: 'short' }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
  if (!m) return String(dayKey);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return new Intl.DateTimeFormat(lang, opts).format(d);
  } catch {
    return dayKey;
  }
}

/**
 * Applies translations to `[data-i18n]` / `[data-i18n-aria]` elements below `root`.
 * @param {ParentNode} root
 */
export function translateDom(root) {
  if (!root || !root.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const text = t(el.getAttribute('data-i18n'), readParams(el));
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'), readParams(el)));
  }
}

function readParams(el) {
  const raw = el.getAttribute('data-i18n-params');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function pluralForm(entry, n) {
  if (!pluralRules) {
    try {
      pluralRules = new Intl.PluralRules(lang);
    } catch {
      pluralRules = { select: (x) => (x === 1 ? 'one' : 'other') };
    }
  }
  const cat = Number.isFinite(Number(n)) ? pluralRules.select(Number(n)) : 'other';
  return entry[cat] ?? entry.other ?? entry.one ?? '';
}

function interpolate(str, params) {
  return str.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    const v = params[name];
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}
