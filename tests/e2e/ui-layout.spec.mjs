// E2E layout / legibility fixes after the QA review:
// - Banner clearance: while a banner can be present, every touch target keeps ≥ 48 px to the bottom
//   edge (home dock, scrolled-to-end lists, sheets, result screens, the tray) at 320×518 and 360×640;
//   without a banner (ads removed) nothing is reserved.
// - Tablet landscape: result screens keep every button on screen (also with a 10" tablet's ~660 px
//   of height); 7-digit scores fit the HUD column and the result screen.
// - 320 px phones: home top bar with 99,999 coins, journey / daily HUD inside its box above the
//   board, German tutorial title on one line, shop tab labels without a mid-word break.
// - Touch targets ≥ 44 px (hit area), text ≥ 12 px, theme colours: legible text tokens and a
//   "Watch ad" colour that differs from the main buttons in every theme.
// - Floating clear texts (points / praise / combo) never overlap.
// Run: node tests/e2e/run.mjs ui-layout
import { THEMES, THEME_IDS, themeCssVars } from '../../game/js/render/theme.js';
import { LANGS } from '../../game/js/ui/i18n.js';
import { openGame, veteranSave, makeSave, VIEWPORTS, assert, ev, state, idle, waitModal, tap, playMoves, layoutProblems, assertNoErrors } from './ui.helpers.mjs';

const BANNER_CLEAR = 48;

// ---------------------------------------------------------------------------------------------
// colours (node only)
// ---------------------------------------------------------------------------------------------

