// Debug / test API (docs/ARCHITECTURE.md §4.15) – window.__blocko, only with ?debug=1 and not on
// the app host unless the native build is a debug build (Platform.info.debug).
//
//   state()                      snapshot: { screen, modals, busy, coins, playerLevel, lang, theme,
//                                session: null | { mode, status, score, best, combo, movesSinceClear,
//                                piecesPlaced, reviveUsed, board[64], gems[64], tray, goals } } + extras
//                                (tutorial, targetMode, stuck, run, ads, toasts, landscape)
//   idle()                       resolves when no run sequencing, modal or screen animation is pending
//   startGame(mode, opts)        skips the tutorial; opts { seed, level (number|LevelDef), day, board:
//                                string[8] ('.'|'0'..'7'), gems: string[8] ('.'|'1'..'3'|'d','s','h'),
//                                tray: [{shapeId,color}|null], score, best }
//   place(i, r, c)               the real drop path; resolves with PlaceResult|null once busy === false
//                                or a resulting modal is visible
//   drag(i, r, c) | drag(null)   floating piece + ghost over (r, c) for screenshots
//   validMoves()                 [{ trayIndex, r, c, lines, cells }]
//   setTimeScale(x) · freeze(b) · skipTutorial() · forceGameOver() · goto(screen) · modal(id, props?)
//   setNow(iso|null) · setLang(code) · setTheme(id) · setCoins(n) · simulate(platformEvent)
//   save(patch?)                 deep-merges `patch` into the save (+ flush); returns a copy of the save
//   reset()                      wipes the save and reloads
//   extras: pointerFor(i, r, c) → page coordinates of a real drag; cellPoint(r, c) → page coordinates of
//   a board cell; missingKeys(); audio(); platform; app

import { Platform } from '../platform/bridge.js';
import { GameSession, listValidMoves } from '../core/game.js';
import { getShape } from '../core/shapes.js';
import { generateLevel, generateDailyLevel } from '../core/levels.js';
import { pointerForCell } from '../input/drag.js';
import { flushSave, requestSave } from '../meta/storage.js';
import { audioDebugInfo } from '../audio/sfx.js';
import { getLang, missingKeys } from '../ui/i18n.js';

const APP_HOST = 'appassets.androidplatform.net';
const GEM_CODES = { 1: 1, 2: 2, 3: 3, d: 1, s: 2, h: 3 };

