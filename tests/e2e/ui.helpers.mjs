// Shared helpers of the UI/app e2e specs (smoke, ftue, gameplay, revive, persistence, back,
// journey, lifecycle, iap, landscape, i18n). Not a spec itself (run.mjs only runs *.spec.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchGame, waitForDebug, VIEWPORTS, assert } from './harness.mjs';
import { defaultSave } from '../../game/js/meta/storage.js';

export { VIEWPORTS, assert };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOT_DIR = path.join(ROOT, 'tools', 'out', 'ui');

/**
 * A SaveData object (defaults deep-merged with `patch`).
 * @param {Object} [patch]
 */
export function makeSave(patch = {}) {
  return deepMerge(defaultSave(), patch);
}

/** Local day key 'YYYY-MM-DD' (same as the game's dayKey; browser and node share the TZ). */
export function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * A returning player: tutorial done, a few games, some coins. Today's login reward is already
 * claimed, so no daily-reward popup covers home (meta specs reset `daily` to test it).
 */
export function veteranSave(patch = {}) {
  return makeSave(deepMerge({
    flags: { tutorialDone: true },
    stats: { gamesPlayed: 4, classicGames: 4, bestScore: 1500, playSec: 300 },
    coins: 600,
    xp: 150,
    daily: { lastClaimDay: todayKey(), day: 1, streak: 1 },
  }, patch));
}

/**
 * Opens the game and waits for the debug API.
 * @param {{ viewport?: Object, save?: Object|null, query?: string, locale?: string, timeScale?: number }} [o]
 */
export async function openGame({ viewport = VIEWPORTS.phone, save = null, query = 'debug=1&mock=fast', locale = 'en-US', timeScale = 20 } = {}) {
  const g = await launchGame({ viewport, storage: save, query, locale });
  g.consoleLog = [];
  g.page.on('console', (msg) => g.consoleLog.push(`${msg.type()}: ${msg.text()}`));
  await waitForDebug(g.page, 15000);
  await g.page.waitForFunction(() => window.__blockoBooted === true);
  if (timeScale !== null) await ev(g.page, (x) => window.__blocko.setTimeScale(x), timeScale);
  return g;
}

/** page.evaluate shortcut. */
export function ev(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/** window.__blocko.state() */
export function state(page) {
  return page.evaluate(() => window.__blocko.state());
}

/** A copy of the save. */
export function save(page, patch) {
  return page.evaluate((p) => window.__blocko.save(p), patch || null);
}

/** Waits until window.__blocko.idle() resolved. */
export function idle(page) {
  return page.evaluate(() => window.__blocko.idle());
}

/** Waits until a predicate over state() holds. */
export async function waitState(page, predicateSrc, timeout = 10000) {
  await page.waitForFunction(`(() => { const s = window.__blocko.state(); return (${predicateSrc})(s); })()`, null, { timeout });
  return state(page);
}

/** Waits until modal `id` is the top modal and fully visible. */
export async function waitModal(page, id, timeout = 10000) {
  await page.waitForFunction((m) => {
    const top = window.__blocko.app.modals.top();
    return top && top.id === m && top.shownAt > 0;
  }, id, { timeout });
}

/**
 * Real pointer tap on the centre of a visible data-action button (not inside a closing/covered
 * modal). Uses mouse coordinates because attention animations (breathing Play) never settle.
 */
export async function tap(page, action) {
  const sel = `.screen.is-active [data-action="${action}"], .modal:not(.is-closing):not(.is-covered) [data-action="${action}"]`;
  const el = await page.waitForSelector(sel, { state: 'visible', timeout: 10000 });
  const box = await el.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Real mouse drag in small steps. */
export async function mouseDrag(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
    if (k % 4 === 0) await page.waitForTimeout(16);
  }
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/** Places `n` pieces with the greedy bot (stops early when the run ends). */
export async function playMoves(page, n) {
  for (let i = 0; i < n; i++) {
    const s = await state(page);
    if (!s.session || s.session.status !== 'playing') return i;
    const moves = await ev(page, () => window.__blocko.validMoves());
    if (!moves.length) return i;
    moves.sort((a, b) => b.lines - a.lines || b.cells - a.cells);
    await ev(page, (m) => window.__blocko.place(m.trayIndex, m.r, m.c), moves[0]);
  }
  return n;
}

/** Screenshot to tools/out/ui/<name>.png */
export async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Words that wrap inside themselves (no hyphen / soft hyphen at the break) on the visible screen +
 * top modal – measured per word with Range rects, so a sub-pixel overflow ("Booster|s") is caught
 * that the integer scrollWidth check rounds away.
 * @returns {Promise<string[]>}
 */
export function brokenWords(page) {
  return page.evaluate(() => {
    const out = [];
    for (const root of document.querySelectorAll('.screen.is-active, .modal:not(.is-closing):not(.is-covered), #toasts')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[aria-hidden="true"]') || !el.getClientRects().length) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        for (const m of n.textContent.matchAll(/[^ \t\n\r]+/g)) {
          if (/[\u00AD\-‐–—/]/.test(m[0])) continue;
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const lines = new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top)));
          if (lines.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  });
}

/**
 * Layout problems on the visible screen + top modal: elements wider than the viewport, text that
 * does not fit its box and words that wrap inside themselves. Word wrapping inside words is
 * disabled during the box check, so a label that only fits by breaking a word counts as overflowing.
 * @returns {Promise<string[]>}
 */
export async function layoutProblems(page) {
  const broken = (await brokenWords(page)).map((w) => `word broken across lines: "${w}"`);
  return [...(await boxProblems(page)), ...broken];
}

function boxProblems(page) {
  return page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '* { overflow-wrap: normal !important; word-break: normal !important; }';
    document.head.appendChild(style);
    const problems = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    const roots = [...document.querySelectorAll('.screen.is-active, .modal:not(.is-closing):not(.is-covered), #toasts')];
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        if (!(el instanceof HTMLElement) || el.closest('[aria-hidden="true"]')) continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const label = `${el.className || el.tagName} "${el.textContent.trim().slice(0, 40)}"`;
        if (r.right > vw + 1 || r.left < -1) problems.push(`outside viewport: ${label} (${Math.round(r.left)}–${Math.round(r.right)})`);
        if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) problems.push(`text overflow: ${label} (${el.scrollWidth} > ${el.clientWidth})`);
      }
    }
    style.remove();
    return problems;
  });
}

/** Installs a recorder of mock ad overlays (window.__adLog) – call once per page load. */
export function recordAds(page) {
  return page.evaluate(() => {
    window.__adLog = [];
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.hasAttribute('data-mock-ad')) window.__adLog.push(n.getAttribute('data-mock-ad'));
        }
      }
    }).observe(document.body, { childList: true });
  });
}

export function adLog(page) {
  return page.evaluate(() => window.__adLog.slice());
}

/** Fails with all collected page errors (console.error, pageerror, failed requests). */
export function assertNoErrors(g, where = '') {
  assert(g.errors.length === 0, `${where} page errors:\n${g.errors.join('\n')}`);
}

export function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], v);
    } else {
      target[key] = v;
    }
  }
  return target;
}
