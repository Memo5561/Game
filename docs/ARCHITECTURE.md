# Blocko – Architecture & Module Contracts (v2)

This document is the single source of truth for how the game is put together. Modules are written
in parallel by different engineers, so every module MUST follow the contracts below exactly
(names, signatures, data shapes, ownership). If you need something that is not in the contract,
add it as an *extra* export, never change or remove what is specified here, and report it.
All tunable numbers live in `game/js/config.js` (`CONFIG`) – import them, never hardcode them.

## 1. Product summary

**Blocko** is an 8×8 block-puzzle game (genre of 1010!, Woodoku, Block Blast) for Android.
The game is an HTML5 app (vanilla ES modules, Canvas 2D + DOM UI, no build step, fully offline)
inside a thin native Android shell (Kotlin, WebView) that provides AdMob ads with Google UMP
consent, Google Play Billing, durable save storage, haptics, local reminder notifications, share
and in-app review.

Core loop: drag one of 3 pieces from the tray onto the board → full rows/columns clear → score,
combo, juicy feedback → when all 3 are used a new tray appears → game over when none of the
remaining pieces fits anywhere.

Retention/meta loop:
- **Classic** endless mode, high-score chase ("Only 120 to beat your best!"), resumable runs.
- **Journey**: endless procedural levels (collect gems, 1–3 stars, sawtooth difficulty), level map, boosters.
- **Daily Challenge**: one seeded level per day, reward + challenge streak.
- 7-day **login calendar** (with one grace day), 3 **daily missions** + bonus, **player level / XP**.
- **Themes** (block skins) bought with coins or unlocked by level.
- Opt-in local **reminder notification**, Play **in-app review** card after a new best.
- Progressive feature unlock (missions/daily reward after game 1, journey after game 2, daily challenge after journey level 4).

First-time experience (FTUE): icon tap → ≤ 3 s → interactive tutorial directly on the game
screen (no home screen, no modal, no consent form, no banner) → seamless first classic run with a
free revive → first game-over screen. Ads (and the UMP consent form) start only after the player
leaves the first game-over screen.

Monetization (fair, policy-compliant, never deceptive):
- Rewarded ads (always opt-in, label states the reward): revive, ×2 run coins, free booster, ×2 daily reward, free coins.
- Interstitials only when the player taps a button that leaves a run-result screen, gated by play time.
- Adaptive banner in a fixed native slot below the WebView (never resizes the game, never next to touch targets).
- In-app products: `remove_ads` (removes banner + interstitials, rewarded ads stay available, includes a one-time gift), `coins_small`, `coins_large`.
- Coins can also buy the one revive per run. No paid randomness, no fake buttons, no "Do you like us?" gates, no loss-framed notifications, no difficulty rigging around the best score.

## 2. Repository layout and ownership

```
game/                      Web game = Android assets root (served at https://appassets.androidplatform.net/assets/)
  index.html               [ui]  (incl. a tiny classic script: WebView-too-old fallback, see §4.15)
  css/style.css            [ui]
  assets/                  [shared] icon.svg, fonts/ (Nunito, OFL; fonts.css)
  js/config.js             [lead]
  js/main.js               [ui]  bootstrap → App
  js/app/*.js              [ui]  app.js (App), gamecontroller.js, popups.js, debug.js
  js/ui/*.js               [ui]  screens, modals, components, i18n.js
  js/core/*.js             [core] pure game logic (no DOM!)
  js/meta/*.js             [meta] storage, progression, missions, ad policy (no DOM!)
  js/render/*.js           [render] canvas renderer, themes, sprites, particles
  js/input/*.js            [render] drag/pointer handling
  js/audio/*.js            [audio] WebAudio synthesized sound + music
  js/platform/bridge.js    [lead] JS side of the native bridge + browser mock
android/                   [android] Android Studio project (Kotlin)
tests/unit/*.test.mjs      node:test unit tests (core.*, meta.*)
tests/e2e/*.spec.mjs       Playwright e2e tests (run.mjs runner, harness.mjs helpers)
tools/                     serve.mjs, simulate.mjs, make-icons.mjs, store-assets.mjs, check-release.mjs, audio-check.mjs
store/                     generated Play Store graphics
docs/                      German user docs, store listing, legal templates (docs/site/ = hostable pages), this file
```

Rules for all JS:
- Plain JavaScript ES modules, **no build step, no npm runtime dependencies, no network requests**.
  Feature baseline: Chrome/WebView 90 (optional chaining, `??`, classes with fields are OK; no
  top-level await, no `structuredClone`, no CSS `:has()`, no container queries).
- Relative imports with explicit `.js` extensions.
- `js/core/*` and `js/meta/*` never touch `window`, `document`, `localStorage` (exception:
  `meta/storage.js`, which wraps storage defensively and accepts an injected backend for tests).
- No `Math.random()` in core logic – always the injected `RNG`.
- Mobile performance matters: no allocations in per-frame code, no layout thrash.
- All user-visible text goes through `t(key, params)` (`js/ui/i18n.js`). Non-UI modules that draw
  text (renderer) get `t` injected instead of importing i18n.

## 3. Conventions and shared data shapes

- Board is `CONFIG.BOARD_SIZE` (8) × 8. `r` = row (0 = top), `c` = column (0 = left), index `i = r * 8 + c`.
- **Color** = palette index **0..7** everywhere (Piece.color, PlaceResult.cleared[].color,
  LevelDef.prefilled[].color, renderer APIs). Only `Board.cells` stores `color + 1` (0 = empty) and
  `Board.get()` returns that stored value.
- **Gem type**: 0 none, 1 diamond (blue), 2 star (gold), 3 heart (red). A gem always sits on a
  filled cell and is collected when that cell is cleared (by a line, revive or hammer).
- **Shape**: `{ id, family, cells: Array<[r,c]>, w, h, size, tier: 1|2|3|4 }` (frozen; cells normalized to min r = min c = 0).
- **Piece**: `{ uid, shapeId, color }` (frozen). **Tray**: `Array<Piece|null>` length 3.
- **Day key**: local date `'YYYY-MM-DD'`.
- All arrays/objects returned in results are **fresh copies** (never aliases of internal state).
- Pixel units: every renderer/drag coordinate is in **CSS px relative to the canvas top-left**.
  DPR is applied only through `ctx.setTransform`.

## 4. Module contracts

### 4.1 `js/core/rng.js` [core]
```js
export class RNG {
  constructor(seed /* uint32 */)
  next(); int(n); range(a, b); chance(p); pick(array); weighted(items, weightFn); shuffle(array)
  getState(); setState(state)
}
export function hashString(str)   // → uint32 (FNV-1a)
export function randomSeed()      // → uint32 (crypto if available) – the ONLY non-deterministic source
```
mulberry32, single uint32 state.

