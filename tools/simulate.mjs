// Balancing simulator: a heuristic bot plays classic runs, journey levels and daily challenges
// and reports the numbers used to tune js/core/generator.js and js/core/levels.js.
//
// Usage: node tools/simulate.mjs [--runs=200] [--levels=100] [--attempts=8] [--days=30]
//          [--start=2026-10-01] [--seed=1] [--bot=greedy|planner] [--experience=10]
//          [--config='{"RAW_P_MAX":0.15}']   (JSON merged over CONFIG.GENERATOR to try tunings)
//
// Bots (same priorities: points from line clears/gems ≫ remaining pieces still fit ≫ few isolated
// holes ≫ smooth surface ≫ room for big pieces ≫ open centre):
//   greedy  (default, the balancing reference ≈ a casual/decent player): best single placement.
//   planner (≈ a strong player): plans the whole tray with a small beam search over piece orders
//           and positions, then plays that plan.

import { GameSession } from '../game/js/core/game.js';
import { Board } from '../game/js/core/board.js';
import { getShape } from '../game/js/core/shapes.js';
import { analyzeTray, PieceGenerator } from '../game/js/core/generator.js';
import { generateLevel, generateDailyLevel, levelKind } from '../game/js/core/levels.js';
import { hashString } from '../game/js/core/rng.js';
import { clearPoints } from '../game/js/core/scoring.js';
import { CONFIG } from '../game/js/config.js';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const RUNS = Number(args.runs || 200);
const LEVELS = Number(args.levels || 100);
const ATTEMPTS = Number(args.attempts || 8);
const DAYS = Number(args.days || 30);
const START_DAY = String(args.start || '2026-10-01');
const BASE_SEED = Number(args.seed || 1);
const BOT = String(args.bot || 'greedy');
const EXPERIENCE = Number(args.experience ?? 10);
const GEN_CONFIG = args.config ? Object.freeze({ ...CONFIG.GENERATOR, ...JSON.parse(args.config) }) : CONFIG.GENERATOR;
const BEAM_WIDTH = 6;
const MAX_TRAYS = 1000; // safety cap for endless classic runs

const N = 8;
const BIG_SHAPES = ['O3', 'I5h', 'I5v'].map(getShape);
const scratch = new Board(N);

// ---------------------------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------------------------

/**
 * Board quality after a move (higher = better).
 * @param {Board} b
 * @param {Array<import('../game/js/core/shapes.js').Shape>} remaining shapes still in the tray
 */
function evaluateBoard(b, remaining) {
  const cells = b.cells;
  let holes = 0;
  let borders = 0;
  let centre = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const filled = cells[r * N + c] !== 0;
      if (c < N - 1 && filled !== (cells[r * N + c + 1] !== 0)) borders++;
      if (r < N - 1 && filled !== (cells[(r + 1) * N + c] !== 0)) borders++;
      if (filled) {
        if (r >= 2 && r <= 5 && c >= 2 && c <= 5) centre++;
        continue;
      }
      const blocked = (rr, cc) => rr < 0 || cc < 0 || rr >= N || cc >= N || cells[rr * N + cc] !== 0;
      if (blocked(r - 1, c) && blocked(r + 1, c) && blocked(r, c - 1) && blocked(r, c + 1)) holes++;
    }
  }
  let unplaceable = 0;
  for (const s of remaining) if (!b.anyPlacement(s)) unplaceable++;
  let bigFits = 0;
  for (const s of BIG_SHAPES) if (b.anyPlacement(s)) bigFits++;
  return -unplaceable * 1000 - holes * 40 - borders * 3 + bigFits * 15 - centre * 2;
}

/**
 * Applies a placement to `board` (mutating) and returns the immediate reward.
 * @param {Board} board
 * @param {import('../game/js/core/shapes.js').Shape} shape
 * @param {number} r
 * @param {number} c
 * @param {{ combo: number, movesSinceClear: number }} state combo state (mutated)
 */
function applyMove(board, shape, r, c, state) {
  board.place(shape, r, c, 0);
  const { rows, cols } = board.findFullLines();
  const lines = rows.length + cols.length;
  const { gems } = board.clearLines(rows, cols);
  let reward = shape.size + (gems[1] + gems[2] + gems[3]) * 150;
  if (lines > 0) {
    state.combo++;
    state.movesSinceClear = 0;
    reward += clearPoints(lines, state.combo) + (board.isBoardEmpty() ? CONFIG.SCORING.ALL_CLEAR_BONUS : 0);
  } else if (++state.movesSinceClear >= CONFIG.SCORING.COMBO_KEEP_MOVES) {
    state.combo = 0;
  }
  return reward;
}

