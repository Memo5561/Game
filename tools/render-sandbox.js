// Render sandbox: a standalone page that drives the real Renderer + DragController with a real
// GameSession (classic, fixed seed) – for manual play, staged screenshots and e2e tests.
// See tools/render-sandbox.html for usage. Exposes window.__sandbox (documented below).

import { GameSession, listValidMoves } from '/game/js/core/game.js';
import { getShape } from '/game/js/core/shapes.js';
import { generateLevel } from '/game/js/core/levels.js';
import { Renderer } from '/game/js/render/renderer.js';
import { DragController, pointerForCell } from '/game/js/input/drag.js';
import { THEME_IDS, getTheme, themeCssVars } from '/game/js/render/theme.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 20261018) >>> 0;
const BEST = 1500;

const STRINGS = {
  'praise.good': 'Good!',
  'praise.great': 'Great!',
  'praise.excellent': 'Excellent!',
  'praise.amazing': 'Amazing!',
  'praise.unbelievable': 'Unbelievable!',
  combo: 'Combo x{n}',
  nospace: 'No space!',
  newbest: 'New best!',
};
const t = (key, p) => (STRINGS[key] || key).replace('{n}', p && p.n !== undefined ? p.n : '');

const state = {
  session: null,
  busy: false,
  theme: params.get('theme') || 'jewel',
  scenario: params.get('scenario') || 'start',
  hintTimer: 0,
  log: [],
};

if (params.get('hud') === '0') document.body.classList.add('nohud');
if (params.get('ui') === '1') document.body.classList.add('ui');

function applyLandscapeClass() {
  document.body.classList.toggle('landscape', innerWidth / innerHeight >= 1.2);
}
applyLandscapeClass();
addEventListener('resize', applyLandscapeClass);

const canvas = document.getElementById('c');
const renderer = new Renderer(canvas, { theme: getTheme(state.theme), t });

const drag = new DragController(canvas, renderer, {
  canInteract: () => !state.busy && !!state.session && state.session.status === 'playing',
  getPiece: (i) => {
    const p = state.session && state.session.tray[i];
    return p ? { shape: getShape(p.shapeId), color: p.color } : null;
  },
  canPlace: (i, r, c) => state.session.canPlace(i, r, c),
  preview: (i, r, c) => state.session.preview(i, r, c),
  hint: () => (state.session && state.session.mode === 'tutorial' ? state.session.tutorialHint() : null),
  onPickup: (i) => {
    state.log.push(['pickup', i]);
    clearTimeout(state.hintTimer);
    renderer.hideHint();
  },
  onHover: () => {},
  onDrop: (i, r, c) => doPlace(i, r, c),
  onCancel: (i, why) => {
    state.log.push(['cancel', i, why]);
    scheduleHint();
  },
  onTapCell: (r, c) => useHammer(r, c),
});

// ---------------------------------------------------------------------------------------------
// Game flow (a miniature of the UI's game controller)
// ---------------------------------------------------------------------------------------------

function doPlace(i, r, c) {
  const s = state.session;
  const res = s.placePiece(i, r, c);
  if (!res) return false;
  state.log.push(['place', i, r, c, res.linesCount]);
  updateHud();
  const anim = renderer.animatePlace(res);
  if (res.trayRefilled) renderer.animateTrayRefill();
  if (res.newBest) renderer.celebrate('newBest');
  if (s.mode === 'tutorial') {
    const step = res.tutorialStep;
    const advanced = step && typeof step === 'object' ? step.done && step.hasNext : res.trayRefilled;
    if (res.status === 'won') {
      state.busy = true;
      anim.then(() => renderer.celebrate('win')).then(() => { state.busy = false; });
    } else if (advanced) {
      state.busy = true;
      anim.then(() => {
        if (typeof s.nextTutorialStep === 'function' && step && typeof step === 'object') s.nextTutorialStep();
        renderer.sync();
        state.busy = false;
        scheduleHint(400);
      });
    } else scheduleHint();
    return true;
  }
  if (res.status === 'won') {
    state.busy = true;
    anim.then(() => renderer.celebrate('win')).then(() => { state.busy = false; });
  } else if (res.status === 'over') {
    state.busy = true;
    anim.then(() => renderer.animateGameOver()).then(() => { state.busy = false; });
  }
  return true;
}

function revive() {
  const s = state.session;
  if (!s || !s.canRevive()) return null;
  const rr = s.revive();
  renderer.animateRevive(rr);
  updateHud();
  return rr;
}

function useHammer(r, c) {
  const s = state.session;
  const br = s && s.useHammer(r, c);
  if (!br) return null;
  renderer.setTargetMode(null);
  renderer.animateBlast(br);
  updateHud();
  return br;
}

