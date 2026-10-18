// Google Play screenshot generator.
//
//   npm run assets                      → store/screenshots/<lang>/<device>/NN-<scene>.png (de, en; phone + both tablets)
//   npm run assets -- --langs de,en,fr  → other languages (de en es fr it pt tr ru | all)
//   npm run assets -- --devices phone   → phone | tablet7 | tablet10 (comma list)
//   npm run assets -- --scenes 1,2,combo→ only some scenes (number or id)
//   npm run assets -- --check           → only validate the existing PNGs (no browser)
//   npm run assets -- --raw             → also keep the uncomposed game captures in tools/out/store-raw/
//   npm run assets -- --combo-ms 300    → renderer time (ms) of the frozen combo frame (default 250)
//
// How it works: tools/serve.mjs serves the repo, Playwright (Chromium, mobile emulation) opens the real
// game with `?debug=1`, stages every scene through the debug API (window.__blocko: startGame with a staged
// board / tray / gems, drag() for the hover ghost, freeze() + renderer.advance() for a mid-animation
// frame, goto / modal, save patch) on a fixed clock (2026-10-18 12:00 Europe/Berlin), captures the game
// area and composes it into a marketing frame (tools/templates/store-shot.html): localized caption on
// top, the real game screen in a device frame below. Output is 24-bit PNG without alpha.
//
// Google Play rules checked by `checkAssets()` (exit code 1 on any violation): 2-8 screenshots per
// language and device folder, PNG without alpha channel, every side 320-3840 px, long side at most
// 2x the short side, exactly 16:9 or 9:16, at most 8 MB per file. icon-512.png / feature-graphic.png
// (tools/make-icons.mjs) are checked for their sizes as well.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { defaultSave } from '../game/js/meta/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(ROOT, 'store');
const SHOT_ROOT = path.join(STORE, 'screenshots');
const RAW_ROOT = path.join(ROOT, 'tools', 'out', 'store-raw');

/** The game's own clock is pinned to this instant (local time of TIMEZONE) for reproducible shots. */
const FIXED_NOW = '2026-10-18T12:00:00';
const TIMEZONE = 'Europe/Berlin';
const TODAY = '2026-10-18';
const YESTERDAY = '2026-10-17';

export const ALL_LANGS = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr', 'ru'];
const LOCALES = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };

// ------------------------------------------------------------------------------------------------
// Devices: canvas = final PNG size (all exactly 9:16), view = the WebView area the game is rendered in
// (CSS px; dpr is the capture scale, the result is scaled down into the device frame).
// ------------------------------------------------------------------------------------------------
export const DEVICES = {
  phone: {
    folder: 'phone', label: 'Phone', kind: 'phone', canvas: [1080, 1920],
    view: { w: 360, h: 700, dpr: 3 }, captionFrac: 0.158, maxFrameWidth: 0.8,
  },
  tablet7: {
    folder: 'tablet-7', label: '7-inch tablet', kind: 'tablet', canvas: [1350, 2400],
    view: { w: 600, h: 840, dpr: 3 }, captionFrac: 0.17, maxFrameWidth: 0.9,
  },
  tablet10: {
    folder: 'tablet-10', label: '10-inch tablet', kind: 'tablet', canvas: [1620, 2880],
    view: { w: 800, h: 1260, dpr: 2.5 }, captionFrac: 0.17, maxFrameWidth: 0.9,
  },
};