/**
 * Greedy bot: the best single placement for the current board.
 * @param {GameSession} session
 * @returns {{ trayIndex: number, r: number, c: number } | null}
 */
function greedyMove(session) {
  let best = null;
  let bestValue = -Infinity;
  const tray = session.tray;
  for (let t = 0; t < tray.length; t++) {
    if (!tray[t]) continue;
    const shape = getShape(tray[t].shapeId);
    const remaining = [];
    for (let u = 0; u < tray.length; u++) if (u !== t && tray[u]) remaining.push(getShape(tray[u].shapeId));
    for (const [r, c] of session.board.placements(shape)) {
      scratch.cells.set(session.board.cells);
      scratch.gems.set(session.board.gems);
      const reward = applyMove(scratch, shape, r, c, { combo: session.combo, movesSinceClear: session.movesSinceClear });
      const value = reward + evaluateBoard(scratch, remaining);
      if (value > bestValue) {
        bestValue = value;
        best = { trayIndex: t, r, c };
      }
    }
  }
  return best;
}

/**
 * Planner bot: beam search over the remaining tray pieces (orders and positions).
 * @param {GameSession} session
 * @returns {Array<{ trayIndex: number, r: number, c: number }>} planned moves (may be shorter
 *   than the tray if no complete sequence exists)
 */
