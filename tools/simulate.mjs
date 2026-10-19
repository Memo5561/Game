// Balancing simulator: a heuristic bot plays classic runs, journey levels and daily challenges
// and reports the numbers used to tune js/core/generator.js and js/core/levels.js.
//
// Usage: node tools/simulate.mjs [--runs=200] [--levels=100] [--attempts=8] [--days=30]
//          [--start=2026-10-01] [--seed=1] [--bot=greedy|planner] [--experience=10]
//          [--config='{"RAW_P_MAX":0.15}']   (JSON merged over CONFIG.GENERATOR to try tunings)
//        node tools/simulate.mjs --assist [--runs=300] [--seed=1] [--experience=10] [--bots=greedy,planner]
//          [--config='{"ASSIST":{...}}']     (near-record assist: record-break rate with vs. without, see simulateAssist)
//        node tools/simulate.mjs --economy [--days=30] [--players=3] [--profiles=casual,engaged,strong]
//          [--ads=both|0|1] [--seed=1]       (coin economy of whole play days, see simulateEconomy)
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
import { Progression, dayKey } from '../game/js/meta/progression.js';
import { defaultSave } from '../game/js/meta/storage.js';
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
function createSession(opts, genConfig = GEN_CONFIG) {
  const session = GameSession.create(opts);
  if (genConfig !== CONFIG.GENERATOR) {
    session.generator = Object.assign(new PieceGenerator({ rng: session.rng, mode: session.mode, config: genConfig }),
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
  let phaseClearMoves = 0;
  let phaseMultiMoves = 0;
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
        // trayIndex is already the next tray when this placement emptied the tray
        const tray = res.trayRefilled ? s.trayIndex - 1 : s.trayIndex;
        if (tray < 20) {
          earlyClearMoves++;
          if (res.linesCount >= 2) earlyMultiMoves++;
        }
        if (tray < GEN_CONFIG.EARLY_TRAYS) {
          phaseClearMoves++;
          if (res.linesCount >= 2) phaseMultiMoves++;
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
  console.log(`multi-line clears (>=2 lines): ${pct(phaseMultiMoves, phaseClearMoves)} of clearing moves in the early phase (trays 1–${GEN_CONFIG.EARLY_TRAYS}), ${pct(earlyMultiMoves, earlyClearMoves)} in trays 1–20, ${pct(multiMoves, clearMoves)} overall`);
  console.log(`trays 1–20 that offer a multi-line clear: ${pct(earlyMultiTrays, earlyTrays)}`);
  console.log(`nextTray time   avg ${fmt(mean(genTimes), 3)} ms  p95 ${fmt(quantile(genTimes, 0.95), 3)} ms  p99 ${fmt(quantile(genTimes, 0.99), 3)} ms  max ${fmt(genTimes[genTimes.length - 1], 2)} ms`);
}

// ---------------------------------------------------------------------------------------------
// Near-record assist (--assist)
// ---------------------------------------------------------------------------------------------

/**
 * Per bot: a batch of plain runs gives the median score M; then the SAME seeds are played again
 * with best = M, once without assist (NEAR_RECORD_P = 0) and once with the configured assist. The
 * seeds are shared, so the runs are identical until the score first reaches NEAR_RECORD_FROM × M.
 * Reports how often the record (score > M) is broken and that the game does not become endless.
 */
function simulateAssist() {
  const bots = String(args.bots || 'greedy,planner').split(',');
  const off = Object.freeze({ ...GEN_CONFIG, ASSIST: Object.freeze({ ...GEN_CONFIG.ASSIST, NEAR_RECORD_P: 0 }) });
  const a = GEN_CONFIG.ASSIST;
  console.log(`\n=== Near-record assist: ${RUNS} paired runs per bot (experience ${EXPERIENCE}); FROM ${a.NEAR_RECORD_FROM}, P ${a.NEAR_RECORD_P}, MIN_BEST ${a.MIN_BEST} ===`);
  for (const bot of bots) {
    const base = [];
    for (let i = 0; i < RUNS; i++) {
      const s = createSession({ mode: 'classic', seed: hashString(`assist-base-${BASE_SEED}-${i}`), gamesPlayed: EXPERIENCE });
      playOut(s, { bot });
      base.push(s.score);
    }
    const sorted = base.slice().sort((x, y) => x - y);
    const best = Math.max(quantile(sorted, 0.5), 1);
    const run = (cfg) => {
      let broke = 0;
      let nearRuns = 0;
      const trays = [];
      const scores = [];
      for (let i = 0; i < RUNS; i++) {
        const s = createSession({ mode: 'classic', seed: hashString(`assist-test-${BASE_SEED}-${i}`), gamesPlayed: EXPERIENCE, bestScore: best }, cfg);
        let near = false;
        playOut(s, { bot, onPlace: (res, sess) => { if (sess.isNearRecord()) near = true; } });
        if (s.score > best) broke++;
        if (near) nearRuns++;
        trays.push(s.trayIndex + 1);
        scores.push(s.score);
      }
      trays.sort((x, y) => x - y);
      scores.sort((x, y) => x - y);
      return { broke, nearRuns, trays, scores };
    };
    const without = run(off);
    const withAssist = run(GEN_CONFIG);
    const rate = (r) => (100 * r.broke) / RUNS;
    console.log(`\n${bot} bot, record to beat M = ${best} (median of ${RUNS} plain runs)`);
    console.log('                     record broken   reached assist zone   trays p10 / median / p90   score median');
    for (const [name, r] of [['without assist', without], ['with assist   ', withAssist]]) {
      console.log(`  ${name}   ${pct(r.broke, RUNS).padStart(7)}        ${pct(r.nearRuns, RUNS).padStart(7)}            ${quantile(r.trays, 0.1)} / ${quantile(r.trays, 0.5)} / ${quantile(r.trays, 0.9)}              ${quantile(r.scores, 0.5)}`);
    }
    console.log(`  difference: ${rate(withAssist) - rate(without) >= 0 ? '+' : ''}${fmt(rate(withAssist) - rate(without), 1)} percentage points record-break chance; capped runs (endless): ${withAssist.trays.filter((t) => t > MAX_TRAYS).length}`);
  }
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

// ---------------------------------------------------------------------------------------------
// Economy (--economy): whole play days with the real Progression
// ---------------------------------------------------------------------------------------------

/**
 * Player profiles. `minutes` = play time per day, `secPerPiece` = thinking/drag time per placed
 * piece, `journeyTries` = journey level attempts per day (the rest of the time is classic),
 * `dailyTries` = attempts at the daily challenge.
 */
export const ECONOMY_PROFILES = Object.freeze({
  casual: { minutes: 15, bot: 'greedy', secPerPiece: 3.5, journeyTries: 2, dailyTries: 1 },
  engaged: { minutes: 30, bot: 'greedy', secPerPiece: 3, journeyTries: 4, dailyTries: 2 },
  strong: { minutes: 45, bot: 'planner', secPerPiece: 2.5, journeyTries: 6, dailyTries: 2 },
});
const RUN_OVERHEAD_MIN = 0.2; // menus, result screens, "play again"
const AD_MIN = 0.5; // one rewarded video, including the taps around it
const ECO_COIN_THEMES = Object.entries(CONFIG.ECONOMY.THEMES)
  .filter(([, def]) => def.price > 0).sort((a, b) => a[1].price - b[1].price).map(([id]) => id);

/**
 * Plays `days` days of one player: login reward, optional rewarded ads (x2 on the login reward and
 * on run / level / daily coins, free-coin videos, revive videos), the daily challenge, journey
 * attempts, classic runs for the rest of the time, mission claims; buys the cheapest coin theme
 * as soon as it is affordable. Coins are attributed to their source.
 * @param {typeof ECONOMY_PROFILES[keyof typeof ECONOMY_PROFILES]} profile
 * @param {{ ads: boolean, days: number, seed: number }} opts
 */
export function simulatePlayer(profile, { ads, days, seed }) {
  const save = defaultSave();
  save.flags.tutorialDone = true;
  let now = new Date(2026, 9, 1, 12);
  const P = new Progression(save, { now: () => now });
  const income = {};
  const add = (key, n) => { income[key] = (income[key] || 0) + n; };
  const out = {
    days: [], runCoins: [], runPlayMin: [], incomeBy: income, bought: [], spent: 0, cumulative: [], gameOverBalances: [],
    missions: { offered: 0, completed: 0, bonus: 0, daysWithAll: 0 }, totalMin: 0, levelUps: 0,
  };
  const cumulative = () => out.cumulative[out.cumulative.length - 1] || 0;
  let counter = 0;
  const nextSeed = () => hashString(`economy-${seed}-${counter++}`);
  let minutes = 0;
  let earnedToday = 0;

  /** Runs `fn`, attributes the coin change to `key` (minus the level-up coins in `xpCoins()`). */
  const credit = (key, fn) => {
    const before = P.coins;
    const res = fn();
    const gained = P.coins - before;
    add(key, gained);
    earnedToday += gained;
    return res;
  };
  const levelUpCoins = (xp) => add('level-ups', xp && xp.coins ? xp.coins : 0);
  const watch = () => { minutes += AD_MIN; };

  const play = (session) => {
    playOut(session, {
      revive: ads && session.mode !== 'tutorial',
      bot: profile.bot,
      onPlace(res) {
        P.trackEvent({ type: 'place', cells: res.placedCells.length });
        if (res.linesCount > 0) P.trackEvent({ type: 'clear', lines: res.linesCount, combo: res.combo });
        if (res.allClear) P.trackEvent({ type: 'all_clear' });
      },
    });
    minutes += (session.piecesPlaced * profile.secPerPiece) / 60 + RUN_OVERHEAD_MIN + (ads && session.reviveUsed ? AD_MIN : 0);
    return session;
  };
  /** recordGame + the game_end mission event; returns { rec, coins } */
  const finish = (session, mode) => {
    const before = P.coins;
    const rec = P.recordGame({
      mode, score: session.score, lines: session.linesCleared, maxCombo: session.maxCombo,
      pieces: session.piecesPlaced, allClears: session.allClears, playSec: session.piecesPlaced * profile.secPerPiece,
    });
    P.trackEvent({ type: 'game_end', mode, score: session.score, pieces: session.piecesPlaced });
    const gained = P.coins - before;
    if (rec.coinsEarned > 0) add('classic runs', rec.coinsEarned);
    add('level-ups', rec.xp.coins);
    earnedToday += gained;
    if (rec.xp.leveledUp) out.levelUps += rec.xp.levels.length;
    return rec;
  };
  const doubleUp = (amount) => {
    if (!ads || !(amount > 0)) return;
    const gained = P.doubleRunCoins(amount);
    add('x2 videos', gained);
    earnedToday += gained;
    watch();
  };
  const claimLogin = () => {
    if (!P.isFeatureUnlocked('daily_reward')) return;
    const r = P.claimDailyReward(ads ? 2 : 1);
    if (r.coins > 0) {
      add('login calendar', r.coins);
      earnedToday += r.coins;
      if (ads) watch();
    }
  };

  for (let d = 0; d < days; d++) {
    now = new Date(2026, 9, 1 + d, 12);
    minutes = 0;
    earnedToday = 0;
    claimLogin();
    if (ads) {
      for (let i = 0; i < CONFIG.ADS.FREE_COINS_ADS_PER_DAY; i++) {
        credit('free-coin videos', () => P.grantFreeCoins());
        watch();
      }
    }
    // daily challenge
    if (P.isFeatureUnlocked('daily')) {
      const level = generateDailyLevel(dayKey(now));
      for (let a = 0; a < profile.dailyTries; a++) {
        const s = play(createSession({ mode: 'daily', level, seed: nextSeed(), gamesPlayed: save.stats.gamesPlayed }));
        finish(s, 'daily');
        if (s.status === 'won') {
          const before = P.coins;
          const r = P.completeChallenge(level.id, s.stars());
          add('daily challenge', r.coins);
          levelUpCoins(r.xp);
          earnedToday += P.coins - before;
          P.trackEvent({ type: 'daily_complete' });
          doubleUp(r.coins);
          break;
        }
      }
    }
    // journey attempts (a lost attempt is retried with a new seed)
    if (P.isFeatureUnlocked('journey')) {
      for (let k = 0; k < profile.journeyTries; k++) {
        const n = save.journey.unlocked;
        const level = generateLevel(n);
        // the "use a booster" mission is done with a booster the player owns (starting / gift / video ones)
        const useBooster = P.missions().some((m) => m.type === 'use_booster' && m.progress < m.target);
        if (useBooster) {
          const type = P.boosterCount('shuffle') > 0 ? 'shuffle' : 'hammer';
          if (P.useBooster(type)) P.trackEvent({ type: 'booster_used' });
        }
        const s = play(createSession({ mode: 'journey', level, seed: nextSeed(), gamesPlayed: save.stats.gamesPlayed }));
        finish(s, 'journey');
        if (s.status === 'won') {
          const before = P.coins;
          const r = P.completeLevel(n, s.stars(), level.rewardCoins);
          add('journey levels', r.coins);
          levelUpCoins(r.xp);
          earnedToday += P.coins - before;
          P.trackEvent({ type: 'level_complete', stars: s.stars() });
          doubleUp(r.coins);
        }
      }
    }
    // classic for the rest of the time (the first two games are the tutorial-ish unlock games)
    do {
      const s = play(createSession({ mode: 'classic', seed: nextSeed(), bestScore: P.bestScore, gamesPlayed: save.stats.gamesPlayed }));
      out.gameOverBalances.push(P.coins);
      const rec = finish(s, 'classic');
      out.runCoins.push(rec.coinsEarned);
      out.runPlayMin.push((s.piecesPlaced * profile.secPerPiece) / 60);
      doubleUp(rec.coinsEarned);
      claimLogin(); // the login calendar unlocks after the first game
    } while (minutes < profile.minutes);
    // missions
    const list = P.missions();
    out.missions.offered += list.length;
    let claimed = 0;
    for (const m of list) {
      if (!m.claimed && m.progress >= m.target) {
        credit('missions', () => P.claimMission(m.id));
        claimed++;
      } else if (m.claimed) claimed++;
    }
    out.missions.completed += list.filter((m) => m.progress >= m.target).length;
    if (list.length === 3 && P.missionBonusStatus().available) {
      credit('mission bonus', () => P.claimMissionBonus());
      out.missions.bonus++;
    }
    if (list.length === 3 && list.every((m) => m.progress >= m.target)) out.missions.daysWithAll++;
    // spend: the cheapest coin theme as soon as it is affordable
    for (const id of ECO_COIN_THEMES) {
      if (P.themeUnlockInfo(id).canBuy) {
        P.buyTheme(id);
        out.spent += CONFIG.ECONOMY.THEMES[id].price;
        out.bought.push({ id, day: d + 1 });
      }
    }
    out.totalMin += minutes;
    out.cumulative.push(cumulative() + earnedToday);
    out.days.push({ day: d + 1, earned: earnedToday, minutes, level: P.levelInfo().level, journey: save.journey.unlocked, balance: P.coins });
  }
  // level-up coins are counted in 'level-ups' only, not again in the source that triggered them
  out.finalBalance = P.coins;
  out.level = P.levelInfo().level;
  out.journeyLevel = save.journey.unlocked;
  return out;
}

function simulateEconomy() {
  const E = CONFIG.ECONOMY;
  const players = Number(args.players || 3);
  const days = Number(args.days || 30);
  const names = String(args.profiles || Object.keys(ECONOMY_PROFILES).join(',')).split(',');
  const adModes = args.ads === '0' ? [false] : args.ads === '1' ? [true] : [false, true];
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const median = (xs) => quantile(xs.slice().sort((a, b) => a - b), 0.5);
  const packs = Object.entries(CONFIG.PRODUCTS).filter(([, p]) => p.coins).map(([id, p]) => [id, p.coins]);
  console.log(`\n=== Economy: ${days} days x ${players} players per profile (real Progression; greedy / planner bots) ===`);
  console.log(`config: run coins ${E.RUN_COINS_FACTOR}*sqrt(score), level ${E.LEVEL_COMPLETE_COINS}+${E.LEVEL_STAR_COINS}/star (x1/1.5/2), daily ${E.DAILY_CHALLENGE_COINS}, `
    + `login ${E.DAILY_REWARDS.join('/')}, missions ${E.MISSION_REWARDS.join('/')}+${E.MISSION_BONUS_COINS}, level-up ${E.LEVEL_UP_COINS}, revive ${E.REVIVE_COINS}`);
  console.log(`themes ${ECO_COIN_THEMES.map((id) => `${id} ${E.THEMES[id].price}`).join(', ')}; packs ${packs.map(([id, c]) => `${id} ${c}`).join(', ')}`);
  console.log('targets: engaged player without ads ~500-800 coins/day; first theme within ~2-3 days, last theme in ~2-3 weeks; revive >> one run; packs = several days of play');
  const summary = [];
  for (const name of names) {
    const profile = ECONOMY_PROFILES[name];
    if (!profile) throw new Error(`unknown profile ${name}`);
    for (const ads of adModes) {
      const runs = [];
      for (let k = 0; k < players; k++) runs.push(simulatePlayer(profile, { ads, days, seed: BASE_SEED * 1000 + k }));
      const perDay = (fn) => sum(runs.map(fn)) / (players * days);
      const totalPerDay = perDay((r) => r.cumulative[r.cumulative.length - 1]);
      const week = (from, to) => sum(runs.map((r) => sum(r.days.slice(from, to).map((x) => x.earned)))) / (players * (to - from));
      const sources = {};
      for (const r of runs) for (const [k, v] of Object.entries(r.incomeBy)) sources[k] = (sources[k] || 0) + v;
      const runCoins = runs.flatMap((r) => r.runCoins).sort((a, b) => a - b);
      const minutes = sum(runs.map((r) => r.totalMin));
      const coinsPerHour = (totalPerDay * players * days) / (minutes / 60);
      // day on which the cumulative income (start coins included) reaches a price, averaged over players
      const dayReaching = (price) => {
        const ds = runs.map((r) => { const i = r.cumulative.findIndex((c) => c + E.STARTING_COINS >= price); return i < 0 ? Infinity : i + 1; });
        const finite = ds.filter(Number.isFinite);
        return finite.length === ds.length ? fmt(mean(ds), 1) : finite.length ? `${fmt(mean(finite), 1)}*` : `>${days}`;
      };
      const boughtDay = (id) => {
        const ds = runs.map((r) => (r.bought.find((b) => b.id === id) || {}).day);
        const f = ds.filter(Boolean);
        return f.length === ds.length ? fmt(mean(f), 1) : f.length ? `${fmt(mean(f), 1)}*` : `>${days}`;
      };
      const allOwned = ECO_COIN_THEMES.reduce((a, id) => a + E.THEMES[id].price, 0);
      const late = runs.flatMap((r) => r.gameOverBalances.slice(Math.floor(r.gameOverBalances.length * 0.7)));
      const early = runs.flatMap((r) => r.gameOverBalances.slice(0, Math.ceil(r.gameOverBalances.length * 0.2)));
      const affordable = (xs) => pct(xs.filter((b) => b >= E.REVIVE_COINS).length, xs.length);
      console.log(`\n--- ${name}: ${profile.minutes} min/day, ${profile.bot} bot, ${profile.secPerPiece}s/piece, ${profile.journeyTries} journey + ${profile.dailyTries} daily tries; rewarded ads: ${ads ? 'all optional ones watched' : 'never'} ---`);
      console.log(`coins/day ${fmt(totalPerDay, 0)}  (days 1-3 ${fmt(week(0, 3), 0)}, days 4-7 ${fmt(week(3, 7), 0)}, last 7 days ${fmt(week(Math.max(0, days - 7), days), 0)})  = ${fmt(coinsPerHour, 0)} coins per hour of play`);
      console.log('  by source (coins/day): ' + Object.entries(sources).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${fmt(v / (players * days), 0)} (${fmt((100 * v) / sum(Object.values(sources)), 0)}%)`).join(', '));
      console.log(`  classic run income: median ${median(runCoins)}, p10 ${quantile(runCoins, 0.1)}, p90 ${quantile(runCoins, 0.9)} coins; ${fmt(runCoins.length / (players * days), 1)} classic runs/day; `
        + `reached player level ${fmt(mean(runs.map((r) => r.level)), 1)}, journey level ${fmt(mean(runs.map((r) => r.journeyLevel)), 1)}`);
      console.log(`  missions: ${fmt(sum(runs.map((r) => r.missions.completed)) / sum(runs.map((r) => r.missions.offered)) * 100, 0)}% completed, all three on ${fmt(sum(runs.map((r) => r.missions.daysWithAll)) / (players * days) * 100, 0)}% of days`);
      console.log(`  themes (bought cheapest first)   day: ${ECO_COIN_THEMES.map((id) => `${id} ${boughtDay(id)}`).join(', ')};  saving for one alone, day income reaches the price: ${ECO_COIN_THEMES.map((id) => `${id} ${dayReaching(E.THEMES[id].price)}`).join(', ')}; all four ${dayReaching(allOwned)}`);
      console.log(`  revive ${E.REVIVE_COINS} coins = ${fmt(E.REVIVE_COINS / median(runCoins), 1)} median classic runs = ${fmt(E.REVIVE_COINS / totalPerDay, 2)} days of income; `
        + `balance >= ${E.REVIVE_COINS} at ${affordable(early)} of the game overs in the first 20% of the days, ${affordable(late)} in the last 30% (after the themes are bought)`);
      console.log(`  packs in days of play: ${packs.map(([id, c]) => `${id} (${c}) = ${fmt(c / totalPerDay, 1)} days / ${fmt(c / coinsPerHour * 60 / profile.minutes, 1)} days of ${profile.minutes} min`).join(', ')}`);
      summary.push({ profile: name, ads: ads ? 'ads' : 'no ads', coinsDay: Math.round(totalPerDay), perHour: Math.round(coinsPerHour), runMedian: median(runCoins),
        firstTheme: boughtDay(ECO_COIN_THEMES[0]), lastTheme: boughtDay(ECO_COIN_THEMES[ECO_COIN_THEMES.length - 1]), reviveRuns: fmt(E.REVIVE_COINS / median(runCoins), 1),
        smallDays: fmt(packs[0][1] / totalPerDay, 1), largeDays: fmt((packs[1] || packs[0])[1] / totalPerDay, 1) });
    }
  }
  console.log('\nsummary:');
  console.table(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t0 = performance.now();
  if (args.economy) {
    simulateEconomy();
  } else if (args.assist) {
    simulateAssist();
  } else {
    if (GEN_CONFIG !== CONFIG.GENERATOR) console.log('generator config override:', args.config);
    if (RUNS > 0) simulateClassic();
    if (LEVELS > 0) simulateJourney();
    if (DAYS > 0) simulateDaily();
  }
  console.log(`\n(simulation took ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