// ------------------------------------------------------------------------------------------------
// Captions: max. 5 words; *text* is highlighted in gold. Keep in sync with docs/STORE_LISTING.md.
// ------------------------------------------------------------------------------------------------
const NB = ' ';
export const CAPTIONS = {
  drag: {
    de: 'Ziehen. Ablegen. *Abräumen!*', en: 'Drag. Drop. *Clear!*', es: 'Arrastra. Suelta. *¡Limpia!*',
    fr: `Glisse. Pose. *Efface${NB}!*`, it: 'Trascina. Rilascia. *Elimina!*', pt: 'Arraste. Solte. *Limpe!*',
    tr: 'Sürükle. Bırak. *Temizle!*', ru: 'Тяни. Бросай. *Очищай!*',
  },
  combo: {
    de: '*Kombos* für Riesenpunkte', en: '*Combos* for huge scores', es: '*Combos* para puntuar a lo grande',
    fr: '*Combos* pour des scores géants', it: '*Combo* per punteggi enormi', pt: '*Combos* para pontuações enormes',
    tr: 'Devasa skorlar için *kombolar*', ru: '*Комбо* для огромных очков',
  },
  map: {
    de: '*Unbegrenzt* viele Level', en: '*Unlimited* levels', es: 'Niveles *ilimitados*',
    fr: 'Niveaux *illimités*', it: 'Livelli *infiniti*', pt: 'Níveis *ilimitados*',
    tr: '*Sınırsız* seviye', ru: '*Бесконечные* уровни',
  },
  level: {
    de: 'Sammle *Edelsteine* & Sterne', en: 'Collect *gems*, earn stars', es: 'Reúne *gemas* y estrellas',
    fr: 'Récolte *gemmes* et étoiles', it: 'Raccogli *gemme* e stelle', pt: 'Colete *gemas* e estrelas',
    tr: '*Taş* topla, yıldız kazan', ru: 'Собирай *кристаллы* и звёзды',
  },
  daily: {
    de: 'Jeden Tag ein *neues Rätsel*', en: 'A *new puzzle* every day', es: 'Un *nuevo reto* cada día',
    fr: `Un *nouveau défi* chaque jour`, it: 'Ogni giorno una *nuova sfida*', pt: 'Um *novo desafio* todo dia',
    tr: 'Her gün *yeni bir bulmaca*', ru: 'Каждый день *новая головоломка*',
  },
  themes: {
    de: '*Sechs*\nBlock-Designs', en: '*Six* block themes', es: '*Seis* estilos de bloques',
    fr: '*Six* thèmes de blocs', it: '*Sei* temi per i blocchi', pt: '*Seis* temas de blocos',
    tr: '*Altı* blok teması', ru: '*Шесть* стилей блоков',
  },
  rewards: {
    de: 'Tägliche *Belohnungen*', en: 'Daily *rewards*', es: '*Recompensas* diarias',
    fr: '*Récompenses* quotidiennes', it: '*Premi* ogni giorno', pt: '*Recompensas* diárias',
    tr: 'Günlük *ödüller*', ru: 'Ежедневные *награды*',
  },
  newbest: {
    de: 'Knacke deinen *Highscore*', en: 'Beat your *high score*', es: 'Supera tu *récord*',
    fr: 'Bats ton *record*', it: 'Batti il tuo *record*', pt: 'Quebre seu *recorde*',
    tr: '*Rekorunu* kır', ru: 'Побей свой *рекорд*',
  },
};

// ------------------------------------------------------------------------------------------------
// Player profile: a returning player, mid-game (no tutorial, no popups, no review card).
// ------------------------------------------------------------------------------------------------
function buildSave(lang) {
  const s = defaultSave();
  const day = (iso) => Date.parse(`${iso}T12:00:00+02:00`);
  s.createdAt = day('2026-09-02');
  s.lastPlayedAt = day(YESTERDAY);
  s.lastSessionStart = day(YESTERDAY);
  s.settings.lang = lang;
  s.coins = 3250;
  s.xp = 1330; // player level 7, a bit more than a third into the level
  s.stats = {
    gamesPlayed: 34, classicGames: 29, bestScore: 4820, totalScore: 61240, totalLines: 612,
    bestCombo: 7, piecesPlaced: 1490, allClears: 1, playSec: 16200,
  };
  s.themes = { owned: ['jewel', 'neon', 'candy'], selected: 'jewel' };
  s.boosters = { hammer: 3, shuffle: 2 };
  s.daily = { lastClaimDay: YESTERDAY, day: 2, streak: 2 };
  s.journey = { unlocked: 12, stars: { 1: 3, 2: 3, 3: 2, 4: 3, 5: 3, 6: 2, 7: 3, 8: 1, 9: 3, 10: 2, 11: 3 } };
  s.challenge = { completed: { '2026-10-14': 3, '2026-10-15': 2, '2026-10-16': 3, [YESTERDAY]: 3 }, streak: 4, lastDay: YESTERDAY };
  s.flags = { tutorialDone: true, notifAsked: YESTERDAY, notifOptIn: false, notifDeclines: 2, reviewAsked: true, firstRecordShown: true };
  return s;
}