function shuffle() {
  const s = state.session;
  const res = s && s.useShuffle();
  if (res) renderer.animateShuffle();
  return res;
}

function scheduleHint(ms = 1500) {
  clearTimeout(state.hintTimer);
  const s = state.session;
  if (!s || s.mode !== 'tutorial') return;
  state.hintTimer = setTimeout(() => {
    const h = s.status === 'playing' ? s.tutorialHint() : null;
    if (h) renderer.showHint(h);
  }, ms);
}

function updateHud() {
  const s = state.session;
  if (!s) return;
  document.getElementById('score').textContent = s.score;
  document.getElementById('best').textContent = Math.max(BEST, s.score);
  const gk = document.getElementById('goalsK');
  const gv = document.getElementById('goals');
  if (s.goals && s.goals.gems) {
    gk.textContent = 'Gems';
    gv.textContent = Object.entries(s.goals.gems).map(([k, g]) => `${['', '◆', '★', '♥'][k]}${g.need - g.have}`).join(' ');
  } else {
    gk.textContent = 'Combo';
    gv.textContent = s.combo >= 2 ? `x${s.combo}` : '–';
  }
}

function applyTheme(id) {
  state.theme = id;
  const th = getTheme(id);
  const vars = themeCssVars(th);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  renderer.setTheme(th);
}

// ---------------------------------------------------------------------------------------------
// Scenario staging
// ---------------------------------------------------------------------------------------------

const GEM_CODES = { d: 1, s: 2, h: 3 };

/** Writes a board from 8 strings ('.' empty, '0'-'7' color) + optional gem strings ('d','s','h'). */
function setBoard(s, rows, gems) {
  const b = s.board;
  b.cells.fill(0);
  b.gems.fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < 8; c++) if (row[c] !== '.') b.cells[r * 8 + c] = Number(row[c]) + 1;
  });
  if (gems) {
    gems.forEach((row, r) => {
      for (let c = 0; c < 8; c++) {
        const g = GEM_CODES[row[c]];
        if (g && b.cells[r * 8 + c]) b.gems[r * 8 + c] = g;
      }
    });
  }
}

let uid = 9000;
function setTray(s, pieces) {
  s.tray = pieces.map((p) => (p ? { uid: uid++, shapeId: p[0], color: p[1] } : null));
}

function newSession(mode = 'classic', extra = {}) {
  const opts = { mode, seed: SEED, bestScore: BEST, gamesPlayed: 5, ...extra };
  if ((mode === 'journey' || mode === 'daily') && !opts.level) opts.level = generateLevel(7);
  return GameSession.create(opts);
}

function use(session) {
  state.session = session;
  state.busy = false;
  clearTimeout(state.hintTimer);
  renderer.freeze(false);
  renderer.setSession(session);
  updateHud();
}

/** Pins the clock and steps it deterministically (for screenshots). */
function still(ms) {
  renderer.freeze(true);
  renderer.advance(ms);
}

const BOARDS = {
  mid: [
    '........',
    '.....33.',
    '0...333.',
    '00..1...',
    '002211..',
    '.62277..',
    '.6..7744',
    '55..7.44',
  ],
  hover: [
    '.....4..',
    '.....4..',
    '....34..',
    '...334..',
    '1....6..',
    '11...6.2',
    '0112..52',
    '00.3.655',
  ],
  combo: [
    '..0662..',
    '...51...',
    '.4.55.7.',
    '44.24.77',
    '1..24.6.',
    '1.233.66',
    '0101..23',
    '7777..33',
  ],
  heavy: [
    '0..124.3',
    '0..567.3',
    '...012..',
    '6..345.1',
    '66.670.1',
    '012...54',
    '765...32',
    '444...11',
  ],
  heavyGems: [
    '........',
    '...d....',
    '........',
    '.....s..',
    '........',
    'h......d',
    '.s......',
    '......h.',
  ],
  gameover: [
    '01122.33',
    '0.4425.3',
    '66.4..77',
    '1.33.5.7',
    '11.2205.',
    '4.62..00',
    '44.6.1.0',
    '5556.11.',
  ],
  dim: [
    '0.11..2.',
    '0..1.22.',
    '33....4.',
    '.3.55.4.',
    '6..5..77',
    '66.0...7',
    '.1.00.5.',
    '11..555.',
  ],
};