### 4.2 `js/core/shapes.js` [core]
```js
export const SHAPES       // frozen Shape[]; families: '1x1','I2','I3','L3','O2','I4','T','L4','SZ','R23','I5','L5','O3'
                          // (I = straight lines both orientations, L3 = 3-cell corner ×4, L4 = L/J ×8, L5 = big corner ×4,
                          //  T ×4, SZ ×4, R23 = 2x3/3x2, O2 = 2x2, O3 = 3x3). No diagonals.
export const SHAPE_BY_ID
export function getShape(id)
export function familyWeight(family, d) // lerp(CONFIG.GENERATOR.FAMILY_WEIGHTS[family], d)
export function shapeWeight(shape, d)   // familyWeight / orientations in that family
```
Unit test: sampling 100k pieces at d = 0 and d = 1 matches the family shares within 1 %.

### 4.3 `js/core/board.js` [core]
```js
export class Board {
  constructor(size = 8)
  size; cells /* Uint8Array */; gems /* Uint8Array */
  get(r, c)                  // stored value (0 or color+1); out of bounds → 255
  isEmpty(r, c)
  canPlace(shape, r, c)      // allocation-free
  place(shape, r, c, color)  // → [[r,c]...]
  findFullLines()            // → { rows, cols }
  previewLines(shape, r, c)  // lines that would be full after placing (no mutation) → { rows, cols }
  clearLines(rows, cols)     // → { cells: [{r,c,color,gem}], gems: {1:n,2:n,3:n} } (intersections once)
  clearCells(list)           // [[r,c]] → same shape as clearLines (only filled cells reported)
  anyPlacement(shape); placements(shape) /* [[r,c]] */
  filledCount(); fillRatio(); isBoardEmpty(); gemCount() /* {1,2,3} */
  clone(); toJSON() /* {size, cells:number[], gems:number[]} */; static fromJSON(o)
}
```

### 4.4 `js/core/scoring.js` [core]
```js
export function placementPoints(cellCount)   // = cellCount
export function clearPoints(lines, combo)    // LINE_POINTS[lines] (extrapolated +140/line) * max(1, combo)
export function praiseFor(lines, comboBefore, comboAfter, allClear)
   // → null | 'good'|'great'|'excellent'|'amazing'|'unbelievable'
   // = higher of CONFIG.SCORING.PRAISE.LINES[min(lines,6)] and the COMBO_MILESTONES entry reached exactly
   //   on this placement; allClear → 'unbelievable'. A plain 1-line clear without milestone → null.
export const PRAISE_LEVELS = ['good','great','excellent','amazing','unbelievable'] // Sfx 'praise' {level: index+1}
```
Rules: combo starts at 0. A clearing placement: `combo += 1`, `movesSinceClear = 0`, points
`clearPoints(lines, combo)`. A non-clearing placement: `movesSinceClear += 1`; when
`movesSinceClear >= COMBO_KEEP_MOVES` → `combo = 0` (`comboBroken = true` if it was ≥ 1).
Board empty after a clear → `+ALL_CLEAR_BONUS`. UI shows "Combo xN" when `combo >= 2` plus pips
`comboMovesLeft = combo > 0 ? COMBO_KEEP_MOVES - movesSinceClear : 0`.

### 4.5 `js/core/generator.js` [core] – adaptive piece generation
```js
export class PieceGenerator {
  constructor({ rng, mode })   // mode: 'classic'|'journey'|'daily'|'tutorial'
  nextTray(board, ctx)         // ctx: { score, trayIndex, traysSinceClear, combo, fill, experience, mercyTrays, level?, goals? } → Piece[3]
  reviveTray(board)            // 3 small/medium pieces placeable together
  shuffleTray(board, count)    // `count` new pieces, solvable together if at all possible
  toJSON(); static fromJSON(obj, rng)   // every counter it uses (uid, history…)
}
export function analyzeTray(board, shapes, { nodeLimit })
  // → { solvable, maxLines /* total over best order */, maxSingle /* best single placement */ }
```
Algorithm (all constants from `CONFIG.GENERATOR`):
1. `d` = `level.difficulty` (journey/daily) or `clamp(D_MIN + trayIndex / RAMP_TRAYS, D_MIN, D_MAX)` (classic).
   The generator NEVER reads bestScore and never selects a tray *because* it is unsolvable.
2. Sample `CANDIDATES` trays with `shapeWeight(shape, d)`; no 3 identical shapes; no 3 identical colors.
3. Drop candidates where no piece fits right now (if all are impossible, use the smallest shapes that fit).
4. Choose:
   a. **Early** (`trayIndex < EARLY_TRAYS`, or `< NEWBIE_EARLY_TRAYS` while `experience < NEWBIE_GAMES`):
      the solvable candidate with the highest `min(maxLines, 3)`, ties by `maxSingle`.
   b. **Mercy** (`fill > MERCY_FILL` or `traysSinceClear >= MERCY_TRAYS_NO_CLEAR` or `mercyTrays > 0`):
      random among solvable candidates with `maxLines >= 1` (journey/daily: prefer lines containing gems; this help scales with `1 - difficulty`).
   c. Otherwise: with probability `RAW_P_MAX * d` the first sample unfiltered; else random among solvable candidates.
5. Deterministic: `analyzeTray` is bounded only by `NODE_LIMIT` nodes (never wall clock); the rng is
   consumed in a fixed order (colors included). p99 `nextTray` ≤ 3 ms in Node.

### 4.6 `js/core/levels.js` [core]
```js
export function generateLevel(n)            // Journey level n (1-based), deterministic from n
export function generateDailyLevel(dayKey)  // deterministic from the day key
export function levelKind(n)                // 'normal' | 'hard' | 'superhard'
// LevelDef: { id: 'L12' | 'D2026-10-18', kind: 'journey'|'daily', number, seed, difficulty /* 0..1 */,
//   tag: 'normal'|'hard'|'superhard', prefilled: [{r,c,color}], gems: [{r,c,type}],
//   goals: { gems?: {1?:n,2?:n,3?:n}, score?: number }, par: [par3, par2], rewardCoins }
```
- `difficulty = min(0.85, 0.15 + 0.012 n)`, `+0.12` when `n % 5 == 0` (hard), `+0.25` when `n % 10 == 0`
  (super hard, replaces hard), `-0.1` for the level after a peak. First hard level = 10 (levels 1–9 normal).
- Prefilled patterns come from a library of designed 8×8 templates (symmetry, hearts, arrows,
  frames, letters…) with seeded mirroring/rotation/color schemes; never full rows/cols at start.
- Journey goal = collect gems; daily goal = score (+ optional gems).
- First-try bot win-rate bands (tested by `tools/simulate.mjs`): levels 1–9 ≥ 95 %; normal 80–92 %;
  hard 55–75 %; super hard 35–55 %. Stars by pieces used: `≤ par3` → 3★, `≤ par2` → 2★, else 1★
  (par3 reachable by the bot in ~30–50 % of levels). No move limit; HUD shows "Pieces: n" with par markers.

