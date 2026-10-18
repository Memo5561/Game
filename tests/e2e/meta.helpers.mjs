// Shared helpers of the meta-layer e2e specs (meta-*.spec.mjs). Not a spec itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ev, state, idle, tap, makeSave, veteranSave, todayKey, deepMerge } from './ui.helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOT_DIR_B = path.join(ROOT, 'tools', 'out', 'ui-b');

/** Screenshot to tools/out/ui-b/<name>.png */
export async function shotB(page, name) {
  fs.mkdirSync(SHOT_DIR_B, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR_B, `${name}.png`) });
}

/** Local day key `n` days from today. */
export function dayOffset(n) {
  const d = new Date();
  return todayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
}

/** Moves the game clock to local noon `n` days from today (triggers the day rollover). */
export async function goToDay(page, n) {
  const d = new Date();
  const ms = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime();
  await ev(page, (x) => window.__blocko.setNow(x), ms);
  await idle(page);
}

/** A returning player whose daily reward is still unclaimed today (the popup opens at home). */
export function unclaimedSave(patch = {}) {
  return veteranSave(deepMerge({ daily: { lastClaimDay: null, day: 0, streak: 0 } }, patch));
}

/** Tutorial done, nothing played yet (every feature locked). */
export function freshSave(patch = {}) {
  return makeSave(deepMerge({ flags: { tutorialDone: true } }, patch));
}

/**
 * Wraps Platform methods so calls are recorded in window.__calls[name] (args arrays). With
 * `results[name] = { value }` the wrapped method returns `value`, with `{ resolve }` a Promise of
 * it, instead of calling the original.
 * @param {import('playwright').Page} page
 * @param {string[]} names
 * @param {Record<string, any>} [results]
 */
export function recordPlatform(page, names, results = {}) {
  return page.evaluate(({ list, res }) => {
    const P = window.__blocko.platform;
    window.__calls = window.__calls || {};
    for (const name of list) {
      const orig = P[`__orig_${name}`] || P[name];
      P[`__orig_${name}`] = orig;
      window.__calls[name] = [];
      P[name] = (...args) => {
        window.__calls[name].push(args);
        const r = res[name];
        if (r && Object.prototype.hasOwnProperty.call(r, 'resolve')) return Promise.resolve(r.resolve);
        if (r && Object.prototype.hasOwnProperty.call(r, 'value')) return r.value;
        return orig.apply(P, args);
      };
    }
  }, { list: names, res: results });
}

/** Recorded Platform calls (see recordPlatform). */
export function calls(page, name) {
  return page.evaluate((n) => (window.__calls && window.__calls[n] ? window.__calls[n] : []), name);
}

/** Top modal id (or null). */
export async function topModal(page) {
  const s = await state(page);
  return s.modals.length ? s.modals[s.modals.length - 1] : null;
}

/** Text of the first element matching `sel` (or null). */
export function text(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  }, sel);
}

/** Presses the (mock) Android back button. */
export async function back(page) {
  await page.keyboard.press('Escape');
  await idle(page);
}

export { todayKey };

/** Scrolls a data-action element of the active screen / top modal into view, then taps it. */
export async function tapIn(page, action) {
  const sel = `.screen.is-active [data-action="${action}"], .modal:not(.is-closing):not(.is-covered) [data-action="${action}"]`;
  await page.waitForSelector(sel, { state: 'attached', timeout: 10000 });
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await page.waitForTimeout(30);
  await tap(page, action);
}