/** Pins Date to FIXED_NOW (time keeps running) – runs before any page script. */
function fixedClock(iso) {
  const RealDate = Date;
  const base = RealDate.parse(iso);
  const t0 = RealDate.now();
  const now = () => base + (RealDate.now() - t0);
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(now());
      else super(...a);
    }
    static now() { return now(); }
  }
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;
}

// ------------------------------------------------------------------------------------------------
// Scenes. Boards: 8 rows, '.' empty, '0'..'7' palette index (red orange yellow green cyan blue purple pink).
// ------------------------------------------------------------------------------------------------
const SCENES = [
  {
    id: 'drag', caption: 'drag',
    // a tower in column 3 and two nearly complete rows: the O block would clear 2 rows + 1 column
    async run(g) {
      await g.start('classic', {
        seed: 11, best: 4820, score: 4310,
        board: [
          '...5....',
          '...5..77',
          '...5..7.',
          '.115....',
          '.1.5.44.',
          '33.5.44.',
          '322..006',
          '326..066',
        ],
        tray: [{ shapeId: 'O2', color: 7 }, { shapeId: 'L4b', color: 3 }, { shapeId: 'I3h', color: 4 }],
      });
      await g.drag(0, 6, 3);
    },
  },
  {
    id: 'combo', caption: 'combo',
    // an L block completes row 7 and columns 5-7 at once: 4 lines, combo x5, "Excellent!" frozen mid-burst
    async run(g, o) {
      await g.start('classic', {
        seed: 5, best: 4820, score: 3180,
        board: [
          '.....456',
          '.....456',
          '...1.456',
          '..11.456',
          '.33..456',
          '03..2.56',
          '00.22.56',
          '12302...',
        ],
        tray: [{ shapeId: 'L5a', color: 7 }, { shapeId: 'I3v', color: 2 }, { shapeId: 'O2', color: 3 }],
      });
      await g.stageCombo(o);
    },
  },
  {
    id: 'map', caption: 'map',
    async run(g) {
      await g.page.evaluate(() => window.__blocko.goto('journey'));
      await g.settle(900);
      await g.fitJourneyMap(0.2);
    },
  },
  {
    id: 'level', caption: 'level',
    // level 17: the O block would complete two rows that hold three diamonds and a heart
    async run(g) {
      await g.start('journey', {
        level: 17, seed: 3,
        tray: [{ shapeId: 'O2', color: 6 }, { shapeId: 'L3d', color: 4 }, { shapeId: 'I3h', color: 3 }],
      });
      await g.drag(0, 3, 6);
    },
  },
  {
    id: 'daily', caption: 'daily',
    async run(g) {
      await g.start('daily', {
        seed: 9, score: 1640,
        tray: [{ shapeId: 'I4v', color: 1 }, { shapeId: 'L4b', color: 2 }, { shapeId: 'I3h', color: 7 }],
      });
      await g.drag(0, 2, 7, { dx: 0.1, dy: -0.4 });
    },
  },
  {
    id: 'themes', caption: 'themes',
    async run(g) {
      await g.page.evaluate(() => { window.__blocko.app.go('shop', { tab: 'themes' }); });
      await g.settle(900);
    },
  },
  {
    id: 'rewards', caption: 'rewards',
    async run(g) {
      await g.page.evaluate(() => window.__blocko.goto('home'));
      await g.settle(300);
      const open = await g.page.evaluate(() => window.__blocko.state().modals.includes('dailyReward'));
      if (!open) await g.page.evaluate(() => window.__blocko.modal('dailyReward', { auto: true }));
      await g.settle(900);
    },
  },
  {
    id: 'newbest', caption: 'newbest',
    // last move beats the best score, nothing fits afterwards → the real run-end screen with "New best!"
    async run(g) {
      await g.start('classic', {
        seed: 21, best: 4820, score: 4790,
        board: [
          '012.4567',
          '7654.210',
          '24.02460',
          '.357135.',
          '65432.05',
          '1.345670',
          '76.12345',
          '3571246.',
        ],
        tray: [{ shapeId: 'I1', color: 2 }, { shapeId: 'O2', color: 5 }, { shapeId: 'O3', color: 6 }],
      });
      await g.finishRun();
    },
  },
];

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { langs: ['de', 'en'], devices: Object.keys(DEVICES), scenes: null, check: false, raw: false, out: SHOT_ROOT, headed: false, comboMs: 250 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--langs') { const v = val(); o.langs = v === 'all' ? ALL_LANGS : v.split(',').map((x) => x.trim()).filter(Boolean); }
    else if (a === '--devices') o.devices = val().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--scenes') o.scenes = val().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--check') o.check = true;
    else if (a === '--raw') o.raw = true;
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--headed') o.headed = true;
    else if (a === '--combo-ms') o.comboMs = Number(val());
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  for (const l of o.langs) if (!ALL_LANGS.includes(l)) throw new Error(`Unknown language: ${l} (${ALL_LANGS.join(', ')})`);
  for (const d of o.devices) if (!DEVICES[d]) throw new Error(`Unknown device: ${d} (${Object.keys(DEVICES).join(', ')})`);
  return o;
}