### 4.7 `js/core/game.js` [core] – one run
```js
export const SESSION_VERSION = 1
export class GameSession {
  static create({ mode, seed, level /* LevelDef */, bestScore, gamesPlayed })
  static fromJSON(json)     // throws on incompatible data (caller drops the run)
  toJSON()                  // exact resume incl. rng + generator state, traysSinceClear, mercy, tutorial step

  mode; level; board; tray; score; combo; movesSinceClear; traysSinceClear; trayIndex; piecesPlaced;
  linesCleared; maxCombo; allClears; reviveUsed; experience; bestScore;
  status /* 'playing' | 'over' | 'won' */; goals /* { gems?: {type:{need,have}}, score?: {need,have} } */

  canPlace(trayIndex, r, c); preview(trayIndex, r, c) /* {valid, rows, cols} */
  isPiecePlaceable(trayIndex); placeable() /* [bool,bool,bool] */
  placePiece(trayIndex, r, c)   // → PlaceResult | null   (null unless status==='playing' and valid)
  canRevive()                   // status==='over' && !reviveUsed && mode !== 'tutorial'
  revive()                      // → ReviveResult | null
  canUseBooster(type)           // journey/daily && status ∈ {'playing','over'}
  useHammer(r, c)               // 3x3 around (r,c) → BoosterResult | null (null if no filled cell → caller does NOT consume)
  useShuffle()                  // → { tray, placeable, status } | null
  tutorialHint()                // tutorial: { trayIndex, r, c } else null
  nextTutorialStep()            // tutorial: after a completed step → { board, tray } (the controller calls renderer.sync())
  stars()                       // journey/daily when won: 1..3
}
export function listValidMoves(session) // → [{ trayIndex, r, c, lines, cells }]
// PlaceResult = { trayIndex, piece, r, c, placedCells, placePoints,
//   lines: {rows, cols}, linesCount, cleared: [{r,c,color,gem}], gemsCollected: {type:n},
//   combo, comboBefore, comboBroken, movesSinceClear, comboMovesLeft, clearPoints, allClear, allClearBonus,
//   praise /* null|key */, totalPoints, score, newBest, trayRefilled, tray, placeable, goals, status,
//   tutorialStep /* tutorial: { done, hasNext } else null */ }
// ReviveResult  = { cleared, gemsCollected, tray, placeable, goals, status }
// BoosterResult = { cleared, gemsCollected, placeable, goals, status }
```
Rules:
- Order after a placement: place → clear lines → score/combo → gem/goal progress → if all goals
  met: `status='won'` (no refill) → else refill if all slots null (`trayIndex++`, update
  `traysSinceClear`) → game-over check (no remaining piece fits → `'over'`).
- `newBest` = `mode==='classic' && bestScore > 0 && score > bestScore` on the first such placement of the run only.
- `revive()`: clears the 2 fullest rows + 2 fullest columns (no points), `combo = 0`,
  `movesSinceClear = 0`, `traysSinceClear = 0`, `reviveUsed = true`, mercy for
  `MERCY_AFTER_REVIVE` trays, new `reviveTray`; gems cleared count toward goals (may set `'won'`).
- Boosters don't change combo/movesSinceClear and don't count as placements; after a booster in
  `'over'`, status becomes `'playing'` if any tray piece fits (or `'won'` if goals got completed).
- Tutorial: 3 scripted steps (step 1 a row, step 2 a column, step 3 a 2-line cross clear that shows
  "Combo x2" + praise). Only the hinted `(trayIndex, r, c)` is accepted (`canPlace` false otherwise;
  the drag layer uses a 1.0-cell snap tolerance toward the hint). `placePiece` never swaps the board;
  after a completed step the controller calls `nextTutorialStep()`. After the last step `status = 'won'`.

### 4.8 `js/meta/storage.js` [meta]
```js
export const SAVE_KEY = 'blocko.save.v1'     // never changes; migrations go by data.version
export function defaultSave()
export function loadSave(nativeSnapshot /* string|'' from Platform.loadData() */) // never throws
export function writeSave(data)              // → boolean; bumps data.rev; writes localStorage + Platform.saveData
export function requestSave(data)            // coalesced: one writeSave per macrotask
export function flushSave(data)              // synchronous writeSave now (returns boolean)
export function clearSave()
export function setStorageBackend(backend)   // tests: { getItem, setItem, removeItem } + optional native { saveData(json) }
```
- `loadSave` picks whichever snapshot (localStorage vs native file) has the higher `rev`; deep-merges
  plain objects over `defaultSave()`, but takes arrays and `run` from stored data as-is and keeps
  unknown keys; migrates through `MIGRATIONS[n](data)`; on JSON parse failure copies the raw string
  to `'blocko.save.corrupt'` and returns defaults.
- SaveData (version 1):
```js
{
  version: 1, rev: 0, createdAt, lastPlayedAt, lastSessionStart,
  settings: { sound: true, music: true, haptics: true, lang: 'auto' },
  coins, xp,
  stats: { gamesPlayed, classicGames, bestScore /* classic only */, totalScore, totalLines, bestCombo,
           piecesPlaced, allClears, playSec },
  themes: { owned: ['jewel'], selected: 'jewel' },
  boosters: { hammer, shuffle },
  daily: { lastClaimDay: null, day: 0 /* 1..7 position */, streak: 0 },
  missions: { day: null, list: [], bonusClaimed: false },
  journey: { unlocked: 1, stars: {} /* {n: 1..3} */ },
  challenge: { completed: {} /* {dayKey: stars} */, streak: 0, lastDay: null },
  ads: { runsFinished: 0, playSecSinceAd: 0, lastInterstitialAt: 0, lastRewardedAt: 0,
         interstitialsShown: 0, sessionRuns: 0, upsellDay: null, freeCoins: { day: null, count: 0 } },
  iap: { adsRemoved: false /* mirror of native */, adsGiftGranted: false, grantedTokens: [] /* last 100 */ },
  flags: { tutorialDone: false, notifAsked: null /* dayKey of last ask */, notifOptIn: false,
           notifDeclines: 0, reviewAsked: false, firstRecordShown: false },
  run: null   // { v: SESSION_VERSION, mode, level /* LevelDef|null */, session: GameSession.toJSON() } – any mode except tutorial
}
```