const SCENARIOS = {
  /** Fresh classic run (playable). */
  start() {
    use(newSession());
    renderer.animateTrayRefill();
  },
  /** Mid-game board (playable). */
  mid() {
    const s = newSession();
    setBoard(s, BOARDS.mid);
    setTray(s, [['T4b', 2], ['L3a', 5], ['I4h', 6]]);
    s.score = 640;
    use(s);
  },
  /** A piece hovering where it completes a row and a column (frozen). */
  hover() {
    const s = newSession();
    setBoard(s, BOARDS.hover);
    setTray(s, [['I2h', 1], ['O2', 5], ['L4b', 3]]);
    s.score = 880;
    use(s);
    hoverAt(0, 6, 4);
    still(260);
  },
  /** 4-line clear with combo x5, frozen mid-burst. */
  clear(opts = {}) {
    const s = newSession('classic', { bestScore: 99999 });
    setBoard(s, BOARDS.combo);
    setTray(s, [['O2', 3], ['I3v', 6], ['T4a', 0]]);
    s.score = 2140;
    s.combo = 4;
    s.movesSinceClear = 0;
    use(s);
    renderer.freeze(true);
    doPlace(0, 6, 4);
    renderer.advance(opts.at ?? 170);
  },
  /** Game over sequence finished (grey board + 'No space!'). */
  gameover() {
    const s = newSession();
    setBoard(s, BOARDS.gameover);
    setTray(s, [['O3', 2], ['I4h', 4], ['L5c', 6]]);
    s.score = 1320;
    s.status = 'over';
    use(s);
    renderer.freeze(true);
    renderer.animateGameOver();
    renderer.advance(980);
  },
  /** Journey level with gems (playable). */
  journey() {
    use(newSession('journey', { level: generateLevel(7) }));
  },
  /** Tutorial hand hint mid-move (frozen). */
  tutorial() {
    use(newSession('tutorial'));
    renderer.showHint(state.session.tutorialHint());
    still(800);
  },
  /** Hammer target mode with the 3x3 highlight (frozen). */
  hammer() {
    use(newSession('journey', { level: generateLevel(12) }));
    renderer.setTargetMode('hammer');
    renderer.setTargetCell(3, 4);
    still(120);
  },
  /** All-clear celebration (frozen). */
  allclear() {
    const s = newSession();
    setBoard(s, ['........', '........', '........', '........', '........', '........', '........', '01234...']);
    setTray(s, [['I3h', 5], ['O2', 2], null]);
    s.combo = 1;
    s.score = 410;
    use(s);
    renderer.freeze(true);
    doPlace(0, 7, 5);
    renderer.advance(300);
  },
  /** New-best banner + confetti (frozen). */
  newbest() {
    SCENARIOS.mid();
    renderer.freeze(true);
    renderer.celebrate('newBest');
    renderer.advance(420);
  },
  /** Pieces that fit nowhere are dimmed (playable). */
  dim() {
    const s = newSession();
    setBoard(s, BOARDS.dim);
    setTray(s, [['O3', 0], ['I2v', 4], ['I5h', 6]]);
    s.score = 990;
    use(s);
  },
  /** Shuffle booster mid-animation (frozen). */
  shuffle() {
    use(newSession('journey', { level: generateLevel(9) }));
    renderer.freeze(true);
    shuffle();
    renderer.advance(230);
  },
  /** Revive blast mid-animation (frozen). */
  revive() {
    SCENARIOS.gameover();
    renderer.freeze(true);
    state.session.reviveUsed = false;
    revive();
    renderer.advance(200);
  },
  /** Empty board, tray O3 / I5h / I1 – for e2e drags (playable). */
  droptest() {
    const s = newSession();
    setBoard(s, ['........', '........', '........', '........', '........', '........', '........', '........']);
    setTray(s, [['O3', 3], ['I5h', 4], ['I1', 0]]);
    s.status = 'playing';
    use(s);
  },
};

/** Shows tray piece i hovering with its snap at (r, c) like a real drag would. */
function hoverAt(i, r, c) {
  const s = state.session;
  if (i === null || i === undefined) {
    renderer.setDrag(null);
    return null;
  }
  const L = renderer.layout;
  const pv = s.preview(i, r, c);
  const d = {
    trayIndex: i,
    x: L.boardX + (c + 0.28) * L.cell,
    y: L.boardY + (r - 0.42) * L.cell,
    snap: pv.valid ? { r, c } : null,
    rows: pv.rows,
    cols: pv.cols,
  };
  renderer.setDrag(d);
  return pv;
}