function pickScenes(filter) {
  if (!filter) return SCENES;
  return SCENES.filter((s, i) => filter.includes(String(i + 1)) || filter.includes(s.id));
}

// ------------------------------------------------------------------------------------------------
// Game driver (one fresh browser context per scene)
// ------------------------------------------------------------------------------------------------
async function openScene(browser, server, { lang, view }) {
  const context = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: view.dpr,
    isMobile: true,
    hasTouch: true,
    locale: LOCALES[lang],
    timezoneId: TIMEZONE,
    colorScheme: 'dark',
  });
  await context.addInitScript(fixedClock, FIXED_NOW);
  await context.addInitScript((save) => {
    try { localStorage.setItem('blocko.save.v1', JSON.stringify(save)); } catch { /* ignore */ }
  }, buildSave(lang));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  await page.goto(`${server.url}game/index.html?debug=1&mock=nofill`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__blockoBooted === true && !!window.__blocko, null, { timeout: 20000 });
  // store shots never show dev toasts; the app also logs them for tests (state().toasts)
  await page.addStyleTag({ content: '#toasts { display: none !important; }' });
  await page.evaluate(() => { window.__blocko.app.modals.closeAll(); window.__blocko.setTimeScale(20); });

  const G = {
    page, context, errors,
    async settle(extra = 350) {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.__blocko.idle());
      await page.waitForTimeout(extra);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    },
    async start(mode, opts) {
      await page.evaluate(([m, o]) => window.__blocko.startGame(m, o), [mode, opts]);
      await G.settle(300);
    },
    /** Floating piece over (r, c) with the ghost and the lines it would clear (like a finger drag, offset a bit up-right). */
    async drag(i, r, c, { dx = 0.15, dy = -0.45 } = {}) {
      await page.evaluate(([a, b, d, ox, oy]) => {
        const game = window.__blocko.app.game;
        const R = game.renderer;
        const L = R.layout;
        const pv = game.session.preview(a, b, d);
        if (!pv.valid) throw new Error(`staged drag target (${b}, ${d}) is not a valid placement`);
        R.setDrag({
          trayIndex: a, x: L.boardX + (d + ox) * L.cell, y: L.boardY + (b + oy) * L.cell,
          snap: { r: b, c: d }, rows: pv.rows, cols: pv.cols,
        });
      }, [i, r, c, dx, dy]);
      await G.settle(250);
    },
    /** Stages the big combo: the L block drops now, the renderer clock is advanced to the burst frame. */
    async stageCombo(o) {
      const frame = o.comboMs > 0 ? o.comboMs : 250;
      await page.evaluate(() => {
        const b = window.__blocko;
        b.setTimeScale(1);
        const game = b.app.game;
        game.renderer.freeze(true);
        game.session.combo = 4;
        game.session.movesSinceClear = 0;
        game.session.piecesPlaced = 37;
      });
      const placed = await page.evaluate(() => window.__blocko.app.game.drop(0, 5, 5));
      if (!placed) throw new Error('combo scene: the staged drop was rejected');
      await page.evaluate((ms) => window.__blocko.app.game.renderer.advance(ms), frame);
      // the HUD count-ups run on the real clock: wait until the score shows the final value
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-h="score"]');
        return !!el && el.textContent.replace(/\D/g, '') === String(window.__blocko.app.game.session.score);
      }, null, { timeout: 8000 });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__blocko.app.game.renderer.advance(0));
    },
    /**
     * Scrolls the journey map (as little as possible from the default position) so that every level
     * node and chapter sign is either completely visible or completely outside - no half nodes.
     */
    async fitJourneyMap(shift = 0) {
      const res = await page.evaluate(async (frac) => {
        const sc = document.querySelector('.map');
        const base = Math.max(0, sc.scrollTop + frac * sc.clientHeight);
        const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const union = (el) => {
          const r = el.getBoundingClientRect();
          let { top, bottom } = r;
          for (const c of el.querySelectorAll('*')) {
            const b = c.getBoundingClientRect();
            if (!b.width && !b.height) continue;
            top = Math.min(top, b.top);
            bottom = Math.max(bottom, b.bottom);
          }
          return { top, bottom };
        };
        // strict: whole nodes (disc, stars, badges) + chapter signs; relaxed: only the numbers and signs
        const clean = (selector, whole) => {
          const box = sc.getBoundingClientRect();
          for (const el of sc.querySelectorAll(selector)) {
            const r = whole ? union(el) : el.getBoundingClientRect();
            const inside = r.top >= box.top + 4 && r.bottom <= box.bottom - 6;
            const outside = r.bottom <= box.top - 2 || r.top >= box.bottom + 2;
            if (!inside && !outside) return false;
          }
          return true;
        };
        const search = async (selector, whole, maxD) => {
          for (let d = 0; d <= maxD; d += 3) {
            for (const sign of d === 0 ? [1] : [-1, 1]) {
              sc.scrollTop = base + sign * d;
              await frames();
              if (clean(selector, whole)) return true;
            }
          }
          return false;
        };
        if (await search('.node, .map__chapter', true, 220)) return { ok: true, fade: false };
        // tablets: the node spacing may never match the viewport height - fade the map edges instead
        sc.style.webkitMaskImage = sc.style.maskImage = 'linear-gradient(to bottom, transparent 0, #000 36px, #000 calc(100% - 56px), transparent 100%)';
        if (await search('.node__num, .map__chapter', false, 320)) return { ok: true, fade: true };
        return { ok: false, fade: true };
      }, shift);
      if (!res.ok) throw new Error('journey map: no scroll position without half-visible level numbers');
      await G.settle(200);
    },
    /** Plays the last move of the "new best" scene and waits for the run-end screen. */
    async finishRun() {
      await page.evaluate(() => {
        const game = window.__blocko.app.game;
        game.session.reviveUsed = true; // no revive offer: straight to the result screen
        game.session.piecesPlaced = 58;
        game.session.linesCleared = 61;
        game.session.maxCombo = 4;
      });
      const placed = await page.evaluate(() => window.__blocko.app.game.drop(0, 7, 7));
      if (!placed) throw new Error('newbest scene: the staged drop was rejected');
      await page.waitForFunction(() => window.__blocko.state().modals.includes('gameover'), null, { timeout: 15000 });
      await page.waitForFunction(() => {
        const el = document.querySelector('.modal [data-ref="score"]');
        return !!el && /\d/.test(el.textContent) && Number(el.textContent.replace(/\D/g, '')) >= 4800;
      }, null, { timeout: 8000 });
      await G.settle(1500);
    },
    async raw() {
      return page.screenshot({ type: 'png' });
    },
    async state() {
      return page.evaluate(() => window.__blocko.state());
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
  return G;
}