### 4.9 `js/meta/progression.js` [meta]
```js
export function dayKey(date)                 // local 'YYYY-MM-DD'
export function daysBetween(keyA, keyB)      // Math.round((Date.UTC(b) - Date.UTC(a)) / 864e5) parsed from keys (DST-safe)
export function xpForLevel(level)            // XP_LEVEL_BASE + XP_LEVEL_STEP * level
export class Progression {
  constructor(save, { now = () => new Date(), onChange } = {})   // onChange after every mutation (→ requestSave)
  save
  isFeatureUnlocked(f)          // 'missions' | 'daily_reward' | 'journey' | 'daily' (CONFIG.UNLOCKS, derived from stats/journey)
  get coins(); addCoins(n, source); spendCoins(n) /* bool */
  levelInfo()                   // { level, xp, xpIntoLevel, xpForNext, progress }
  addXP(n)                      // → { leveledUp, levels: [..], coins, unlockedThemes: [ids] }
  recordGame({ mode, score, lines, maxCombo, pieces, allClears, playSec })
     // → { newBest, firstRecord, coinsEarned /* classic only */, xp /* addXP result */, counted /* pieces >= RUN_MIN_PIECES */ }
     // classic: bestScore + COINS_PER_SCORE coins; all modes: stats, XP (XP_RUN_BASE + lines*XP_PER_LINE, capped)
  doubleRunCoins(amount)        // grants the same amount again (×2 ad), caller ensures once per run
  get bestScore()
  dailyRewardStatus()           // { available, day /*1..7*/, streak, graceUsed, rewards: [{day, coins, boosters?}] }
  claimDailyReward(multiplier = 1) // → { coins, boosters, day, graceUsed }
     // gap 1 → next day; gap 2 → next day + "streak saved"; gap ≥ 3 → day 1; after day 7 → day 1 (streak keeps counting);
     // negative gap (clock moved back) → treated as already claimed today
  missions(); trackEvent(evt) /* → newly completed Mission[] */; claimMission(id) /* → coins */
  missionBonusStatus() /* { available, claimed } */; claimMissionBonus() /* → coins */
     // evt: {type:'place', cells} | {type:'clear', lines, combo} | {type:'all_clear'} | {type:'game_end', mode, score}
     //      | {type:'level_complete', stars} | {type:'daily_complete'} | {type:'booster_used'}
  ownsTheme(id); themeUnlockInfo(id) /* {owned, price, unlockLevel, canBuy} */; buyTheme(id) /* price from CONFIG */; selectTheme(id); get selectedTheme()
  boosterCount(type); addBooster(type, n); useBooster(type); buyBooster(type)
  get journeyUnlocked(); completeLevel(n, stars) // → { coins, firstTime, newStars, xp }
  challengeStatus(dayKey)       // { completed, stars, streak }
  completeChallenge(dayKey, stars) // → { coins, streak, firstTime, xp } (coins/streak only the first time)
  freeCoinsLeft(); grantFreeCoins() /* → coins */
  grantRemoveAdsGift()          // once (iap.adsGiftGranted) → { coins, hammer, shuffle } | null
  applyGrant(token, productId)  // IAP coins; idempotent by token → { coins, duplicate }
}
```
Every method touching day-scoped state first runs a private rollover using `now()`. A daily run is
credited to the day in its `level.id`, never `dayKey(now)`.

### 4.10 `js/meta/missions.js` [meta]
```js
export const MISSION_TYPES // clear_lines, score_single, play_games, combo_reach, place_pieces, multi_clear,
                           // all_clear, journey_levels, daily_challenge, use_booster
export function generateMissions(dayKey, playerLevel, unlocked /* feature ids */) // → Mission[3]: easy, medium, hard
// Mission = { id, type, target, progress, reward /* CONFIG.ECONOMY.MISSION_REWARDS[slot] */, claimed, textKey: 'mission.<type>' }
```
Never generates missions for locked features (journey_levels, daily_challenge, use_booster).

### 4.11 `js/meta/adpolicy.js` [meta]
```js
export class AdPolicy {
  constructor(save, { config = CONFIG.ADS, nowMs = () => Date.now() })
  onSessionStart()                    // cold start or resume after SESSION_GAP_MIN → ads.sessionRuns = 0
  onRunFinished({ playSec, pieces })  // once per finished/abandoned run (never tutorial); counts only pieces >= RUN_MIN_PIECES
  shouldShowInterstitial()            // !adsRemoved && total playSec >= MIN_TOTAL && playSecSinceAd >= MIN_PLAY_SEC_SINCE_AD
                                      // && now - max(lastInterstitialAt, lastRewardedAt) >= MIN_INTERVAL (clock moved back → elapsed)
                                      // && !(SKIP_FIRST_RUN_OF_SESSION && sessionRuns <= 1)
  markInterstitialShown()             // playSecSinceAd = 0, lastInterstitialAt, interstitialsShown++
  markRewardedShown()                 // playSecSinceAd = 0, lastRewardedAt
  shouldShowUpsell()                  // !adsRemoved && interstitialsShown >= UPSELL_AFTER_INTERSTITIALS && upsellDay !== today
  markUpsellShown()
}
```

### 4.12 `js/render/*` and `js/input/*` [render]
`js/render/theme.js`
```js
export const THEMES // ids exactly: 'jewel' (default), 'neon', 'candy', 'wood', 'pixel', 'gold'
                    // { id, nameKey: 'theme.<id>', style, palette: [8 colors], bg: [top, bottom], board, cellEmpty,
                    //   cellEmptyEdge, accent, text }  – price/unlockLevel come from CONFIG.ECONOMY.THEMES
export function getTheme(id)
export function themeCssVars(theme)                 // { '--bg-top', '--bg-bottom', '--accent', '--text', '--panel', … }
export function renderThemePreview(canvas, theme)   // small 4x4 preview for the shop
```
`js/render/renderer.js`
```js
export class Renderer {
  constructor(canvas, { theme, t })
  setTheme(theme); setSession(session /* or null */); sync()   // sync = adopt current session state with a short fade
  resize()                     // ResizeObserver coalesced to next RAF; ignored if (cssW, cssH, dpr) unchanged
  layout                       // { cell, boardX, boardY, boardPx, trayRects: [{x,y,w,h}], trayCell, trayVertical, landscape }
  timeScale                    // 1 normal; 0 = instant; tests use 20
  freeze(bool)                 // stop the clock (store screenshots mid-animation)
  start(); stop(); invalidate()
  // queries for input
  trayIndexAt(x, y)            // -1..2 (hit rects exclude the bottom gutter and edge margins)
  cellAt(x, y)                 // fractional {r, c} (unclamped)
  // drag visuals
  setDrag(d /* { trayIndex, x, y /* top-left of floating piece */, snap: {r,c}|null, rows, cols } | null */)
  animateReturn(trayIndex, x, y)  // → Promise (150 ms fly-back)
  // effects – start synchronously in the same frame, return Promises
  animatePlace(result)         // pop-in, clear burst, +points, praise/combo text, shake; resolves when board visuals are final (≤ 450 ms)
  animateTrayRefill()          // bounce-in (pieces are pickable while bouncing)
  animateGameOver()            // 'No space!' + tray shake, then grey-out bottom→top (≤ 1.0 s total)
  clearGameOver()
  animateRevive(reviveResult); animateBlast(boosterResult); animateShuffle()
  floatText(text, x, y, opts); celebrate(kind /* 'newBest'|'win'|'allClear' */)
  showHint(hint /* {trayIndex,r,c} */); hideHint()
  setTargetMode(mode /* null|'hammer' */); setPieceDimming(bool)
}
```
- The renderer draws the **live session** every frame plus transient effect layers (dying cells are
  copies from `result.cleared`; placed cells pop in; refilled tray pieces scale in). Effects start in
  the same frame as the state change, so nothing pops early. Overlapping effects must work (the
  player can drop the next piece while the previous clear is still animating).
