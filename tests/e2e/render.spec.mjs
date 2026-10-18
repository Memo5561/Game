// E2E: canvas renderer + drag input (game/js/render/*, game/js/input/drag.js), driven through the
// standalone sandbox page tools/render-sandbox.html (served from the repo root).
//
// Checks, per viewport (360×700@3, 320×518@2, 1280×800@2, 800×1280@2):
//   - no console errors / page errors / failed requests
//   - backing store = CSS size × min(dpr, 2); hit-testing (trayIndexAt / cellAt, gutter + margins)
//   - REAL pointer drags (mouse and CDP touch) place pieces: a 3x3 into rows 5–7, a 1x1 into the
//     bottom-right cell, an I5 into the top row; an invalid drop flies back without placing
//   - promise timing (timeScale 0 = instant, frozen clock → wall-clock fallback), idle RAF stop
// Screenshots of every theme × staged scenario go to tools/out/render/ (gitignored).
// Frame-time measurement during repeated heavy 6-line clears with 4x CPU throttling is printed.
// Run: node tests/e2e/run.mjs render
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../../tools/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'render');

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 700, deviceScaleFactor: 3 },
  { name: 'small', width: 320, height: 518, deviceScaleFactor: 2 },
  { name: 'tabletLandscape', width: 1280, height: 800, deviceScaleFactor: 2 },
  { name: 'tabletPortrait', width: 800, height: 1280, deviceScaleFactor: 2 },
];
const THEMES = ['jewel', 'neon', 'candy', 'wood', 'pixel', 'gold'];
const ALL_SCENARIOS = ['mid', 'hover', 'clear', 'gameover', 'journey', 'tutorial', 'hammer', 'allclear', 'newbest', 'dim', 'shuffle', 'revive', 'previews'];
const THEME_SCENARIOS = ['mid', 'hover', 'clear', 'gameover', 'journey', 'hammer'];

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