// ------------------------------------------------------------------------------------------------
// Composition
// ------------------------------------------------------------------------------------------------
function frameGeometry(dev) {
  const [W, H] = dev.canvas;
  const u = W / 1080;
  const capH = Math.round(H * dev.captionFrac);
  const bottom = Math.round(H * 0.022);
  const availH = H - capH - bottom;
  const rim = Math.max(2, Math.round(3 * u));
  const bezel = Math.round((dev.kind === 'phone' ? 10 : 15) * u);
  const extra = 2 * (rim + bezel);
  const aspect = dev.view.w / dev.view.h;
  let sh = availH - extra;
  let sw = sh * aspect;
  const maxW = W * dev.maxFrameWidth - extra;
  if (sw > maxW) { sw = maxW; sh = sw / aspect; }
  sw = Math.round(sw);
  sh = Math.round(sw / aspect);
  const w = sw + extra;
  const h = sh + extra;
  const x = Math.round((W - w) / 2);
  const y = capH + Math.round((availH - h) / 2);
  const screenRadius = Math.round(sw * (dev.kind === 'phone' ? 0.115 : 0.045));
  const radius = screenRadius + bezel + rim;
  const keys = dev.kind === 'phone'
    ? [{ side: 'right', t: Math.round(5 * u), y: Math.round(h * 0.2), h: Math.round(h * 0.075) }, { side: 'right', t: Math.round(5 * u), y: Math.round(h * 0.31), h: Math.round(h * 0.13) }]
    : [{ side: 'right', t: Math.round(5 * u), y: Math.round(h * 0.12), h: Math.round(h * 0.06) }];
  return { W, H, u, capH, device: { x, y, w, h, radius, rim, bezel, screenRadius, keys }, screen: { w: sw, h: sh } };
}