- Every animation promise also resolves via a wall-clock fallback (`duration / timeScale + 250 ms`)
  and immediately when `timeScale === 0`.
- Timing (×1/timeScale): pickup scale-up 90 ms; place pop 120 ms; clear = 60 ms flash then burst
  outward from the placed piece in 25 ms steps, ≤ 350 ms, particles + floating "+points" + praise
  text 700 ms; shake 6 px / 180 ms only for ≥ 3 lines or all-clear; refill bounce staggered 60 ms,
  300 ms total; fly-back 150 ms; new-best banner 1.2 s (non-blocking).
- Layout inside the canvas: `canvasW/canvasH < 1` → board on top, 3 tray slots in a row below;
  else board left, vertical tray column right. A non-interactive **bottom gutter** of
  `max(16 px, 0.5 cell)` below the tray hit rects (the banner sits directly below the WebView) and
  side margins of `max(16 px, gesture inset)` (from `Platform.info.insets`, if present).
- Performance: `dpr = min(devicePixelRatio, 2)` (drop to 1.5 if median frame time over 60 animated
  frames > 22 ms); `getContext('2d', { alpha: false })`; sprite caches as `<canvas>` (per palette
  color × board/tray cell size, gems, empty cell, board background), rebuilt only on resize/theme
  change; per frame only `drawImage`; no shadowBlur/filters/per-frame gradients; texts rendered once
  into sprites; particle pool (typed arrays, 256), float-text pool (8); `dt = min(now-last, 50) * timeScale`;
  RAF loop stops when idle.
- Fonts: before the first canvas text `await Promise.race([document.fonts.load('900 40px Nunito', 'AaĞğŞşİıЖж'), 1500 ms])`;
  rebuild text sprites on `document.fonts` `loadingdone`.

`js/input/drag.js`
```js
export class DragController {
  constructor(canvas, renderer, {
    canInteract: () => boolean,
    getPiece(i) /* → {shape, color} | null */, canPlace(i, r, c), preview(i, r, c) /* {valid, rows, cols} */,
    hint: () => ({trayIndex, r, c}) | null,   // tutorial snap target (1.0-cell tolerance)
    onPickup(i), onHover(placement /* {r,c,valid}|null */), onDrop(i, r, c) /* → boolean placed (sync) */,
    onCancel(i), onTapCell(r, c) /* only in target mode */,
  })
  cancel()      // animates the piece back, fires onCancel
  get active()
  destroy()
}
```
Drag UX: first `pointerdown` in a tray slot starts the drag (any pointerType); other pointers are
ignored until it ends; `setPointerCapture`; `pointerup` = drop; `pointercancel`,
`lostpointercapture` without up, window `blur` = cancel. Process the latest pointer position once
per RAF; call `preview()` only when the snapped cell changes. The piece scales from tray size to
board cell size and floats above the finger: `lift = clamp(2*cell + pieceH/2, 0.5*cell, (canvasBottom - 8) - (boardY + boardPx) + pieceH/2)`
(fixed at pickup, so the bottom row is always reachable). Snap: round the fractional top-left; if
invalid, nearest valid within 0.6 cell. Hover on a valid spot: ghost + the rows/cols that would
clear are highlighted in the piece color. Invalid release → `animateReturn`.

### 4.13 `js/audio/sfx.js` [audio]
```js
export const Sfx = {
  init(), unlock(), setSoundEnabled(bool), setMusicEnabled(bool),
  play(name, opts),  // 'pickup','place','invalid','return','clear'{lines,combo},'combo'{combo},'praise'{level 1..5},
                     // 'allclear','gameover','newbest','coin','click','reward','levelwin','levelfail',
                     // 'hammer','shuffle','revive','tick','unlock','star'{index}
  startMusic(), stopMusic(), suspend(), resume(),
}
```
WebAudio-synthesized (no files), never clips, fails silently. The UI calls `Sfx.suspend()` before
any full-screen ad / purchase flow and `Sfx.resume()` after it settles.

### 4.14 `js/platform/bridge.js` [lead] – JS side of the Android bridge
```js
export const Platform = {
  isNative, info, init(), on(type, fn) /* → unsubscribe */, isBusy() /* a native request is pending or a mock ad is visible */,
  get adsRemoved(), get adState() /* {canRequestAds, rewardedReady, interstitialReady, privacyOptionsRequired} */,
  loadData() /* string ('' if none) */, saveData(json),
  initAds(),                                  // idempotent; starts UMP consent + ads SDK (call after the first game-over screen, or at boot later on)
  showInterstitial() /* Promise<bool shown> */, showRewarded(placement) /* Promise<bool rewarded> */, isRewardedReady(),
  setBannerVisible(visible),
  getProducts() /* Promise<[{id,title,price}]> */, purchase(id) /* Promise<status> */, restorePurchases() /* Promise<{ok, adsRemoved}> */,
  ackGrant(token), haptic(kind), share(text), requestReview(), openUrl(url),
  isPrivacyOptionsRequired(), showPrivacyOptions(),
  getNotificationPermission() /* 'granted'|'denied'|'prompt'|'unsupported' */, requestNotificationPermission() /* Promise<bool> */,
  openNotificationSettings(), scheduleReminder(delayMinutes, title, body), cancelReminder(), exitApp(),
}
```
Events via `Platform.on`: `'pause'`, `'resume'`, `'back'`, `'entitlements'` `{adsRemoved}`,
`'grant'` `{token, productId}`, `'adState'` `{…}`, `'insets'` `{…}`. `grant`/`entitlements`/`adState`
arriving before a listener exists are buffered and flushed to the first subscriber.
Purchase statuses: `'success'|'cancelled'|'pending'|'error'|'already_owned'|'unavailable'`.
Mock: active only when `location.hostname !== 'appassets.androidplatform.net'` (on that host without
`BlockoNative`: no ads, no products, purchases `'unavailable'`). `?mock=fast` → 50 ms ads, `?mock=nofill` → no ads.