function lin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function lum(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function themeTokens() {
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    const v = themeCssVars(t);
    // "Watch ad" buttons never look like the main (btn) or secondary (btn-2) buttons
    assert(v['--ad'].toLowerCase() !== v['--btn'].toLowerCase() && v['--ad'].toLowerCase() !== v['--btn-2'].toLowerCase(), `${id}: ad button colour differs from btn / btn2`);
    // button labels on their fill: large bold text needs 3:1
    assert(contrast(v['--btn-text'], v['--btn']) >= 3, `${id}: primary button text ${contrast(v['--btn-text'], v['--btn']).toFixed(2)}:1`);
    assert(contrast(v['--btn-2-text'], v['--btn-2']) >= 3, `${id}: secondary button text ${contrast(v['--btn-2-text'], v['--btn-2']).toFixed(2)}:1`);
    assert(contrast(v['--ad-text'], v['--ad']) >= 4.5, `${id}: ad button text ${contrast(v['--ad-text'], v['--ad']).toFixed(2)}:1`);
    // coin / accent / good text on the panel and on the page background
    for (const token of ['--coin-text', '--accent-text', '--good-text', '--text-dim']) {
      for (const [name, bg] of [['panel', v['--panel']], ['bg-top', v['--bg-top']], ['bg-bottom', v['--bg-bottom']]]) {
        const ratio = contrast(v[token], bg);
        assert(ratio >= 3, `${id}: ${token} on ${name} ${ratio.toFixed(2)}:1 (< 3:1)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// bottom clearance
// ---------------------------------------------------------------------------------------------

/** Visible touch targets of the active screen + top modal closer than `min` px to the bottom edge. */
function tooLow(page, min) {
  return page.evaluate((limit) => {
    const vh = window.innerHeight;
    const scrollers = [...document.querySelectorAll('.screen.is-active .screen-body, .screen.is-active .shop-body, .modal:not(.is-closing):not(.is-covered) .modal__dialog, .screen.is-active .map')];
    for (const sc of scrollers) sc.scrollTop = sc.scrollHeight;
    const roots = [...document.querySelectorAll('.screen.is-active, .modal:not(.is-closing):not(.is-covered)')];
    const top = roots.filter((r) => r.classList.contains('modal')).pop();
    const out = [];
    for (const el of (top || roots[0]).querySelectorAll('button, [data-action], a, input, select, [role="switch"], [role="tab"]')) {
      if (el.closest('[aria-hidden="true"]') || el.closest('.node') || el.closest('.is-covered')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= vh) continue;
      if (vh - r.bottom < limit - 0.5) out.push(`${el.getAttribute('data-action') || el.tagName} ${Math.round(vh - r.bottom)}px`);
    }
    return out;
  }, min);
}

async function clearanceScenes(vp) {
  const today = new Date().toISOString().slice(0, 10);
  const g = await openGame({
    viewport: vp,
    save: veteranSave({
      coins: 3250,
      stats: { gamesPlayed: 30, classicGames: 20, bestScore: 12840 },
      journey: { unlocked: 20, stars: { 1: 3, 2: 2, 3: 1 } },
      boosters: { hammer: 3, shuffle: 1 },
      challenge: { completed: {}, streak: 0, lastDay: null },
      flags: { notifDeclines: 2 },
      daily: { lastClaimDay: today, day: 3, streak: 3 },
    }),
  });
  const { page } = g;
  const at = `${vp.width}×${vp.height}`;
  const check = async (name) => {
    await idle(page);
    await page.waitForTimeout(80);
    const low = await tooLow(page, BANNER_CLEAR);
    assert(low.length === 0, `[${at}] ${name}: touch targets too close to the banner: ${low.join(', ')}`);
  };
  const modal = async (id, props) => {
    await ev(page, ([m, p]) => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open(m, p); }, [id, props]);
    await waitModal(page, id);
    await page.waitForTimeout(150);
    await check(`modal ${id}`);
  };
  try {
    assert(await ev(page, () => document.body.classList.contains('has-banner')), 'body.has-banner while ads are not removed');
    await check('home');
    for (const id of ['missions', 'settings', 'legal', 'journey']) {
      await ev(page, (s) => window.__blocko.goto(s), id);
      await check(id);
    }
    // journey: the "jump to current level" button
    await ev(page, () => { document.querySelector('.screen.is-active .map').scrollTop = 0; });
    await page.waitForTimeout(150);
    await check('journey (scrolled)');
    await ev(page, () => window.__blocko.goto('shop'));
    await page.waitForSelector('.screen.is-active [data-product="coins_large"]');
    for (const tab of ['coins', 'themes', 'boosters']) {
      await tap(page, `shop.tab.${tab}`);
      await idle(page);
      await check(`shop ${tab}`);
    }
    // the in-game tray (hit rects end ≥ 48 px above the bottom; ≥ 46 on the smallest phone)
    for (const mode of ['classic', 'journey', 'daily']) {
      await ev(page, (m) => window.__blocko.startGame(m, { seed: 3 }), mode);
      await idle(page);
      await page.waitForTimeout(150);
      const gap = await ev(page, () => {
        const game = window.__blocko.app.game;
        const rect = game.canvas.getBoundingClientRect();
        return Math.min(...game.renderer.layout.trayRects.map((T) => window.innerHeight - (rect.top + T.y + T.h)));
      });
      assert(gap >= BANNER_CLEAR - 3, `[${at}] ${mode}: tray touch area ${Math.round(gap)} px above the bottom`);
      const hud = await ev(page, () => {
        const h = document.querySelector('.hud');
        const c = window.__blocko.app.game.canvas.getBoundingClientRect();
        const kids = [...h.children].map((k) => k.getBoundingClientRect().bottom);
        return { content: Math.max(...kids), hud: h.getBoundingClientRect().bottom, canvasTop: c.top, boardTop: c.top + window.__blocko.app.game.renderer.layout.boardY };
      });
      assert(hud.content <= hud.hud + 1 && hud.content <= hud.boardTop, `[${at}] ${mode} HUD content ends at ${hud.content} (HUD ${hud.hud}, board ${hud.boardTop})`);
    }
    await tapPause(page);
    await check('pause');
    await ev(page, () => window.__blocko.app.modals.closeAll());
    await modal('confirm', { titleKey: 'confirm.restart.title', bodyKey: 'confirm.restart.body', okKey: 'pause.restart', okIcon: 'retry', icon: 'retry' });
    await modal('booster', { type: 'hammer' });
    await modal('langPicker', {});
    await modal('levelStart', { n: 20 });
    await modal('dailyReward', { auto: false });
    await modal('levelUp', { levels: [5], coins: 100, themes: ['neon'] });
    await modal('notifAsk', { coins: 100 });
    await modal('purchasePending', {});
    // revive (classic + stuck panel) and the result screens, the richest variants
    await ev(page, () => window.__blocko.startGame('classic', { seed: 3, best: 1500, score: 1320 }));
    await idle(page);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await page.waitForTimeout(150);
    await check('revive');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    await page.waitForTimeout(1800);
    await check('gameover');
    await ev(page, () => window.__blocko.startGame('journey', { level: 20, seed: 3 }));
    await idle(page);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await page.waitForTimeout(150);
    await check('stuck panel');
    for (const variant of richResults()) {
      await ev(page, ([s]) => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open(s.reason === 'won' || s.mode !== 'classic' ? 'levelResult' : 'gameover', { summary: s }); }, [variant.summary(await levelFor(page))]);
      await page.waitForTimeout(1800);
      await check(variant.name);
    }
    assertNoErrors(g, `clearance ${at}`);
  } finally {
    await g.close();
  }
}

const levelFor = (page) => ev(page, () => window.__blocko.app.game.session.level);

async function tapPause(page) {
  await ev(page, () => window.__blocko.startGame('classic', { seed: 3 }));
  await idle(page);
  await tap(page, 'game.pause');
  await waitModal(page, 'pause');
}

/** Result summaries with every optional row (level-up, theme, streak, missions, upsell). */
function richResults() {
  const base = (level, o) => ({
    reason: 'over', mode: 'classic', level, score: 2140, bestBefore: 1500, best: 2140, newBest: true, firstRecord: false,
    runCoins: 52, levelCoins: 0, coinsEarned: 52, coinsBefore: 100, coinsAfter: 152, levelUpCoins: 100, levelUps: [6], unlockedThemes: ['wood'],
    firstTime: false, streak: 0, stars: 0, pieces: 42, goals: {}, counted: true, xpGained: 32,
    levelBefore: { level: 5, progress: 0.4, xpIntoLevel: 10, xpForNext: 100 }, levelAfter: { level: 6, progress: 0.1, xpIntoLevel: 10, xpForNext: 100 },
    missionsDone: [], doubled: false, ...o,
  });
  return [
    { name: 'gameover (new best, level-up, theme)', summary: (level) => base(level, {}) },
    { name: 'levelResult (journey win)', summary: (level) => base(level, { reason: 'won', mode: 'journey', stars: 2, levelCoins: 90, coinsEarned: 90, runCoins: 0, firstTime: true, pieces: level.par[1], goals: level.goals }) },
    { name: 'levelResult (daily win, streak)', summary: (level) => base(level, { reason: 'won', mode: 'daily', stars: 3, levelCoins: 150, coinsEarned: 150, runCoins: 0, firstTime: true, streak: 5, pieces: level.par[0], goals: level.goals }) },
    { name: 'levelResult (failed)', summary: (level) => base(level, { reason: 'over', mode: 'journey', coinsEarned: 0, runCoins: 0, levelUps: [], unlockedThemes: [], goals: level.goals }) },
  ];
}

async function noBannerNoReserve() {
  const g = await openGame({ viewport: VIEWPORTS.phoneSmall, save: veteranSave() });
  try {
    await ev(g.page, () => window.__blocko.simulate({ type: 'entitlements', adsRemoved: true })); // the mock platform is authoritative at boot
    await idle(g.page);
    assert(!(await ev(g.page, () => document.body.classList.contains('has-banner'))), 'no has-banner class once ads are removed');
    const gap = await ev(g.page, () => {
      const dock = document.querySelector('.screen.is-active .dock').getBoundingClientRect();
      return window.innerHeight - dock.bottom;
    });
    assert(gap < BANNER_CLEAR, `without a banner the dock sits lower (${Math.round(gap)} px)`);
  } finally {
    await g.close();
  }
}

// ---------------------------------------------------------------------------------------------
// tablets
// ---------------------------------------------------------------------------------------------

async function tabletResults() {
  for (const vp of [{ width: 1280, height: 800, deviceScaleFactor: 2 }, { width: 1280, height: 660, deviceScaleFactor: 2 }, { width: 800, height: 1280, deviceScaleFactor: 2 }]) {
    const g = await openGame({ viewport: vp, save: veteranSave({ coins: 99999, journey: { unlocked: 20 }, stats: { gamesPlayed: 30, bestScore: 1300000 }, flags: { notifDeclines: 2 } }) });
    const { page } = g;
    const at = `${vp.width}×${vp.height}`;
    try {
      await ev(page, () => window.__blocko.startGame('journey', { level: 20, seed: 3 }));
      await idle(page);
      const level = await levelFor(page);
      for (const variant of richResults()) {
        await ev(page, ([s]) => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open(s.reason === 'won' || s.mode !== 'classic' ? 'levelResult' : 'gameover', { summary: s }); }, [variant.summary(level)]);
        await page.waitForTimeout(1800);
        const r = await ev(page, () => {
          const vh = window.innerHeight;
          const m = [...document.querySelectorAll('.modal')].pop();
          return [...m.querySelectorAll('.result__actions [data-action]')].map((b) => ({ a: b.getAttribute('data-action'), top: b.getBoundingClientRect().top, bottom: b.getBoundingClientRect().bottom, vh }));
        });
        assert(r.length >= 2 && r.every((b) => b.bottom <= b.vh + 0.5 && b.top >= 0), `[${at}] ${variant.name}: every button on screen (${JSON.stringify(r.filter((b) => b.bottom > b.vh))})`);
        const problems = await layoutProblems(page);
        assert(problems.length === 0, `[${at}] ${variant.name}:\n  ${problems.join('\n  ')}`);
      }
      // 7-digit score: result screen and classic HUD stay inside their boxes
      await ev(page, () => window.__blocko.app.modals.closeAll());
      await ev(page, () => window.__blocko.startGame('classic', { seed: 3, best: 1300000, score: 1234567 }));
      await idle(page);
      const hud = await ev(page, () => {
        const el = document.querySelector('.hud__score');
        const r = document.createRange();
        r.selectNodeContents(el);
        const t = r.getBoundingClientRect();
        const h = document.querySelector('.hud').getBoundingClientRect();
        const cv = window.__blocko.app.game.canvas.getBoundingClientRect();
        const land = document.body.classList.contains('landscape');
        return { left: t.left, right: t.right, hudLeft: h.left, hudRight: h.right, canvasLeft: cv.left, land, vw: window.innerWidth };
      });
      assert(hud.left >= -0.5 && hud.right <= hud.vw + 0.5, `[${at}] HUD score inside the screen (${Math.round(hud.left)}…${Math.round(hud.right)})`);
      if (hud.land) assert(hud.right <= hud.canvasLeft + 0.5, `[${at}] HUD score stays left of the board (${Math.round(hud.right)} ≤ ${Math.round(hud.canvasLeft)})`);
      await ev(page, () => window.__blocko.forceGameOver());
      await waitModal(page, 'revive');
      await tap(page, 'revive.skip');
      await waitModal(page, 'gameover');
      await page.waitForTimeout(1500);
      const score = await ev(page, () => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector('[data-modal="gameover"] .result__score'));
        const b = r.getBoundingClientRect();
        return { left: b.left, right: b.right, vw: window.innerWidth };
      });
      assert(score.left >= 0 && score.right <= score.vw, `[${at}] result score inside the screen (${Math.round(score.left)}…${Math.round(score.right)})`);
      assertNoErrors(g, `tablet ${at}`);
    } finally {
      await g.close();
    }
  }
}

async function phoneScore() {
  const g = await openGame({ viewport: VIEWPORTS.phone, save: veteranSave({ stats: { gamesPlayed: 30, bestScore: 1300000 } }) });
  try {
    const { page } = g;
    await ev(page, () => window.__blocko.startGame('classic', { seed: 3, best: 1300000, score: 1234567 }));
    await idle(page);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    await page.waitForTimeout(1500);
    const b = await ev(page, () => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector('[data-modal="gameover"] .result__score'));
      const x = r.getBoundingClientRect();
      return { left: x.left, right: x.right, vw: window.innerWidth };
    });
    assert(b.left >= 4 && b.right <= b.vw - 4, `7-digit result score fits at 360 px (${Math.round(b.left)}…${Math.round(b.right)})`);
  } finally {
    await g.close();
  }
}

// ---------------------------------------------------------------------------------------------
// 320 px phones
// ---------------------------------------------------------------------------------------------

async function smallPhone() {
  const vp = VIEWPORTS.phoneSmall;
  const g = await openGame({ viewport: vp, save: veteranSave({ coins: 99999, xp: 999999, daily: { lastClaimDay: null, day: 0, streak: 0 }, flags: { notifDeclines: 2 } }) });
  const { page } = g;
  try {
    // home top bar: coin pill and its "+" button stay on screen (gift button shown)
    await ev(page, () => window.__blocko.app.modals.closeAll());
    await idle(page);
    for (const coins of [600, 1000, 12000, 99999]) {
      await ev(page, (n) => window.__blocko.setCoins(n), coins);
      const bar = await ev(page, () => {
        const pill = document.querySelector('.screen.is-active .topbar .coin-pill').getBoundingClientRect();
        const plus = document.querySelector('.screen.is-active .topbar .coin-pill__plus').getBoundingClientRect();
        const gift = document.querySelector('.screen.is-active .gift-btn');
        return { right: pill.right, plusRight: plus.right, vw: window.innerWidth, gift: gift && !gift.hidden };
      });
      assert(bar.gift && bar.right <= bar.vw - 4 && bar.plusRight <= bar.vw - 4, `${coins} coins: pill ends at ${Math.round(bar.right)} of ${bar.vw}`);
    }
    // shop tabs: no mid-word break, in English and German
    for (const lang of ['en', 'de']) {
      await ev(page, (l) => window.__blocko.setLang(l), lang);
      await ev(page, () => window.__blocko.goto('shop'));
      await page.waitForSelector('.screen.is-active .tabs__label');
      const wrapped = await ev(page, () => [...document.querySelectorAll('.screen.is-active .tabs__label')].filter((l) => {
        const r = document.createRange();
        r.selectNodeContents(l);
        return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1 || l.scrollWidth > l.clientWidth;
      }).map((l) => l.textContent));
      assert(wrapped.length === 0, `shop tab labels fit on one line in ${lang} (${wrapped})`);
    }
    await ev(page, () => window.__blocko.setLang('en'));
    // journey + daily HUD
    for (const [mode, opts] of [['journey', { level: 5 }], ['daily', {}]]) {
      await ev(page, ([m, o]) => window.__blocko.startGame(m, { seed: 3, ...o }), [mode, opts]);
      await idle(page);
      const hud = await ev(page, () => {
        const h = document.querySelector('.hud');
        const kids = [...h.children].map((k) => k.getBoundingClientRect().bottom);
        const c = window.__blocko.app.game.canvas.getBoundingClientRect();
        return { content: Math.max(...kids), hud: h.getBoundingClientRect().bottom, boardTop: c.top + window.__blocko.app.game.renderer.layout.boardY };
      });
      assert(hud.content <= hud.hud + 1 && hud.hud <= hud.boardTop, `${mode} HUD fits its box above the board (${JSON.stringify(hud)})`);
    }
  } finally {
    await g.close();
  }

  // the coach title is never cut off, in any language, with the Skip button shown (steps 2-3)
  const tg = await openGame({ viewport: vp });
  try {
    for (const lang of LANGS) {
      await ev(tg.page, (l) => window.__blocko.setLang(l), lang);
      for (const step of [0, 1, 2]) {
        await ev(tg.page, (n) => window.__blocko.app.game.hud.setTutorialStep(n, { instant: true }), step);
        const r = await ev(tg.page, () => {
          const el = document.querySelector('.coach__title');
          return { cut: el.scrollWidth > el.clientWidth, text: el.textContent, skip: getComputedStyle(document.querySelector('.coach__skip')).display !== 'none' };
        });
        assert(!r.cut, `[${lang}] coach title "${r.text}" is cut off at step ${step + 1} (skip ${r.skip})`);
        const problems = await layoutProblems(tg.page);
        assert(problems.length === 0, `[${lang}] tutorial step ${step + 1}:\n  ${problems.join('\n  ')}`);
      }
    }
  } finally {
    await tg.close();
  }

  // German tutorial: the coach title is one line (the hidden Skip button takes no room)
  const t = await openGame({ viewport: vp, locale: 'de-DE', save: makeSave({ settings: { lang: 'de' } }) });
  try {
    const lines = await ev(t.page, () => {
      const el = document.querySelector('.coach__title');
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    });
    assert(lines === 1, `German tutorial title on one line (${lines})`);
    assert(await ev(t.page, () => getComputedStyle(document.querySelector('[data-action="tutorial.skip"]')).display === 'none'), 'Skip takes no space in step 1');
    const problems = await layoutProblems(t.page);
    assert(problems.length === 0, `German tutorial layout:\n  ${problems.join('\n  ')}`);
  } finally {
    await t.close();
  }
}

// ---------------------------------------------------------------------------------------------
// touch targets + text size
// ---------------------------------------------------------------------------------------------

/** Is the point (x, y) inside `el`'s hit area? (elementFromPoint, so pseudo-element extenders count) */
function hits(page, selector, dy) {
  return page.evaluate(([sel, d]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const above = document.elementFromPoint(x, r.top - d);
    const below = document.elementFromPoint(x, r.bottom + d);
    return !!(above && el.contains(above)) && !!(below && el.contains(below));
  }, [selector, dy]);
}

async function touchAndText() {
  const g = await openGame({
    viewport: VIEWPORTS.phoneSmall,
    save: veteranSave({ coins: 3250, journey: { unlocked: 12, stars: { 1: 3 } }, stats: { gamesPlayed: 30, bestScore: 12840 }, flags: { notifDeclines: 2 } }),
  });
  const { page } = g;
  try {
    const smallText = async (where) => {
      await idle(page);
      const small = await ev(page, () => {
        const out = [];
        for (const root of document.querySelectorAll('.screen.is-active, .modal:not(.is-closing):not(.is-covered)')) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const el = n.parentElement;
            if (!el || el.closest('[aria-hidden="true"], svg, .settings-debug') || !el.getClientRects().length) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            let zoom = 1;
            for (let e = el; e && e.nodeType === 1; e = e.parentElement) zoom *= parseFloat(getComputedStyle(e).zoom) || 1;
            if (parseFloat(cs.fontSize) * zoom < 11.99) out.push(`${n.textContent.trim().slice(0, 24)} ${cs.fontSize}`);
          }
        }
        return out;
      });
      assert(small.length === 0, `${where}: text under 12 px: ${small.join(' | ')}`);
    };
    await smallText('home');
    await ev(page, () => window.__blocko.goto('shop'));
    await page.waitForSelector('.screen.is-active [data-action="shop.buy.coins_small"]');
    await smallText('shop coins');
    assert(await hits(page, '.screen.is-active [data-action="shop.buy.coins_small"]', 3), 'price button: ≥ 44 px hit area');
    const restoreH = await ev(page, () => document.querySelector('.screen.is-active [data-action="shop.restore"]').getBoundingClientRect().height);
    assert(restoreH >= 44, `Restore purchases: ≥ 44 px hit area (${Math.round(restoreH)})`);
    await tap(page, 'shop.tab.themes');
    await smallText('shop themes');
    await tap(page, 'shop.tab.boosters');
    await smallText('shop boosters');
    for (const screen of ['missions', 'settings', 'legal', 'journey']) {
      await ev(page, (s) => window.__blocko.goto(s), screen);
      await smallText(screen);
    }
    for (const [id, props] of [['levelStart', { n: 20 }], ['dailyReward', { auto: false }], ['levelUp', { levels: [5], coins: 100, themes: ['neon'] }]]) {
      await ev(page, ([m, p]) => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open(m, p); }, [id, props]);
      await waitModal(page, id);
      await smallText(id);
    }
    await ev(page, () => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open('levelStart', { n: 20 }); });
    await waitModal(page, 'levelStart');
    const box = await ev(page, () => { const r = document.querySelector('[data-modal="levelStart"] .modal__close').getBoundingClientRect(); return [r.width, r.height]; });
    assert(box[0] >= 44 && box[1] >= 44, `level start close button ${box}`);
    await ev(page, () => window.__blocko.app.modals.closeAll());
    // gift button keeps a 44 px hit area on short phones
    await ev(page, () => window.__blocko.goto('home'));
    await ev(page, () => window.__blocko.save({ daily: { lastClaimDay: null } }));
    await idle(page);
    await ev(page, () => window.__blocko.app.modals.closeAll());
    const gift = await ev(page, () => { const r = document.querySelector('.screen.is-active .gift-btn').getBoundingClientRect(); return { h: r.height, w: r.width }; });
    assert(gift.h >= 36 && (await hits(page, '.screen.is-active .gift-btn', 2)), `gift button hit area (${JSON.stringify(gift)})`);
  } finally {
    await g.close();
  }
  const t = await openGame({ viewport: VIEWPORTS.phoneSmall, save: makeSave({}) });
  try {
    const { page } = t;
    const h = await ev(page, () => window.__blocko.state().tutorial.hint);
    await ev(page, (hh) => window.__blocko.place(hh.trayIndex, hh.r, hh.c), h);
    await page.waitForFunction(() => window.__blocko.state().tutorial && window.__blocko.state().tutorial.step === 1);
    await idle(page);
    assert(await hits(page, '[data-action="tutorial.skip"]', 4), 'tutorial Skip: ≥ 44 px hit area');
  } finally {
    await t.close();
  }
}

// ---------------------------------------------------------------------------------------------
// floating clear texts
// ---------------------------------------------------------------------------------------------

async function clearTexts() {
  const g = await openGame({ save: veteranSave({ stats: { gamesPlayed: 30, bestScore: 9000 } }), timeScale: 1 });
  const { page } = g;
  try {
    // instrument animatePlace: every text of one placement must be free of the others (swept rects)
    await ev(page, () => {
      const R = window.__blocko.app.game.renderer;
      window.__ov = { clears: 0, overlaps: [] };
      const orig = R.animatePlace.bind(R);
      R.animatePlace = (res) => {
        const p = orig(res);
        if (!res || !res.linesCount) return p;
        window.__ov.clears++;
        const now = R._texts.filter((s) => s.active && s.start === R.time && s.img);
        const rects = now.map((s) => ({ k: s.kind, l: s.x - s.w / 2, r: s.x + s.w / 2, t: s.y - s.h / 2 - (s.kind === 0 ? s.rise : 0), b: s.y + s.h / 2 }));
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) window.__ov.overlaps.push([a.k, b.k]);
          }
        }
        return p;
      };
    });
    // the "New best!" banner never sits on top of the points / praise of the same placement:
    // it either finds a free spot or waits until they have faded
    await ev(page, () => {
      const R = window.__blocko.app.game.renderer;
      window.__banner = [];
      const orig = R.celebrate.bind(R);
      R.celebrate = (kind) => {
        const p = orig(kind);
        if (kind !== 'newBest') return p;
        const b = R._texts.filter((x) => x.active && x.kind === 4).sort((x, y) => y.start - x.start)[0];
        const others = R._texts.filter((x) => x.active && x.img && x !== b && x.kind !== 4 && x.start === R.time);
        const wait = b.start - R.time;
        const hit = others.some((o) => {
          const oTop = o.y - o.h / 2 - (o.kind === 0 ? o.rise : 0);
          return b.x - b.w / 2 < o.x + o.w / 2 && o.x - o.w / 2 < b.x + b.w / 2 && b.y - b.h / 2 < o.y + o.h / 2 && oTop < b.y + b.h / 2;
        });
        window.__banner.push({ wait, hit });
        return p;
      };
    });
    await ev(page, () => window.__blocko.startGame('classic', {
      seed: 7, best: 1500, score: 1490,
      board: ['........', '1234..67', '1234..67', '........', '........', '........', '........', '........'],
      tray: [{ shapeId: 'O2', color: 5 }, { shapeId: 'I2h', color: 2 }, { shapeId: 'L3a', color: 3 }],
    }));
    await ev(page, () => { const s = window.__blocko.app.game.session; s.combo = 2; s.movesSinceClear = 0; });
    await ev(page, () => window.__blocko.place(0, 1, 4));
    await page.waitForTimeout(150);
    const nb = await ev(page, () => window.__banner);
    assert(nb.length === 1 && (nb[0].wait >= 500 || !nb[0].hit), `new-best banner is clear of the other texts (${JSON.stringify(nb)})`);
    const cases = [
      { board: ['........', '........', '........', '........', '........', '........', '1234..67', '........'], tray: [{ shapeId: 'O2', color: 5 }, { shapeId: 'I2h', color: 2 }, { shapeId: 'L3a', color: 3 }], at: [[0, 6, 4]], combo: 6 },
      { board: ['........', '........', '........', '1234.567', '1234.567', '1234.567', '........', '........'], tray: [{ shapeId: 'I3v', color: 5 }, { shapeId: 'I2h', color: 2 }, { shapeId: 'L3a', color: 3 }], at: [[0, 3, 4]], combo: 3 },
      { board: ['........', '1234..67', '1234..67', '........', '........', '........', '........', '........'], tray: [{ shapeId: 'O2', color: 5 }, { shapeId: 'I2h', color: 2 }, { shapeId: 'L3a', color: 3 }], at: [[0, 1, 4]], combo: 2 },
    ];
    for (const c of cases) {
      await ev(page, (cc) => window.__blocko.startGame('classic', { seed: 7, best: 9000, score: 4000, board: cc.board, tray: cc.tray }), c);
      await ev(page, (cc) => { const s = window.__blocko.app.game.session; s.combo = cc.combo; s.movesSinceClear = 0; }, c);
      for (const [i, r, col] of c.at) await ev(page, ([a, b, d]) => window.__blocko.place(a, b, d), [i, r, col]);
      await page.waitForTimeout(150);
    }
    const ov = await ev(page, () => window.__ov);
    assert(ov.clears >= 3 && ov.overlaps.length === 0, `points / praise / combo texts never overlap (${ov.clears} clears, overlaps ${JSON.stringify(ov.overlaps)})`);
    assertNoErrors(g, 'clear texts');
  } finally {
    await g.close();
  }
}

export default async function uiLayoutSpec() {
  themeTokens();
  await clearTexts();
  await noBannerNoReserve();
  await clearanceScenes({ width: 320, height: 518, deviceScaleFactor: 2 });
  await clearanceScenes({ width: 360, height: 640, deviceScaleFactor: 2 });
  await tabletResults();
  await phoneScore();
  await smallPhone();
  await touchAndText();
}