async function newComposer(browser, server, dev) {
  const [W, H] = dev.canvas;
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${server.url}tools/templates/store-shot.html`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.load('900 60px Nunito', 'AaÄäÖöÜüßĞğŞşİıЖж'));
  await page.evaluate(() => document.fonts.ready);
  return { page, context };
}

async function captionSize(composer, dev, lang) {
  const [W, H] = dev.canvas;
  const u = W / 1080;
  const texts = SCENES.map((s) => CAPTIONS[s.caption][lang]);
  return composer.page.evaluate(([t, o]) => window.__fitCaptions(t, o), [texts, {
    W, H, maxWidth: Math.round(W * 0.88), maxLines: 2, maxSize: Math.round(112 * u), minSize: Math.round(56 * u),
  }]);
}

async function compose(composer, dev, { caption, size, rawPng }) {
  const geo = frameGeometry(dev);
  await composer.page.evaluate((o) => window.__compose(o), {
    W: geo.W, H: geo.H, caption, captionSize: size, captionHeight: geo.capH, captionMaxWidth: Math.round(geo.W * 0.88),
    device: geo.device, shot: `data:image/png;base64,${rawPng.toString('base64')}`,
  });
  return composer.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: geo.W, height: geo.H } });
}

// ------------------------------------------------------------------------------------------------
// Validation (Google Play rules)
// ------------------------------------------------------------------------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, depth: number, colorType: number, alpha: boolean, bytes: number }} */
export function readPngInfo(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG file');
  let alpha = false;
  let pos = 8;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) alpha = true;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tRNS') alpha = true;
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return { width, height, depth, colorType, alpha, bytes: buf.length };
}

function listPngs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listPngs(p));
    else if (e.name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out.sort();
}

/**
 * Validates every PNG below `dir` against the Play Console rules (see header).
 * @returns {{ errors: string[], warnings: string[], files: number }}
 */
export function checkAssets({ dir = SHOT_ROOT, store = STORE } = {}) {
  const errors = [];
  const warnings = [];
  const files = listPngs(dir);
  const groups = new Map();
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    let info;
    try {
      info = readPngInfo(f);
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
      continue;
    }
    const { width: w, height: h } = info;
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    if (short < 320) errors.push(`${rel}: ${w}x${h} - a side is smaller than 320 px`);
    if (long > 3840) errors.push(`${rel}: ${w}x${h} - a side is larger than 3840 px`);
    if (long > 2 * short) errors.push(`${rel}: ${w}x${h} - long side is more than 2x the short side`);
    const ratio = long / short;
    if (Math.abs(ratio - 16 / 9) / (16 / 9) > 0.005) errors.push(`${rel}: ${w}x${h} - aspect ratio ${ratio.toFixed(3)} is not 16:9 / 9:16`);
    if (info.alpha) errors.push(`${rel}: has an alpha channel (Play needs 24-bit PNG or JPEG)`);
    if (info.depth !== 8) errors.push(`${rel}: bit depth ${info.depth} (expected 8)`);
    if (info.bytes > 8 * 1024 * 1024) errors.push(`${rel}: ${(info.bytes / 1048576).toFixed(1)} MB - larger than 8 MB`);
    const group = path.relative(dir, path.dirname(f));
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  if (!files.length) errors.push(`${path.relative(ROOT, dir)}: no screenshots found (run: npm run assets)`);
  for (const [group, n] of groups) {
    const where = path.relative(ROOT, path.join(dir, group));
    if (n < 2) errors.push(`${where}: ${n} screenshot(s) - Play needs at least 2`);
    if (n > 8) errors.push(`${where}: ${n} screenshots - Play allows at most 8`);
  }
  const fixed = [['icon-512.png', 512, 512, 1024 * 1024], ['feature-graphic.png', 1024, 500, 15 * 1024 * 1024]];
  for (const [name, w, h, max] of fixed) {
    const f = path.join(store, name);
    if (!fs.existsSync(f)) { warnings.push(`store/${name}: missing (npm run icons)`); continue; }
    const info = readPngInfo(f);
    if (info.width !== w || info.height !== h) errors.push(`store/${name}: ${info.width}x${info.height}, expected ${w}x${h}`);
    if (info.bytes > max) errors.push(`store/${name}: ${info.bytes} bytes exceeds the limit`);
  }
  return { errors, warnings, files: files.length };
}

function printCheck(res) {
  for (const w of res.warnings) console.warn(`  warning: ${w}`);
  if (res.errors.length) {
    console.error(`Asset check FAILED (${res.errors.length} problem(s)):`);
    for (const e of res.errors) console.error(`  - ${e}`);
  } else {
    console.log(`Asset check passed: ${res.files} screenshot(s) satisfy the Google Play rules.`);
  }
}

// ------------------------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------------------------
async function generate(o) {
  const scenes = pickScenes(o.scenes);
  if (!scenes.length) throw new Error('No scene matches --scenes');
  const server = await startServer(0, ROOT);
  const browser = await chromium.launch({ headless: !o.headed });
  const failures = [];
  const written = [];
  try {
    for (const devKey of o.devices) {
      const dev = DEVICES[devKey];
      const composer = await newComposer(browser, server, dev);
      for (const lang of o.langs) {
        const size = await captionSize(composer, dev, lang);
        for (const scene of scenes) {
          const num = String(SCENES.indexOf(scene) + 1).padStart(2, '0');
          const label = `${lang}/${dev.folder}/${num}-${scene.id}`;
          let ok = false;
          for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
            let g;
            try {
              g = await openScene(browser, server, { lang, view: dev.view });
              await scene.run(g, { comboMs: o.comboMs, dev });
              const st = await g.state();
              if (st.toasts.length) console.warn(`  ${label}: toasts were logged (hidden): ${st.toasts.join(' | ')}`);
              if (g.errors.length) throw new Error(`page errors:\n${g.errors.join('\n')}`);
              const raw = await g.raw();
              const png = await compose(composer, dev, { caption: CAPTIONS[scene.caption][lang], size, rawPng: raw });
              const outDir = path.join(o.out, lang, dev.folder);
              fs.mkdirSync(outDir, { recursive: true });
              const file = path.join(outDir, `${num}-${scene.id}.png`);
              fs.writeFileSync(file, png);
              if (o.raw) {
                const rawDir = path.join(RAW_ROOT, lang, dev.folder);
                fs.mkdirSync(rawDir, { recursive: true });
                fs.writeFileSync(path.join(rawDir, `${num}-${scene.id}.png`), raw);
              }
              written.push(file);
              const info = readPngInfo(file);
              console.log(`  ${label}  ${info.width}x${info.height}  ${(info.bytes / 1024).toFixed(0)} KB${attempt > 1 ? `  (attempt ${attempt})` : ''}`);
              ok = true;
            } catch (e) {
              console.warn(`  ${label}: attempt ${attempt} failed: ${String(e.message || e).split('\n')[0]}`);
              if (attempt === 3) failures.push(`${label}: ${e.message || e}`);
            } finally {
              if (g) await g.close();
            }
          }
        }
      }
      await composer.context.close();
    }
    if (!o.scenes) removeStale(o, written);
  } finally {
    await browser.close();
    await server.close();
  }
  return { written, failures };
}

/** After a full run: PNGs of the generated language/device folders that this run did not write (renamed or removed scenes). */
function removeStale(o, written) {
  const keep = new Set(written);
  for (const lang of o.langs) {
    for (const devKey of o.devices) {
      const dir = path.join(o.out, lang, DEVICES[devKey].folder);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const file = path.join(dir, f);
        if (f.toLowerCase().endsWith('.png') && !keep.has(file)) {
          fs.rmSync(file);
          console.log(`  removed stale ${path.relative(ROOT, file)}`);
        }
      }
    }
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  if (!o.check) {
    console.log(`Rendering ${o.langs.join(', ')} x ${o.devices.join(', ')} ...`);
    const { written, failures } = await generate(o);
    console.log(`${written.length} screenshot(s) written to ${path.relative(ROOT, o.out)}`);
    if (failures.length) {
      console.error('Failed scenes:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    }
  }
  const res = checkAssets({ dir: o.out });
  printCheck(res);
  if (res.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