/** Repeated heavy 6-line clears with gems for frame-time measurement. */
async function perfRun({ clears = 10, interval = 380, autoDpr = false } = {}) {
  const s = newSession();
  use(s);
  renderer.autoDpr = autoDpr;
  await new Promise((r) => setTimeout(r, 300));
  const perf = renderer.perf;
  perf.n = 0;
  perf.enabled = true;
  for (let k = 0; k < clears; k++) {
    setBoard(s, BOARDS.heavy, BOARDS.heavyGems);
    setTray(s, [['O3', k % 8], ['I3v', 6], ['T4a', 0]]);
    s.status = 'playing';
    s.combo = 3;
    s.movesSinceClear = 0;
    doPlace(0, 5, 3);
    await new Promise((r) => setTimeout(r, interval));
  }
  await new Promise((r) => setTimeout(r, 900));
  perf.enabled = false;
  const n = Math.min(perf.n, perf.work.length);
  const work = Array.from(perf.work.slice(0, n)).sort((a, b) => a - b);
  const iv = Array.from(perf.interval.slice(0, n)).sort((a, b) => a - b);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
  return {
    frames: n,
    dpr: renderer.dpr,
    avgInterval: +avg(iv).toFixed(2),
    p95Interval: +pct(iv, 0.95).toFixed(2),
    avgWork: +avg(work).toFixed(2),
    p95Work: +pct(work, 0.95).toFixed(2),
    maxWork: +(work[work.length - 1] || 0).toFixed(2),
  };
}

// ---------------------------------------------------------------------------------------------
// Debug / test API
// ---------------------------------------------------------------------------------------------

function canvasOrigin() {
  const r = canvas.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

window.__sandbox = {
  isReady: false,
  renderer,
  /** the DragController (`drag` below is the hover helper of the debug API) */
  dragController: drag,
  get session() { return state.session; },
  get log() { return state.log; },
  themes: THEME_IDS.slice(),
  scenarios: Object.keys(SCENARIOS),
  /** @returns {Object} plain snapshot of session + layout */
  state() {
    const s = state.session;
    const L = renderer.layout;
    return {
      theme: state.theme,
      dpr: renderer.dpr,
      canvas: { w: canvas.width, h: canvas.height, cssW: L.width, cssH: L.height },
      layout: { cell: L.cell, boardX: L.boardX, boardY: L.boardY, boardPx: L.boardPx, trayCell: L.trayCell,
        trayRects: L.trayRects, landscape: L.landscape, gutter: L.gutter, marginL: L.marginL, marginR: L.marginR },
      session: s && {
        mode: s.mode, status: s.status, score: s.score, combo: s.combo,
        board: Array.from(s.board.cells), gems: Array.from(s.board.gems),
        tray: s.tray.map((p) => (p ? { shapeId: p.shapeId, color: p.color } : null)),
      },
      busy: state.busy,
    };
  },
  place: (i, r, c) => {
    const ok = doPlace(i, r, c);
    return { placed: ok, score: state.session.score, status: state.session.status };
  },
  drag: (i, r, c) => hoverAt(i, r, c),
  freeze: (on) => renderer.freeze(on),
  advance: (ms) => renderer.advance(ms),
  setTimeScale: (x) => { renderer.timeScale = x; },
  setTheme: (id) => applyTheme(id),
  scenario: (name, opts) => {
    state.scenario = name;
    renderer.timeScale = 1;
    SCENARIOS[name](opts || {});
    return name;
  },
  validMoves: () => listValidMoves(state.session),
  revive,
  hammer: useHammer,
  shuffle,
  /** Page coordinates for a real drag of tray piece i onto (r, c). */
  pointerFor(i, r, c) {
    const o = canvasOrigin();
    const L = renderer.layout;
    const p = state.session.tray[i];
    const shape = getShape(p.shapeId);
    const R = L.trayRects[i];
    const end = pointerForCell(L, L.height, shape, r, c);
    return { start: { x: o.x + R.x + R.w / 2, y: o.y + R.y + R.h / 2 }, end: { x: o.x + end.x, y: o.y + end.y } };
  },
  trayIndexAt: (x, y) => renderer.trayIndexAt(x, y),
  cellAt: (x, y) => renderer.cellAt(x, y),
  perfRun,
};

// keyboard shortcuts for manual testing
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '6') applyTheme(THEME_IDS[Number(k) - 1]);
  else if (k === 'n') SCENARIOS.start();
  else if (k === 'r') { if (!revive()) SCENARIOS.start(); }
  else if (k === 'h') renderer.setTargetMode(renderer.targetMode ? null : 'hammer');
  else if (k === 's') shuffle();
  else if (k === 'f') renderer.freeze(!renderer._frozen);
  else if (k === 't') { SCENARIOS.tutorial(); renderer.freeze(false); }
});

// optional on-screen buttons (?ui=1)
const tools = document.getElementById('tools');
for (const name of Object.keys(SCENARIOS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => window.__sandbox.scenario(name);
  tools.appendChild(b);
}
for (const id of THEME_IDS) {
  const b = document.createElement('button');
  b.textContent = id;
  b.onclick = () => applyTheme(id);
  tools.appendChild(b);
}

// boot (no top-level await: same baseline as the game)
applyTheme(state.theme);
renderer.start();
renderer.ready.then(() => {
  renderer.resize();
  (SCENARIOS[state.scenario] || SCENARIOS.start)();
  window.__sandbox.isReady = true;
});