function planTray(session) {
  const slots = [];
  session.tray.forEach((p, i) => { if (p) slots.push({ trayIndex: i, shape: getShape(p.shapeId) }); });
  let beam = [{ board: session.board, used: 0, reward: 0, combo: session.combo, movesSinceClear: session.movesSinceClear, moves: [], value: 0 }];
  let best = null;
  for (let depth = 0; depth < slots.length; depth++) {
    const next = [];
    for (const st of beam) {
      const seen = new Set();
      for (let k = 0; k < slots.length; k++) {
        if (st.used & (1 << k) || seen.has(slots[k].shape.id)) continue;
        seen.add(slots[k].shape.id);
        const remaining = slots.filter((_, j) => j !== k && !(st.used & (1 << j))).map((x) => x.shape);
        for (const [r, c] of st.board.placements(slots[k].shape)) {
          const board = st.board.clone();
          const combo = { combo: st.combo, movesSinceClear: st.movesSinceClear };
          const reward = st.reward + applyMove(board, slots[k].shape, r, c, combo);
          next.push({
            board, used: st.used | (1 << k), reward, ...combo,
            moves: [...st.moves, { trayIndex: slots[k].trayIndex, r, c }],
            value: reward + evaluateBoard(board, remaining),
          });
        }
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.value - a.value);
    beam = next.slice(0, BEAM_WIDTH);
    best = beam[0];
  }
  return best ? best.moves : [];
}

/**
 * Plays a session to its end (or MAX_TRAYS) with a bot. Exported for the unit tests.
 * @param {GameSession} session
 * @param {{ revive?: boolean, onTray?: Function, onPlace?: Function, bot?: 'planner'|'greedy', maxTrays?: number }} [opts]
 *   revive: use the revive once on game over; onTray(session) after every new tray;
 *   onPlace(result, session) after every placement; stops at trayIndex >= maxTrays
 */
export function playOut(session, { revive = false, onTray, onPlace, bot = BOT, maxTrays = MAX_TRAYS } = {}) {
  let plan = [];
  if (onTray) onTray(session);
  while (session.trayIndex < maxTrays) {
    if (session.status === 'over' && revive && session.canRevive()) {
      session.revive();
      plan = [];
      if (onTray) onTray(session);
      continue;
    }
    if (session.status !== 'playing') break;
    if (bot === 'greedy') plan = [greedyMove(session)];
    else if (plan.length === 0) plan = planTray(session);
    // A partial plan (no complete sequence found) is played as far as it goes, then greedily.
    const move = plan.shift() || greedyMove(session);
    const res = session.placePiece(move.trayIndex, move.r, move.c);
    if (onPlace) onPlace(res, session);
    if (res.trayRefilled) {
      plan = [];
      if (onTray) onTray(session);
    }
  }
  return session;
}

// ---------------------------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------------------------

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

function addDays(dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Wraps a session's generator so that nextTray timings are recorded. */
function timeGenerator(session, times) {
  const gen = session.generator;
  const original = gen.nextTray.bind(gen);
  gen.nextTray = (board, ctx) => {
    const t0 = performance.now();
    const tray = original(board, ctx);
    times.push(performance.now() - t0);
    return tray;
  };
}

// ---------------------------------------------------------------------------------------------
// Classic
// ---------------------------------------------------------------------------------------------

/**
 * A session whose generator uses GEN_CONFIG (the first tray is already dealt with CONFIG).
 * @param {Object} opts GameSession.create options
 */
function createSession(opts) {
  const session = GameSession.create(opts);
  if (GEN_CONFIG !== CONFIG.GENERATOR) {
    session.generator = Object.assign(new PieceGenerator({ rng: session.rng, mode: session.mode, config: GEN_CONFIG }),
      { uid: session.generator.uid });
  }
  return session;
}

function simulateClassic() {
  const PHASES = [[1, 8], [9, 20], [21, 40], [41, Infinity]];
  const phaseTrays = PHASES.map(() => 0);
  const phaseUnsolvable = PHASES.map(() => 0);
  const trays = [];
  const placements = [];
  const scores = [];
  const genTimes = [];
  let clearMoves = 0;
  let multiMoves = 0;
  let earlyClearMoves = 0;
  let earlyMultiMoves = 0;
  let earlyGameOvers = 0;
  let capped = 0;
  let earlyTrays = 0;
  let earlyMultiTrays = 0;

  for (let i = 0; i < RUNS; i++) {
    const session = createSession({ mode: 'classic', seed: hashString(`classic-${BASE_SEED}-${i}`), gamesPlayed: EXPERIENCE });
    timeGenerator(session, genTimes);
    playOut(session, {
      onTray(s) {
        const shapes = s.tray.filter(Boolean).map((p) => getShape(p.shapeId));
        const n = s.trayIndex + 1;
        const phase = PHASES.findIndex(([a, b]) => n >= a && n <= b);
        phaseTrays[phase]++;
        if (!analyzeTray(s.board, shapes, { nodeLimit: 300000, targetLines: 0 }).solvable) phaseUnsolvable[phase]++;
        if (n <= 20) {
          earlyTrays++;
          if (analyzeTray(s.board, shapes, { nodeLimit: 300000, targetLines: 0, targetSingle: 2 }).maxSingle >= 2) earlyMultiTrays++;
        }
      },
      onPlace(res, s) {
        if (res.linesCount === 0) return;
        clearMoves++;
        if (res.linesCount >= 2) multiMoves++;
        if (s.trayIndex < 20) {
          earlyClearMoves++;
          if (res.linesCount >= 2) earlyMultiMoves++;
        }
      },
    });
    if (session.trayIndex >= MAX_TRAYS) capped++;
    if (session.status === 'over' && session.trayIndex < GEN_CONFIG.EARLY_TRAYS) earlyGameOvers++;
    trays.push(session.trayIndex + 1);
    placements.push(session.piecesPlaced);
    scores.push(session.score);
  }
  trays.sort((a, b) => a - b);
  placements.sort((a, b) => a - b);
  genTimes.sort((a, b) => a - b);
  const totalTrays = trays.reduce((a, b) => a + b, 0);

  console.log(`\n=== Classic: ${RUNS} runs (${BOT} bot, experience ${EXPERIENCE}) ===`);
  console.log(`trays/run       p10 ${quantile(trays, 0.1)}  median ${quantile(trays, 0.5)}  p90 ${quantile(trays, 0.9)}`);
  console.log(`placements/run  p10 ${quantile(placements, 0.1)}  median ${quantile(placements, 0.5)}  p90 ${quantile(placements, 0.9)}`);
  console.log(`score           avg ${fmt(mean(scores), 0)}  median ${quantile(scores.slice().sort((a, b) => a - b), 0.5)}`);
  console.log(`game over within the first ${GEN_CONFIG.EARLY_TRAYS} trays: ${earlyGameOvers} runs; capped at ${MAX_TRAYS} trays: ${capped}`);
  console.log('unsolvable trays at deal time by phase:');
  PHASES.forEach(([a, b], k) => {
    console.log(`  trays ${String(a).padStart(2)}–${b === Infinity ? '∞ ' : String(b).padEnd(2)}  ${pct(phaseUnsolvable[k], phaseTrays[k]).padStart(6)}  (${phaseUnsolvable[k]}/${phaseTrays[k]})`);
  });
  console.log(`clearing moves per tray ${fmt(clearMoves / totalTrays, 2)}`);
  console.log(`multi-line clears (>=2 lines): ${pct(multiMoves, clearMoves)} of clearing moves overall, ${pct(earlyMultiMoves, earlyClearMoves)} in trays 1–20`);
  console.log(`trays 1–20 that offer a multi-line clear: ${pct(earlyMultiTrays, earlyTrays)}`);
  console.log(`nextTray time   avg ${fmt(mean(genTimes), 3)} ms  p95 ${fmt(quantile(genTimes, 0.95), 3)} ms  p99 ${fmt(quantile(genTimes, 0.99), 3)} ms  max ${fmt(genTimes[genTimes.length - 1], 2)} ms`);
}

// ---------------------------------------------------------------------------------------------
// Journey & daily
// ---------------------------------------------------------------------------------------------

/**
 * Plays a level `attempts` times with different seeds; each attempt may use one revive.
 * `firstTry` = won without the revive.
 * @returns {Array<{ won: boolean, firstTry: boolean, pieces: number, stars: number }>}
 */
function playLevel(level, mode, attempts) {
  const out = [];
  for (let a = 0; a < attempts; a++) {
    const session = createSession({ mode, level, seed: hashString(`${level.id}-${BASE_SEED}-${a}`), gamesPlayed: EXPERIENCE });
    playOut(session, { revive: true });
    const won = session.status === 'won';
    out.push({ won, firstTry: won && !session.reviveUsed, pieces: session.piecesPlaced, stars: session.stars() });
  }
  return out;
}

function summarizeLevels(title, entries) {
  const results = entries.flatMap((e) => e.results.map((r) => ({ ...r, level: e.level })));
  if (results.length === 0) return;
  const won = results.filter((r) => r.won);
  const stars = [0, 0, 0, 0];
  for (const r of won) stars[r.stars]++;
  const ratio = won.map((r) => r.pieces / r.level.par[0]).sort((a, b) => a - b);
  console.log(`${title.padEnd(16)} first try ${pct(results.filter((r) => r.firstTry).length, results.length).padStart(6)}   with revive ${pct(won.length, results.length).padStart(6)}   (${results.length} attempts)`);
  console.log(`${''.padEnd(16)} pieces avg ${fmt(mean(won.map((r) => r.pieces)))} vs par3 ${fmt(mean(won.map((r) => r.level.par[0])))} / par2 ${fmt(mean(won.map((r) => r.level.par[1])))} (median pieces/par3 ${fmt(quantile(ratio, 0.5), 2)});  stars 3★ ${pct(stars[3], won.length)} 2★ ${pct(stars[2], won.length)} 1★ ${pct(stars[1], won.length)}`);
}

function simulateJourney() {
  console.log(`\n=== Journey levels 1–${LEVELS} (${ATTEMPTS} attempts each; first try = no revive) ===`);
  console.log('targets (first try): 1–9 ≥ 95 %, normal 80–92 %, hard 55–75 %, super hard 35–55 %; 3★ in ~30–50 %');
  const entries = [];
  for (let n = 1; n <= LEVELS; n++) {
    const level = generateLevel(n);
    entries.push({ level, results: playLevel(level, 'journey', ATTEMPTS) });
  }
  summarizeLevels('levels 1–9', entries.filter((e) => e.level.number <= 9));
  summarizeLevels('normal (10+)', entries.filter((e) => e.level.number >= 10 && levelKind(e.level.number) === 'normal'));
  summarizeLevels('hard', entries.filter((e) => levelKind(e.level.number) === 'hard'));
  summarizeLevels('super hard', entries.filter((e) => levelKind(e.level.number) === 'superhard'));
  summarizeLevels('all', entries);
  console.log('  per level [tag difficulty: first-try wins/attempts, avg pieces of wins | par3/par2]:');
  for (let k = 0; k < entries.length; k += 5) {
    console.log('   ' + entries.slice(k, k + 5).map(({ level, results }) => {
      const w = results.filter((r) => r.won);
      return `${level.id.padEnd(4)}${level.tag[0]}${level.difficulty.toFixed(2)} ${results.filter((r) => r.firstTry).length}/${results.length} ${fmt(mean(w.map((r) => r.pieces)), 0).padStart(3)}|${level.par[0]}/${level.par[1]}`;
    }).join('  '));
  }
}

function simulateDaily() {
  console.log(`\n=== Daily challenges: ${DAYS} days from ${START_DAY} (${ATTEMPTS} attempts each) ===`);
  const entries = [];
  for (let d = 0; d < DAYS; d++) {
    const level = generateDailyLevel(addDays(START_DAY, d));
    entries.push({ level, results: playLevel(level, 'daily', ATTEMPTS) });
  }
  summarizeLevels('daily', entries);
  const failed = entries.filter((e) => e.results.some((r) => !r.firstTry)).map((e) => `${e.level.id}(${e.results.filter((r) => r.firstTry).length}/${e.results.length}, goal ${e.level.goals.score})`);
  if (failed.length) console.log(`  days with failed first tries: ${failed.join(' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t0 = performance.now();
  if (GEN_CONFIG !== CONFIG.GENERATOR) console.log('generator config override:', args.config);
  if (RUNS > 0) simulateClassic();
  if (LEVELS > 0) simulateJourney();
  if (DAYS > 0) simulateDaily();
  console.log(`\n(simulation took ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