/** @returns {boolean} the debug API (and missing-key warnings) may be enabled */
export function debugAllowed(platform) {
  if (typeof location === 'undefined') return false;
  if (new URLSearchParams(location.search).get('debug') !== '1') return false;
  return location.hostname !== APP_HOST || !!(platform.info && platform.info.debug);
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** @param {Object} app */
export function installDebug(app) {
  const g = () => app.game;

  function state() {
    const game = g();
    const s = game && game.session;
    return {
      screen: app.router.current,
      modals: app.modals.ids,
      busy: !!game && game.busy,
      coins: app.save.coins,
      playerLevel: app.progression.levelInfo().level,
      lang: getLang(),
      theme: app.themeId,
      session: s ? {
        mode: s.mode,
        status: s.status,
        score: s.score,
        best: s.bestScore,
        combo: s.combo,
        movesSinceClear: s.movesSinceClear,
        piecesPlaced: s.piecesPlaced,
        reviveUsed: s.reviveUsed,
        board: Array.from(s.board.cells),
        gems: Array.from(s.board.gems),
        tray: s.tray.map((p) => (p ? { shapeId: p.shapeId, color: p.color } : null)),
        goals: JSON.parse(JSON.stringify(s.goals)),
      } : null,
      tutorial: s && s.mode === 'tutorial' ? { step: s.tutorialStep, hint: s.tutorialHint() } : null,
      targetMode: game ? game.targetMode : null,
      stuck: !!game && game.stuck,
      finalized: !!game && game.finalized,
      run: !!app.save.run,
      ads: { started: app.adsStarted, banner: app.bannerVisible, ...Platform.adState },
      toasts: app.toastLog.slice(),
      landscape: document.body.classList.contains('landscape'),
    };
  }

  /** Resolves when the app is settled (2 quiet frames in a row). */
  async function idle(timeout = 15000) {
    const t0 = performance.now();
    let quiet = 0;
    while (performance.now() - t0 < timeout) {
      const top = app.modals.top();
      const busy = g().settling || app.modals.animating > 0 || app.router.transitioning || (top && !top.shownAt);
      quiet = busy ? 0 : quiet + 1;
      if (quiet >= 2) return true;
      await frame();
    }
    return false;
  }

  /** busy === false, or a modal is fully visible. */
  async function settle(timeout = 15000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const top = app.modals.top();
      if (top ? top.shownAt > 0 : !g().busy) return true;
      await frame();
    }
    return false;
  }

  async function place(i, r, c) {
    const game = g();
    if (!game.drop(i, r, c)) return null;
    const res = game.lastResult;
    await settle();
    return res;
  }

  function drag(i, r, c) {
    const R = g().renderer;
    const s = g().session;
    if (i === null || i === undefined || !s) {
      R.setDrag(null);
      return null;
    }
    const L = R.layout;
    const pv = s.preview(i, r, c);
    R.setDrag({
      trayIndex: i,
      x: L.boardX + (c + 0.28) * L.cell,
      y: L.boardY + (r - 0.42) * L.cell,
      snap: pv.valid ? { r, c } : null,
      rows: pv.rows,
      cols: pv.cols,
    });
    return pv;
  }

  function pointerFor(i, r, c) {
    const game = g();
    const L = game.renderer.layout;
    const p = game.session.tray[i];
    if (!p) return null;
    const rect = game.canvas.getBoundingClientRect();
    const T = L.trayRects[i];
    const end = pointerForCell(L, L.height, getShape(p.shapeId), r, c);
    return { start: { x: rect.left + T.x + T.w / 2, y: rect.top + T.cy }, end: { x: rect.left + end.x, y: rect.top + end.y } };
  }

  /** Page coordinates of the centre of board cell (r, c) (taps in booster target mode). */
  function cellPoint(r, c) {
    const game = g();
    const L = game.renderer.layout;
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + L.boardX + (c + 0.5) * L.cell, y: rect.top + L.boardY + (r + 0.5) * L.cell };
  }

  async function startGame(mode = 'classic', opts = {}) {
    const game = g();
    app.save.flags.tutorialDone = true;
    game.discardRun();
    app.modals.closeAll();
    let level = null;
    if (mode === 'journey') {
      level = opts.level && typeof opts.level === 'object' ? opts.level : generateLevel(Number(opts.level) || app.progression.journeyUnlocked);
    } else if (mode === 'daily') {
      level = opts.level && typeof opts.level === 'object' ? opts.level : generateDailyLevel(opts.day || app.clock.today());
    }
    const s = GameSession.create({
      mode,
      seed: opts.seed,
      level,
      bestScore: opts.best ?? app.progression.bestScore,
      gamesPlayed: app.save.stats.gamesPlayed,
    });
    if (opts.board) stageBoard(s, opts.board, opts.gems);
    if (opts.tray) s.tray = opts.tray.map((p) => (p ? s.generator.createPiece(p.shapeId, p.color) : null));
    if (typeof opts.score === 'number') s.score = opts.score;
    if (opts.board || opts.tray) s.updateStatus();
    flushSave(app.save);
    game.useSession(s);
    app.go('game');
    await idle();
    return state().session;
  }

  function sampleProps(id) {
    const P = app.progression;
    const info = P.levelInfo();
    const base = {
      reason: 'over', mode: 'classic', level: null, score: 1380, bestBefore: 1500, best: 1500, newBest: false, firstRecord: false,
      runCoins: 34, levelCoins: 0, coinsEarned: 34, coinsBefore: Math.max(0, app.save.coins - 34), coinsAfter: app.save.coins,
      levelUpCoins: 0, levelUps: [], unlockedThemes: [], firstTime: false, streak: 0, stars: 0, pieces: 42, goals: {},
      counted: true, xpGained: 32, levelBefore: { ...info, progress: Math.max(0, info.progress - 0.2) }, levelAfter: info,
      missionsDone: [], doubled: false,
    };
    if (id === 'gameover') return { summary: base };
    if (id === 'levelResult') {
      const level = generateLevel(P.journeyUnlocked);
      return { summary: { ...base, reason: 'won', mode: 'journey', level, stars: 3, levelCoins: 70, coinsEarned: 70, runCoins: 0, firstTime: true, pieces: level.par[0], goals: level.goals } };
    }
    if (id === 'revive') return { variant: g().session && g().session.mode !== 'classic' ? 'level' : 'classic' };
    if (id === 'confirm') return { titleKey: 'confirm.restart.title', bodyKey: 'confirm.restart.body', okKey: 'pause.restart', okIcon: 'retry', icon: 'retry' };
    if (id === 'booster') return { type: 'hammer' };
    return {};
  }

  window.__blocko = {
    state,
    idle,
    startGame,
    place,
    drag,
    validMoves: () => (g().session ? listValidMoves(g().session) : []),
    setTimeScale: (x) => app.setTimeScale(Number(x)),
    freeze: (on) => g().renderer.freeze(!!on),
    skipTutorial() {
      if (g().session && g().session.mode === 'tutorial') g().skipTutorial();
      else {
        app.save.flags.tutorialDone = true;
        flushSave(app.save);
      }
    },
    forceGameOver: () => g().forceGameOver(),
    goto(id) {
      app.modals.closeAll();
      app.go(id);
    },
    modal: (id, props) => app.modals.open(id, props || sampleProps(id)).id,
    setNow(iso) {
      app.clock.setNow(iso);
      app.checkDay(true);
    },
    setLang: (code) => app.setLanguage(code),
    setTheme: (id) => app.applyTheme(id),
    setCoins(n) {
      app.save.coins = Math.max(0, Math.floor(Number(n) || 0));
      requestSave(app.save);
      app.refreshCoins({ instant: true });
      app.router.refresh('data');
    },
    simulate: (evt) => Platform._simulate(evt),
    save(patch) {
      if (patch && typeof patch === 'object') {
        deepMerge(app.save, patch);
        flushSave(app.save);
        app.refreshCoins({ instant: true });
        app.router.refresh('data');
      }
      return JSON.parse(JSON.stringify(app.save));
    },
    reset: () => app.resetProgress(),
    pointerFor,
    cellPoint,
    missingKeys,
    audio: audioDebugInfo,
    platform: Platform,
    app,
  };
}

function stageBoard(s, rows, gems) {
  const b = s.board;
  b.cells.fill(0);
  b.gems.fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) if (row[c] && row[c] !== '.') b.cells[r * 8 + c] = Number(row[c]) + 1;
  });
  if (!gems) return;
  gems.forEach((row, r) => {
    for (let c = 0; c < 8; c++) {
      const type = GEM_CODES[row[c]];
      if (type && b.cells[r * 8 + c]) b.gems[r * 8 + c] = type;
    }
  });
}

function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], v);
    } else {
      target[key] = v;
    }
  }
}