Native protocol (`android/…/GameBridge.kt`, interface name **`BlockoNative`**). JS → native methods
(primitive args; return String/Boolean/void; called on WebView's background thread):
`getInfo(): String` · `ready()` · `pageUnloading()` (from a `pagehide` listener) · `loadData(): String` ·
`saveData(json)` · `initAds()` ·
`showInterstitial(requestId)` · `showRewarded(requestId, placement)` · `isRewardedReady(): Boolean` ·
`setBannerVisible(Boolean)` · `queryProducts(requestId)` · `purchase(requestId, productId)` ·
`restorePurchases(requestId)` · `ackGrant(token)` · `haptic(kind)` · `share(text)` · `requestReview()` ·
`openUrl(url)` · `isPrivacyOptionsRequired(): Boolean` · `showPrivacyOptions(requestId)` ·
`getNotificationPermission(): String` · `requestNotificationPermission(requestId)` ·
`openNotificationSettings()` · `scheduleReminder(delayMinutes: Int, title, body)` · `cancelReminder()` ·
`exitApp()` · `log(level, message)`.

`getInfo()` JSON: `{ platform:'android', appVersion, versionCode, sdkInt, webViewVersion, locale, debug,
adsRemoved, canRequestAds, rewardedReady, interstitialReady, privacyOptionsRequired,
notificationPermission, bannerHeightDp, insets: {top,right,bottom,left,gestureLeft,gestureRight} }`.

Native → JS: `window.__blockoNative.dispatch(event)`:
- `{type:'interstitialResult', requestId, shown}` / `{type:'rewardedResult', requestId, rewarded, shown}` –
  sent only after the ad was dismissed (or immediately with `shown:false` if nothing is loaded/failed).
  Every requestId gets exactly one result.
- `{type:'productsResult', requestId, products:[{id,title,price}]}` (unfetched products omitted)
- `{type:'purchaseResult', requestId, productId, status}` (for coins: `grant` is dispatched BEFORE `success`)
- `{type:'restoreResult', requestId, ok, adsRemoved}`
- `{type:'privacyOptionsResult', requestId}` / `{type:'notificationPermissionResult', requestId, granted}`
- `{type:'entitlements', adsRemoved}` – after every successful purchase query (true OR false), never on errors/offline
- `{type:'grant', token, productId}` – native keeps a durable ledger; after every `ready()` it re-sends every
  unacknowledged grant (no age limit) and the acknowledged ones of the last 7 days. JS: token already in
  `save.iap.grantedTokens` → only `ackGrant`; unknown product → no ack; else add coins + token in one save
  object → `flushSave` → `ackGrant` (native records the ack only once the pending `saveData` snapshot was
  written successfully; otherwise the grant stays unacknowledged and is re-sent).
- `{type:'adState', canRequestAds, rewardedReady, interstitialReady, privacyOptionsRequired}` on every change
- `{type:'insets', top, right, bottom, left, gestureLeft, gestureRight}` (CSS px)
- `{type:'pause', reason?}`, `{type:'resume', reason?}` (from onStop/onStart; suppressed while a native overlay
  – ad, billing sheet, permission dialog, review card, UMP form – is in front), `{type:'back'}`.

### 4.15 UI / App [ui]
**Boot order** (`js/app/app.js`): `Platform` dispatcher installed → `loadSave(Platform.loadData())` →
`new Progression(save)` / `AdPolicy` → `Platform.on(...)` for all events → `await Platform.init()`
→ i18n + fonts → first screen → `window.__blocko` (debug) → `window.__blockoBooted = true`.
`index.html` contains a tiny classic (non-module) script that shows an inline multilingual "Please
update Android System WebView" message if `__blockoBooted` is not set within 8 s.

**Screens** (`data-screen`): `home`, `game`, `journey` (map), `shop`, `missions`, `settings`, `legal`.
**Modals** (`data-modal`): `pause`, `revive`, `gameover`, `levelResult`, `dailyReward`, `tutorial`,
`confirm`, `notifAsk`, `levelUp`. Buttons carry `data-action="<screen|modal>.<action>"` (e.g.
`home.play`, `revive.watch`, `revive.coins`, `revive.skip`, `gameover.again`, `gameover.home`,
`gameover.double`, `shop.buy.remove_ads`, `tutorial.skip`).

**FTUE**: `!flags.tutorialDone` → straight into the tutorial on the game screen (`tutorial.skip`
visible from step 2). Wrong drops fly back, the hand hint replays after 1.5 s idle. After the last
step: 600 ms celebration, `flags.tutorialDone = true`, `flushSave`, the first classic run starts on
the same screen. No banner, interstitial, consent or popup until the first game-over screen is
left; then `Platform.initAds()` (on later launches: at boot). While `gamesPlayed < 2` the first
revive is free ("Free revive!", no ad).

**Game controller** (`js/app/gamecontroller.js`) – the only owner of run sequencing:
```
onDrop(i,r,c): res = session.placePiece(i,r,c); if (!res) return false
  requestSave(run) ; meta events (table below) ; sfx + haptics(res)
  renderer.animatePlace(res); if (res.trayRefilled) renderer.animateTrayRefill()   // input NOT blocked
  if (res.newBest) banner + sfx 'newbest' (non-blocking)
  if (res.status === 'won')  { busy = true; await place anim; finalizeRun('won'); celebrate('win'); show levelResult }
  if (res.status === 'over') { busy = true; await place anim; await renderer.animateGameOver(); offerRevive() }
  return true
offerRevive(): if session.canRevive() && (free || adState.rewardedReady || coins >= REVIVE_COINS):
  revive modal: "{n} to your best" if 0 < best-score; 'No thanks' visible from frame 1, same size;
  countdown ring REVIVE_COUNTDOWN_SEC (pauses in background; expiry = decline, never starts an ad);
  ad buttons armed after AD_BUTTON_ARM_MS; 'Watch ad: Revive' only if rewardedReady; 'Use 200 coins'.
  success → session.revive() → requestSave → renderer.clearGameOver(); animateRevive(rr); busy = false
  decline → finalizeRun('over') → gameover modal
```
`canInteract = !busy && status==='playing' && !modalOpen && !paused`. The controller calls
`drag.cancel()` on pause, back, resize, modal open and status change.

**Run-end screen** (gameover): score count-up ≤ 0.8 s → best bar ("New best!" / "First record set!"
on the very first run / "Only {n} to beat your best!" when score ≥ 60 % of best) → coins earned +
secondary "Watch ad: ×2" (once) → XP bar + level-up → one line of progress toward the nearest
mission → large primary "Play again" (thumb reach, middle third, never bottom-anchored next to the
banner) + secondary "Home". Optional soft upsell chip (`AdPolicy.shouldShowUpsell()`). The review
card (`Platform.requestReview()`) is triggered automatically here only after a new best, once
`gamesPlayed >= ASK_REVIEW_AFTER_GAMES`, once ever (`flags.reviewAsked`), with no question before it.
levelResult (journey/daily) analogous: stars, coins (+×2 ad), Next/Retry/Map.

**Interstitial**: attempted ONLY inside the tap handler of `gameover.again`, `gameover.home`,
`levelResult.next|retry|map|home`, after the result screen was visible ≥ `RESULT_SCREEN_MIN_MS`:
`if (adPolicy.shouldShowInterstitial()) { Sfx.suspend(); if (await Platform.showInterstitial()) adPolicy.markInterstitialShown(); Sfx.resume() }`
then navigate (new board within 300 ms). Never at launch/resume, on back/exit, from pause, from
Home → Play, in the tutorial, after a purchase, or while a modal is open. After every rewarded ad
that resolved true: `adPolicy.markRewardedShown()`.

**Meta event ownership** (the controller is the only caller; meta never calls itself):
- per placement (not tutorial): `trackEvent({type:'place', cells})`; if lines: `trackEvent({type:'clear', lines, combo})`; if all clear: `trackEvent({type:'all_clear'})`.
- booster: `progression.useBooster(type)` only after `session.useHammer/useShuffle` returned non-null, then `trackEvent({type:'booster_used'})`.
- `finalizeRun(reason)` exactly once per run (`'won'|'over'|'abandoned'`), in the same tick that clears `save.run`:
  `recordGame(...)`, `trackEvent({type:'game_end', mode, score})`, journey won → `completeLevel` + `trackEvent({type:'level_complete', stars})`,
  daily won → `completeChallenge(level.id day)` + `trackEvent({type:'daily_complete'})`, `adPolicy.onRunFinished(...)`, `flushSave()`.
  Tutorial never calls it. Abandoning (New game / Restart / Quit while a run exists): classic = recordGame
  with coins & best; journey/daily = failed, no reward.

**Persistence**: `save.run` is rewritten after every successful placePiece / revive / booster
(commit-then-animate). Boot: incompatible `run.v` or `fromJSON` throw → drop the run; a persisted run
with status `'over'` → `finalizeRun('over')` at boot. Home shows **Continue** for a saved classic run;
Journey/Daily cards show Continue for theirs. `flushSave` on pause, before ackGrant, before ads, after finalizeRun.

**Popups** (`js/app/popups.js`): one modal visible at a time (stack); auto popups queue and drain only
on arrival at home, at most one per arrival, none on the first launch, never during a run. Order:
dailyReward > levelUp/themeUnlock (normally shown on the run-end screen) > notifAsk. The
notification soft ask ("Tomorrow: +{n} coins. Remind me?") appears right after a daily-reward
claim when `gamesPlayed >= NOTIF_ASK_MIN_GAMES`; the system dialog only after "Yes"; "Not now" →
once more after `NOTIF_ASK_RETRY_DAYS`, then never; state `'denied'` → offer
`openNotificationSettings()` in Settings. Reminders: scheduled on `pause` only if opted in and
granted, neutral text (`notify.title`, `notify.body`), never loss-framed.

**Pause/resume**: on `'pause'`: `Sfx.suspend()`, `flushSave()`, `drag.cancel()`, pause revive
countdown; open the pause modal only if `!Platform.isBusy() && screen==='game' && status==='playing'
&& !modalOpen`. On `'resume'`: `Sfx.resume()` (respect settings), day rollover re-render, refresh
notification permission, `adPolicy.onSessionStart()` if away ≥ `SESSION_GAP_MIN`. Never auto-unpause.

**Back table**: anything while `Platform.isBusy()` → ignored · tutorial → ignored · revive → No
thanks · gameover/levelResult → home · dailyReward/notifAsk/levelUp → close · pause → resume ·
confirm → cancel · game while playing → pause · other screens → home · home → `Platform.exitApp()`.

**Layout**: UI owns the canvas CSS box. Game screen = flex column: `#hud` (DOM) + canvas (flex:1).
`innerWidth/innerHeight >= 1.2` → `body.landscape`: HUD becomes a left column
(`clamp(200px, 26vw, 320px)`). Must work from 320×480 to tablets; text never overflows in
`en, de, es, fr, it, pt, tr, ru`. CSS uses `env(safe-area-inset-*, 0px)` only (native zeroes WebView
insets). Body: `user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color:transparent;
touch-action:none` on the canvas; contextmenu prevented.

**Settings**: sound, music, haptics, language (Auto + 8), remove ads (+ restore purchases),
privacy settings (only if `Platform.isPrivacyOptionsRequired()`, checked each time Settings opens),
privacy policy (`openUrl`), **Impressum / Legal notice** (offline screen `legal` rendering
`CONFIG.LEGAL`), Rate (`openUrl(CONFIG.PLAY_STORE_MARKET_URL)`, NEVER `requestReview`), share,
notifications, reset progress (confirm), version.

**Shop**: themes (preview, price or "Level N"), boosters (coins), remove_ads tile ("Removes banner
and between-game ads. Optional reward videos stay available." + gift), coin packs ("Best value"
badge on coins_large), "Watch ad: +60 coins" (FREE_COINS_ADS_PER_DAY). Product names from i18n
(`shop.product.<id>`), prices only from `getProducts()`; hide products that are missing. Neutral
wording (no "Buy now!" imperatives aimed at players).

**Debug API** (only with `?debug=1` AND (not the appassets host OR `Platform.info.debug`)):
`window.__blocko = { state(), idle(), startGame(mode, opts), place(i,r,c), drag(i,r,c)|drag(null),
validMoves(), setTimeScale(x), freeze(bool), skipTutorial(), forceGameOver(), goto(id), modal(id),
setNow(iso|null), setLang(code), setTheme(id), setCoins(n), simulate(evt), save(), reset() }`
- `state()` → `{ screen, modals: string[], busy, coins, playerLevel, lang, theme, session: null | { mode, status, score, best, combo, movesSinceClear, piecesPlaced, reviveUsed, board: number[64] /* stored values */, gems: number[64], tray: [{shapeId,color}|null], goals } }`
- `place()` uses the real drop path and resolves with PlaceResult|null once `busy === false` and any
  resulting modal is visible. `startGame(mode, { seed, level, board: string[8] ('.' or '0'..'7'), gems: string[8], tray: [{shapeId,color}], score })` skips the tutorial.
- `validMoves()` → `[{ trayIndex, r, c, lines, cells }]`.

Required i18n keys used by non-UI modules: `praise.good|great|excellent|amazing|unbelievable`,
`mission.<type>` (`{n}`), `theme.<id>`, `gem.1|2|3`, `notify.title`, `notify.body`, `shop.product.<id>`,
`tutorial.step1..3`, `combo` (`{n}`), `nospace`, `newbest`.

## 5. Android shell [android]
**Toolchain** (cannot be compiled in the sandbox – Google Maven is blocked – so follow exactly):
AGP **9.4.0** (built-in Kotlin: never apply `org.jetbrains.kotlin.android`/kapt, no `kotlinOptions`),
Gradle **9.6.1** wrapper (`distributionSha256Sum=9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14`;
wrapper jar from `raw.githubusercontent.com/gradle/gradle/v9.6.1/…`, sha256 `497c8c2a…a9c7`),
compileSdk 37, **targetSdk 36 explicit**, minSdk 24, Java 17. Dependencies: play-services-ads 25.5.0,
user-messaging-platform 4.0.0, billing 9.1.0, activity-ktx 1.13.0, core 1.19.1, core-splashscreen 1.2.0,
webkit 1.17.1, work-runtime 2.12.0, review 2.0.2 (no appcompat/material/coroutines/Gson; org.json).
Assets: `sourceSets { named("main") { assets.directories += rootProject.file("../game").absolutePath } }`.
Release: minify + shrinkResources + `proguard-android-optimize.txt` + `proguard-rules.pro` (keep
`@JavascriptInterface` members of GameBridge + RuntimeVisibleAnnotations). Build types debug /
staging (release config, debug signing, test ads) / release (signing only if `keystore.properties`
exists). `gradle.properties`: version code/name, `BLOCKO_ADS_MODE=test|live`, `BLOCKO_ADMOB_*` ids;
a check task fails `live` release builds with blank/test/placeholder ids. Fallback documented:
AGP 8.13.2 + Gradle 8.14.x + kotlin-android 2.3.x + compileSdk 36.

**Manifest**: INTERNET, ACCESS_NETWORK_STATE, VIBRATE, POST_NOTIFICATIONS; `<application
android:appCategory="game" android:enableOnBackInvokedCallback="true">`; AdMob `APPLICATION_ID`
meta-data via manifest placeholder; `DELAY_APP_MEASUREMENT_INIT=true`; MainActivity exported with
a broad `configChanges` list (no recreation on rotate/fold/resize/uiMode/fontScale/locale…);
portrait at runtime only when `smallestScreenWidthDp < 600`.

**Activity/WebView**: `installSplashScreen()` (keep until JS ready, max 2.5 s), `enableEdgeToEdge()`,
hide only the status bar (nav bar stays visible); root = vertical LinearLayout (#1B1446): WebView
(weight 1) + fixed-height banner container (min height reserved before any load unless
adsRemoved). Insets applied as native padding; WebView receives zeroed insets. WebView settings:
JS on, **domStorage on**, no file/content access, no zoom, `textZoom=100`, background #1B1446,
no overscroll, long-press disabled, debugging only in debug. Order: settings →
`addJavascriptInterface(bridge, "BlockoNative")` → clients → `loadUrl(index)`. `WebViewAssetLoader`
(origin `https://appassets.androidplatform.net/assets/` must never change). Only the asset host
navigates in-app; https/http/market/mailto open externally; other schemes are blocked.
`onRenderProcessGone` → rebuild the WebView (max 3 times / 60 s, then native retry view). WebView
< 90 → native "update WebView" view.

**Bridge**: all `@JavascriptInterface` work that touches Views/ads/billing/permissions runs via
`runOnUiThread`; sync getters return `@Volatile` cached state. One main-thread `emit(JSONObject)`
queues while `!jsReady` (`jsReady=false` before every `loadUrl`, on `pageUnloading()` from the old
document's `pagehide`, and on renderer crash – never in `onPageStarted`, which is posted at commit and
can run after the new document's `ready()`); `ready()` (idempotent) flushes, enables the back callback,
re-sends entitlements, adState, insets and the ledger grants (unacknowledged + last 7 days). Payloads only via
org.json. Durable save: `saveData` keeps the latest snapshot and writes it with `AtomicFile` on a
single-thread executor; `ackGrant` runs on the same executor.

**Lifecycle**: `pause`/`resume` from onStop/onStart, suppressed while a native overlay is in front;
`webView.onPause()/onResume()` there; never `pauseTimers()`. Back: `OnBackPressedCallback(false)`
enabled in `ready()`, disabled on `pageUnloading()`/crash; never override onBackPressed. `exitApp()` →
`moveTaskToBack(true)`.

**Ads**: `initAds()` → each launch `requestConsentInfoUpdate` → `loadAndShowConsentFormIfRequired`
→ if `canRequestAds()` → `MobileAds.initialize` once (background thread) → preload interstitial,
rewarded, banner; also init immediately if consent from a previous session allows it. No ad request
before `canRequestAds()`. `RequestConfiguration`: max ad content rating T, test device ids from
gradle property. Debug: `ConsentDebugSettings` EEA. Results only after dismissal; reload after every
show; retry 30 s/60 s/120 s…max 5 min. Interstitial/rewarded expire 1 h after loading (timer + check on
every start/resume): dropped, reloaded, never reported ready meanwhile; a renderer crash drops both
(and ads from loads still in flight). Banner: `AdSize.getLargeAnchoredAdaptiveBannerAdSize`, container
min height set before load, INVISIBLE when hidden (never GONE during a run), destroyed + GONE once
when ads are removed. Native enforces adsRemoved (no banner/interstitial even if JS asks).

**Billing** (PBL 9.1.0): one client, `enablePendingPurchases(PendingPurchasesParams…enableOneTimeProducts())`,
`enableAutoServiceReconnection()`; `queryPurchasesAsync(INAPP)` on connect and every onStart;
remove_ads: PURCHASED → acknowledge if needed, persist adsRemoved (commit); refunds flip it to false
only after a successful query without it. Coins: ledger entry (commit) BEFORE consume → consume →
`grant`; if the commit fails the purchase stays unconsumed (retried by the next query). Only an update
carrying the product being bought (or a non-OK flow result) answers an open `purchase`; other updates
(pending purchase completed, purchase outside the app) are processed in the background + re-query.
Pending purchases never granted. Status mapping per §4.14. Offer token from
`oneTimePurchaseOfferDetailsList`.

**Other**: reminders via WorkManager unique work (`REPLACE`) + channel `reminders` + monochrome
small icon, permission re-checked in the worker; Play In-App Review; share via `ACTION_SEND`
chooser; haptics via `VibratorManager`/`Vibrator` with predefined effects (API-level fallbacks,
`hasVibrator()`); open URL via `ACTION_VIEW` (market:// fallback to https).

## 6. Release & compliance (documented in docs/, German)
- Play Console target audience **18+** ("appeals to children: no"); IARC questionnaire with ads +
  in-app purchases; AdMob blocking controls (gambling, dating); max ad content rating T.
- Data safety: data collected via Google Mobile Ads SDK (approx. location, device/advertising IDs,
  app interactions, diagnostics) for advertising/analytics/fraud prevention; encrypted in transit;
  no account. Contains ads = yes; Advertising ID = yes.
- Legal (Germany): Impressum (§ 5 DDG) in the app and online, privacy policy (DE/EN) in `docs/site/`,
  trader declaration in Play Console, Gewerbeanmeldung/tax hints (not legal advice).
- `app-ads.txt` at the root of the developer website (GitHub Pages user site `memo5561.github.io`).
- New personal Play developer accounts: closed test with ≥ 12 testers for 14 days before production
  (use `BLOCKO_ADS_MODE=test` for that build).
- `tools/check-release.mjs` refuses release while placeholders remain (LEGAL, SUPPORT, ad ids).