async function openSandbox(browser, server, vp, query = 'scenario=start') {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.width < 900,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
  await page.goto(`${server.url}tools/render-sandbox.html?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sandbox && window.__sandbox.isReady, null, { timeout: 10000 });
  const cdp = await context.newCDPSession(page);
  return { page, context, errors, cdp };
}

const sb = (page, fn, arg) => page.evaluate(fn, arg);
const cellsOf = (st, list) => list.map(([r, c]) => st.session.board[r * 8 + c]);

async function mouseDrag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
    if (k % 4 === 0) await page.waitForTimeout(16);
  }
  await page.waitForTimeout(30);
  await page.mouse.up();
}

async function touchDrag(cdp, from, to, steps = 12) {
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Hit-testing and backing-store checks. */
async function checkLayout(page, vp) {
  const st = await sb(page, () => window.__sandbox.state());
  const L = st.layout;
  const dpr = Math.min(vp.deviceScaleFactor, 2);
  assert(st.dpr === dpr, `${vp.name}: render dpr ${st.dpr} != ${dpr}`);
  assert(Math.abs(st.canvas.w - Math.round(st.canvas.cssW * dpr)) <= 1, `${vp.name}: canvas width ${st.canvas.w}`);
  assert(Math.abs(st.canvas.h - Math.round(st.canvas.cssH * dpr)) <= 1, `${vp.name}: canvas height ${st.canvas.h}`);
  assert(L.landscape === (st.canvas.cssW >= st.canvas.cssH), `${vp.name}: orientation`);
  // board inside the canvas, tray rects inside margins / above the gutter
  assert(L.boardX >= 0 && L.boardY >= 0 && L.boardX + L.boardPx <= st.canvas.cssW && L.boardY + L.boardPx <= st.canvas.cssH, `${vp.name}: board fits`);
  const ratio = L.trayCell / L.cell;
  assert(ratio >= 0.49 && ratio <= 0.61, `${vp.name}: tray/board cell ratio ${ratio.toFixed(2)}`);
  for (const R of L.trayRects) {
    assert(R.x >= L.marginL - 0.5 && R.x + R.w <= st.canvas.cssW - L.marginR + 0.5, `${vp.name}: tray rect within side margins`);
    assert(R.y + R.h <= st.canvas.cssH - L.gutter + 0.5, `${vp.name}: tray rect above the gutter`);
  }
  const res = await sb(page, ({ L, H, W }) => {
    const s = window.__sandbox;
    const out = { slots: [], gutter: 0, margin: 0, cells: [] };
    L.trayRects.forEach((R) => out.slots.push(s.trayIndexAt(R.x + R.w / 2, R.y + R.h / 2)));
    const R0 = L.trayRects[0];
    out.gutter = s.trayIndexAt(R0.x + R0.w / 2, H - L.gutter / 2);
    out.margin = s.trayIndexAt(L.marginL / 2, R0.y + R0.h / 2);
    out.marginR = s.trayIndexAt(W - L.marginR / 2, L.trayRects[2].y + L.trayRects[2].h / 2);
    for (const [r, c] of [[0, 0], [7, 7], [3, 5]]) out.cells.push(s.cellAt(L.boardX + (c + 0.5) * L.cell, L.boardY + (r + 0.5) * L.cell));
    out.board = s.trayIndexAt(L.boardX + L.boardPx / 2, L.boardY + L.boardPx / 2);
    return out;
  }, { L, H: st.canvas.cssH, W: st.canvas.cssW });
  assert(res.slots.join(',') === '0,1,2', `${vp.name}: trayIndexAt slot centres → ${res.slots}`);
  assert(res.gutter === -1, `${vp.name}: bottom gutter must not hit a slot`);
  assert(res.margin === -1 && res.marginR === -1, `${vp.name}: side margins must not hit a slot`);
  assert(res.board === -1, `${vp.name}: board centre is not a tray slot`);
  const expect = [[0.5, 0.5], [7.5, 7.5], [3.5, 5.5]];
  res.cells.forEach((p, k) => {
    assert(Math.abs(p.r - expect[k][0]) < 1e-6 && Math.abs(p.c - expect[k][1]) < 1e-6, `${vp.name}: cellAt ${JSON.stringify(p)}`);
  });
}

/** Real pointer drags into the board (incl. bottom row and a 3x3 into rows 5–7). */
async function checkDrags(page, cdp, vp) {
  await sb(page, () => window.__sandbox.scenario('droptest'));
  await page.waitForTimeout(100);

  // 3x3 into rows 5–7 with the mouse
  let p = await sb(page, () => window.__sandbox.pointerFor(0, 5, 2));
  await mouseDrag(page, p.start, p.end);
  await page.waitForTimeout(60);
  let st = await sb(page, () => window.__sandbox.state());
  const o3 = [];
  for (let r = 5; r <= 7; r++) for (let c = 2; c <= 4; c++) o3.push([r, c]);
  assert(cellsOf(st, o3).every((v) => v === 4), `${vp.name}: O3 placed into rows 5–7 (board ${st.session.board.join('')})`);
  assert(st.session.tray[0] === null, `${vp.name}: tray slot 0 emptied`);

  // invalid drop: I5h across the O3 → flies back, nothing placed
  p = await sb(page, () => window.__sandbox.pointerFor(1, 6, 0));
  await mouseDrag(page, p.start, p.end);
  await page.waitForTimeout(250);
  st = await sb(page, () => window.__sandbox.state());
  assert(st.session.tray[1] && st.session.tray[1].shapeId === 'I5h', `${vp.name}: invalid drop keeps the piece`);
  const log = await sb(page, () => window.__sandbox.log.slice(-1)[0]);
  assert(log && log[0] === 'cancel' && log[2] === 'invalid', `${vp.name}: invalid drop reported (${JSON.stringify(log)})`);

  // 1x1 into the bottom-right cell with a real touch drag
  p = await sb(page, () => window.__sandbox.pointerFor(2, 7, 7));
  await touchDrag(cdp, p.start, p.end);
  await page.waitForTimeout(60);
  st = await sb(page, () => window.__sandbox.state());
  assert(st.session.board[63] === 1, `${vp.name}: touch drag placed the 1x1 into (7,7)`);

  // I5 into the top row (touch) → tray refills
  p = await sb(page, () => window.__sandbox.pointerFor(1, 0, 3));
  await touchDrag(cdp, p.start, p.end);
  await page.waitForTimeout(60);
  st = await sb(page, () => window.__sandbox.state());
  assert([3, 4, 5, 6, 7].every((c) => st.session.board[c] === 5), `${vp.name}: I5 placed into the top row`);
  assert(st.session.tray.every((t) => t !== null), `${vp.name}: tray refilled after the third piece`);

  // a second pointer during a drag is ignored; pointer cancel flies back
  p = await sb(page, () => {
    const s = window.__sandbox;
    s.scenario('droptest');
    return s.pointerFor(2, 7, 0);
  });
  await page.mouse.move(p.start.x, p.start.y);
  await page.mouse.down();
  await page.mouse.move(p.end.x, p.end.y, { steps: 5 });
  const active = await sb(page, () => window.__sandbox.dragController.active);
  assert(active, `${vp.name}: drag active while the button is down`);
  await sb(page, () => window.__sandbox.dragController.cancel());
  await page.mouse.up();
  await page.waitForTimeout(250);
  st = await sb(page, () => window.__sandbox.state());
  assert(st.session.board[56] === 0 && st.session.tray[2], `${vp.name}: cancel() did not place`);
}

/** Tutorial: a drop up to 1.0 cell away from the hinted target snaps onto it. */
async function checkTutorialSnap(page) {
  const info = await sb(page, () => {
    const s = window.__sandbox;
    s.scenario('tutorial');
    s.renderer.freeze(false);
    const h = s.session.tutorialHint();
    const p = s.pointerFor(h.trayIndex, h.r, h.c);
    const cell = s.renderer.layout.cell;
    // 0.8 cells right and 0.5 cells down of the exact spot: outside the normal 0.6-cell snap
    p.end.x += 0.8 * cell;
    p.end.y += 0.5 * cell;
    return { p, h, board: s.state().session.board.join('') };
  });
  await mouseDrag(page, info.p.start, info.p.end);
  await page.waitForTimeout(80);
  const st = await sb(page, () => window.__sandbox.state());
  assert(st.session.score > 0, `tutorial: drop near the hint snapped and cleared (score ${st.session.score})`);
}

/** Promise timing contract + idle loop stop. */
async function checkTiming(page) {
  const r = await sb(page, async () => {
    const s = window.__sandbox;
    const R = s.renderer;
    const out = {};
    s.scenario('mid');
    R.timeScale = 0;
    let t0 = performance.now();
    await R.animateGameOver();
    out.instant = performance.now() - t0;
    R.clearGameOver();
    R.timeScale = 1;
    R.freeze(true);
    t0 = performance.now();
    await R.animateTrayRefill(); // 300 ms on a stopped clock → wall-clock fallback 300 + 250
    out.fallback = performance.now() - t0;
    R.freeze(false);
    R.timeScale = 20;
    t0 = performance.now();
    await R.animateGameOver();
    out.fast = performance.now() - t0;
    R.timeScale = 1;
    R.clearGameOver();
    await new Promise((res) => setTimeout(res, 900));
    out.idle = R._raf === 0;
    return out;
  });
  assert(r.instant < 30, `timeScale 0 resolves immediately (${r.instant.toFixed(1)} ms)`);
  assert(r.fallback >= 500 && r.fallback < 900, `frozen clock → wall-clock fallback (${r.fallback.toFixed(0)} ms)`);
  assert(r.fast < 300, `timeScale 20 speeds animations up (${r.fast.toFixed(0)} ms)`);
  assert(r.idle, 'RAF loop stops when idle');
}

async function measurePerf(browser, server) {
  const vp = { name: 'perf', width: 360, height: 700, deviceScaleFactor: 3 };
  const { page, context, errors, cdp } = await openSandbox(browser, server, vp, 'scenario=start');
  const results = {};
  try {
    results.normal = await sb(page, () => window.__sandbox.perfRun({ clears: 8 }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    results.throttled4x = await sb(page, () => window.__sandbox.perfRun({ clears: 10 }));
    results['4x@dpr1.5'] = await sb(page, () => window.__sandbox.perfRun({ clears: 10, maxDpr: 1.5 }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    assert(errors.length === 0, `perf page errors:\n${errors.join('\n')}`);
  } finally {
    await context.close();
  }
  return results;
}

export default async function renderSpec() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer(0, ROOT);
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      const { page, context, errors, cdp } = await openSandbox(browser, server, vp);
      try {
        await checkLayout(page, vp);
        await checkDrags(page, cdp, vp);
        if (vp.name === 'phone') {
          await checkTutorialSnap(page);
          await checkTiming(page);
        }
        const scenarios = vp.name === 'phone' ? ALL_SCENARIOS : ['mid', 'hover', 'clear', 'tutorial'];
        for (const sc of scenarios) {
          await sb(page, (n) => window.__sandbox.scenario(n), sc);
          await page.waitForTimeout(60);
          await shot(page, `jewel-${sc}-${vp.name}`);
        }
        // hit-testing must survive a theme switch (sprites rebuilt, layout unchanged)
        await sb(page, () => window.__sandbox.setTheme('neon'));
        await checkLayout(page, vp);
        assert(errors.length === 0, `${vp.name}: page errors:\n${errors.join('\n')}`);
      } finally {
        await context.close();
      }
    }

    // every theme on the reference phone
    const vp = VIEWPORTS[0];
    for (const theme of THEMES) {
      const { page, context, errors } = await openSandbox(browser, server, vp, `theme=${theme}&scenario=mid`);
      try {
        for (const sc of THEME_SCENARIOS) {
          await sb(page, (n) => window.__sandbox.scenario(n), sc);
          await page.waitForTimeout(60);
          await shot(page, `${theme}-${sc}-phone`);
        }
        assert(errors.length === 0, `${theme}: page errors:\n${errors.join('\n')}`);
      } finally {
        await context.close();
      }
    }

    const perf = await measurePerf(browser, server);
    console.log(`  render perf (360×700@3 → dpr 2, repeated 6-line clears with gems):`);
    for (const [k, v] of Object.entries(perf)) {
      console.log(`    ${k.padEnd(12)} dpr ${v.dpr}  frames ${v.frames}  interval avg ${v.avgInterval} / p95 ${v.p95Interval} ms  draw work avg ${v.avgWork} / p95 ${v.p95Work} / max ${v.maxWork} ms`);
    }
    assert(perf.throttled4x.frames > 30, 'perf run produced animated frames');
    assert(perf.throttled4x.p95Work < 33, `p95 draw work under 4x CPU throttling ${perf.throttled4x.p95Work} ms`);
  } finally {
    await browser.close();
    await server.close();
  }
}
