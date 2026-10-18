// Shared Playwright helpers for end-to-end tests and the store screenshot generator.
import { chromium } from 'playwright';
import { startServer } from '../../tools/serve.mjs';

// Sizes describe the WebView area ABOVE the native banner slot (~50-60 dp) and nav bar.
export const VIEWPORTS = {
  phone: { width: 360, height: 700, deviceScaleFactor: 3 },      // typical modern Android
  phoneSmall: { width: 320, height: 518, deviceScaleFactor: 2 }, // very small / old
  phoneTall: { width: 412, height: 830, deviceScaleFactor: 2.625 },
  tabletLandscape: { width: 1280, height: 800, deviceScaleFactor: 2 },
  tabletPortrait: { width: 800, height: 1280, deviceScaleFactor: 2 },
};

/**
 * Starts the static server + Chromium with mobile emulation and opens the game.
 * @returns {Promise<{page, browser, context, server, url, errors: string[], close: () => Promise<void>}>}
 */
export async function launchGame({
  viewport = VIEWPORTS.phone,
  query = 'debug=1&mock=fast',
  locale = 'en-US',
  storage = null, // optional SaveData object to pre-seed localStorage
  headless = true,
} = {}) {
  const server = await startServer(0);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: viewport.width < 900,
    hasTouch: true,
    locale,
  });
  if (storage) {
    await context.addInitScript((data) => {
      try { localStorage.setItem('blocko.save.v1', JSON.stringify(data)); } catch {}
    }, storage);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
  const url = `${server.url}index.html${query ? `?${query}` : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  return {
    page, browser, context, server, url, errors,
    async close() {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/** Waits until the debug API (window.__blocko) is available. */
export async function waitForDebug(page, timeout = 10000) {
  await page.waitForFunction(() => !!window.__blocko, null, { timeout });
}

/**
 * Plays moves through the debug API with a simple greedy bot (prefers moves that clear most lines).
 * Stops when the run is no longer 'playing' or after maxMoves.
 * @returns {Promise<{moves: number, status: string, score: number}>}
 */
export async function botPlay(page, { maxMoves = 200 } = {}) {
  let moves = 0;
  for (; moves < maxMoves; moves++) {
    const st = await page.evaluate(() => window.__blocko.state());
    if (!st.session || st.session.status !== 'playing') break;
    const move = await page.evaluate(() => {
      const moves = window.__blocko.validMoves();
      if (!moves.length) return null;
      let best = moves[0];
      let bestScore = -1;
      for (const m of moves) {
        const s = (m.lines || 0) * 100 + (m.cells || 0) - (m.r || 0) * 0; // greedy on lines, then size
        if (s > bestScore) { bestScore = s; best = m; }
      }
      return best;
    });
    if (!move) break;
    await page.evaluate((m) => window.__blocko.place(m.trayIndex, m.r, m.c), move);
  }
  const st = await page.evaluate(() => window.__blocko.state());
  return { moves, status: st.session ? st.session.status : 'none', score: st.session ? st.session.score : 0 };
}

/** Simple assertion helper that produces readable failures. */
export function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}
