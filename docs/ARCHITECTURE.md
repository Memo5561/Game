# Blocko – Architecture & Module Contracts

This document is the single source of truth for how the game is put together. Every module
MUST follow the contracts below exactly (names, signatures, data shapes), because the modules are
written in parallel. If you need something that is not in the contract, add it as an *extra*
export but never change or remove what is specified here.

## 1. Product summary

**Blocko** is an 8×8 block-puzzle game (genre of 1010!, Woodoku, Block Blast) for Android.
The game itself is an HTML5 app (vanilla ES modules, Canvas 2D + DOM UI, no build step) that runs
inside a thin native Android shell (Kotlin, WebView) which provides AdMob ads (with Google UMP
consent), Google Play Billing, haptics, local reminder notifications, share and in-app review.

Core loop: drag one of 3 pieces from the tray onto the board → full rows/columns clear → score,
combo, juicy feedback → when all 3 are used a new tray appears → game over when none of the
remaining pieces fits anywhere.

Retention/meta loop (what keeps players coming back):
- **Classic** endless mode, high-score chase ("only 120 to beat your best!"), resumable runs.
- **Journey**: endless procedural levels (collect gems, 1–3 stars), level map, boosters.
- **Daily Challenge**: one seeded level per day, reward + daily-challenge streak.
- 7-day **login reward** calendar, 3 **daily missions** + bonus chest, **player level / XP**.
- **Themes** (block skins) bought with coins, some unlocked by player level.
- Local **reminder notification** (opt-in), Play **in-app review** after a good moment.

Monetization (fair, policy-compliant, never deceptive):
- Rewarded ads (always opt-in): revive, double coins, free booster, double daily reward, free coins.
- Interstitials only between runs, frequency-capped (see `CONFIG.ADS`), never during play,
  never in the first runs.
- Adaptive banner at the bottom (native view below the WebView).
- In-app products: `remove_ads` (non-consumable, removes interstitials + banner, keeps opt-in
  rewarded ads), `coins_small`, `coins_large` (consumables).
- No paid random rewards (no loot boxes), no fake buttons, no ads disguised as content.

## 2. Repository layout and ownership

```
game/                      Web game = Android assets root (served at https://appassets.androidplatform.net/assets/)
  index.html               [ui]
  css/style.css            [ui]
  js/config.js             [shared, do not change semantics]
  js/main.js               [ui]  bootstrap → App
  js/app/*.js              [ui]  App controller, game controller, debug API
  js/ui/*.js               [ui]  screens, modals, components, i18n
  js/core/*.js             [core] pure game logic (no DOM!)
  js/meta/*.js             [meta] save data, progression, missions, ad policy (no DOM!)
  js/render/*.js           [render] canvas renderer, themes, sprites, particles
  js/input/*.js            [render] pointer/drag handling
  js/audio/*.js            [audio] WebAudio synthesized sound + music
  js/platform/bridge.js    [platform] JS side of the native bridge + browser mock
android/                   [android] Android Studio project (Kotlin)
tests/unit/*.test.mjs      node:test unit tests (core, meta)
tests/e2e/*.mjs            Playwright end-to-end tests (run.mjs = entry)
tools/                     serve.mjs, simulate.mjs, make-icons.mjs, store-assets.mjs
docs/                      German user docs, store listing, privacy policy, this file
```

Rules for all JS:
- Plain modern JavaScript ES modules (ES2020), **no build step, no npm runtime dependencies,
  no external network requests** (the game must work 100% offline from local files).
- Relative imports with explicit `.js` extension (e.g. `import { Board } from './board.js'`).
- `game/js/core/*` and `game/js/meta/*` must not touch `window`, `document`, `localStorage`
  directly (except `meta/storage.js`, which wraps localStorage defensively), so they run in Node
  for unit tests.
- No `Math.random()` inside core logic – always use the `RNG` passed in (deterministic, saveable).
- Mobile performance matters: avoid allocations in per-frame code, avoid layout thrash.
- All user-visible text goes through `t(key, params)` from `js/ui/i18n.js`.

## 3. Coordinates and shared data shapes

- Board is `CONFIG.BOARD_SIZE` (8) × 8. `r` = row (0 = top), `c` = column (0 = left).
  Linear index `i = r * 8 + c`.
- **Color index**: integer 0..7 into the active theme palette. Board stores `color + 1`
  (0 = empty).
- **Gem type**: 0 = none, 1 = diamond (blue), 2 = star (gold), 3 = heart (red). A gem always sits
  on a *filled* cell (it is inside a pre-filled block) and is collected when that cell is cleared.
- **Shape**: `{ id: string, cells: Array<[r, c]>, w: number, h: number, size: number, tier: 1|2|3|4, weight: number }`
  `cells` are normalized (min r = 0, min c = 0). `tier` = difficulty class (1 small/easy … 4 big/awkward).
- **Piece** (an instance in the tray): `{ uid: number, shapeId: string, color: number }`.
- **Tray**: `Array<Piece | null>` of length 3 (null = already placed this round).
- **Day key**: local date string `'YYYY-MM-DD'`.

## 4. Module contracts

### 4.1 `js/core/rng.js` [core]
```js
export class RNG {
  constructor(seed /* uint32 */)
  next()            // float in [0, 1)
  int(n)            // integer 0..n-1
  range(a, b)       // integer a..b inclusive
  chance(p)         // boolean
  pick(array)
  weighted(items, weightFn)   // pick item with probability ∝ weightFn(item)
  shuffle(array)    // in place, returns array
  getState()        // uint32 – saveable
  setState(state)
}
export function hashString(str)   // → uint32 (stable, e.g. FNV-1a)
export function randomSeed()      // → uint32 (crypto.getRandomValues if available, else Math.random) – the ONLY non-deterministic source
```
Algorithm: mulberry32 (single uint32 state).

### 4.2 `js/core/shapes.js` [core]
```js
export const SHAPES      // frozen array of Shape (see §3); at least: 1x1, 1x2/2x1, 1x3/3x1, 1x4/4x1, 1x5/5x1,
                         // 2x2, 3x3, 2x3/3x2, small L (3 cells, 4 rotations), L/J (4 cells, 8 orientations),
                         // big L (5 cells corner of 3x3, 4 rotations), T (4 rotations), S/Z (4), (no diagonals)
export const SHAPE_BY_ID // { [id]: Shape }
export function getShape(id)
```

### 4.3 `js/core/board.js` [core]
```js
export class Board {
  constructor(size = 8)
  size
  cells   // Uint8Array(size*size): 0 empty, 1..8 = colorIndex+1
  gems    // Uint8Array(size*size): 0 none, 1..3 gem type (only on filled cells)
  get(r, c)                  // 0 or colorIndex+1 (out of bounds → 255 treated as blocked)
  isEmpty(r, c)
  canPlace(shape, r, c)      // shape top-left at (r,c); all cells in bounds & empty
  place(shape, r, c, color)  // writes color+1; returns array of [r,c] placed
  findFullLines()            // → { rows: number[], cols: number[] }
  previewLines(shape, r, c)  // lines that WOULD be full after placing (no mutation) → { rows, cols }
  clearLines(rows, cols)     // clears cells of those lines → { cells: [{r,c,color,gem}], gems: {1:n,2:n,3:n} }
                             // (a cell at a row/col intersection is reported once)
  clearCells(list /* [[r,c]] */) // generic removal (boosters, revive) → same return shape as clearLines
  anyPlacement(shape)        // boolean
  placements(shape)          // → array of [r,c] where it fits
  filledCount()
  isBoardEmpty()
  gemCount()                 // remaining gems → {1:n,2:n,3:n}
  clone()
  toJSON()                   // { size, cells: number[], gems: number[] }
  static fromJSON(obj)
}
```

### 4.4 `js/core/scoring.js` [core]
```js
export function placementPoints(cellCount)          // = cellCount
export function clearPoints(lines, combo)          // LINE_POINTS[lines] * max(1, combo)  (CONFIG.SCORING)
export function praiseFor(lines, combo)            // → null | 'good' | 'great' | 'excellent' | 'amazing' | 'unbelievable'
                                                   //   (i18n key suffix: t('praise.' + key))
```
Rules: combo starts at 0. A placement that clears ≥1 line: `combo += 1`, `movesSinceClear = 0`,
points = `clearPoints(lines, combo)`. A placement without a clear: `movesSinceClear += 1`; when
`movesSinceClear >= COMBO_KEEP_MOVES` → `combo = 0`. Board fully empty after a clear →
`+ALL_CLEAR_BONUS`. UI shows "Combo xN" when `combo >= 2`.

### 4.5 `js/core/generator.js` [core] – adaptive piece generation (key to "one more game")
```js
export class PieceGenerator {
  constructor({ rng, mode /* 'classic'|'journey'|'daily'|'tutorial' */, difficulty /* optional 0..1 base */ })
  nextTray(board, ctx)  // ctx: { score, trayIndex, traysSinceClear, combo, goals? } → Piece[3]
  reviveTray(board)     // 3 pieces guaranteed placeable together (small/medium)
  shuffleTray(board, count) // `count` (1..3) new pieces, solvable together if at all possible
  toJSON() / static fromJSON(obj, rng)   // uid counter etc. (rng state saved separately by session)
}
export function analyzeTray(board, shapes, { nodeLimit }) // → { solvable: bool, maxLines: number }
                                                          // DFS over orders & positions incl. line clears
```
Design goals (tune with `tools/simulate.mjs`):
- Sample several candidate trays (weighted by tier & difficulty), evaluate with `analyzeTray`.
- Early game (first ~8 trays / low score): always solvable, strongly favour trays that allow line
  clears → players quickly experience big combos ("wow" moments).
- Difficulty ramps with score (more tier 3–4 shapes, less help). From mid game a small chance of
  an unsolvable tray is allowed so runs end (target: median skilled run 4–8 minutes).
- **Mercy**: if the board is >55 % full or no clear for 2+ trays, prefer trays that enable a clear.
- **Journey/daily**: prefer pieces that can clear lines containing gems when the player struggles.
- Must be fast: whole `nextTray` < 8 ms on a mid phone (node limit in DFS; prune).
- Colors: random per piece via rng (avoid 3 identical colors in one tray).

### 4.6 `js/core/levels.js` [core]
```js
export function generateLevel(n)            // Journey level n (1-based), deterministic from n
export function generateDailyLevel(dayKey)  // deterministic from the day key
// LevelDef:
// { id: string ('L12' | 'D2026-10-18'), kind: 'journey'|'daily', number, seed,
//   prefilled: [{r,c,color}], gems: [{r,c,type}],                // gems are on prefilled cells
//   goals: { gems?: {1?:n,2?:n,3?:n}, score?: number },          // journey: gems; daily: score (+ optional gems)
//   par: [par3, par2],    // stars: piecesPlaced <= par3 → 3★, <= par2 → 2★, else 1★
//   rewardCoins }
```
Difficulty grows with n (more gems, more prefilled cells, gems in harder spots, e.g. corners).
Levels must always be completable (validate by simulation in tests: a simple bot clears ≥ 95 % of
the first 50 levels). Patterns should look designed (symmetry, shapes, letters), not noise.

### 4.7 `js/core/game.js` [core] – one run
```js
export class GameSession {
  static create({ mode, seed, level /* LevelDef for journey/daily */, bestScore })
  static fromJSON(json)        // resume
  toJSON()                     // everything needed to resume exactly (board, tray, rng state, counters…)

  mode; level; board; tray; score; combo; movesSinceClear; piecesPlaced; linesCleared; maxCombo;
  trayIndex; reviveUsed; status /* 'playing' | 'over' | 'won' */; bestScore; goals /* progress */
  // goals progress: { gems: {type: {need, have}}, score: {need, have} } (only present keys)

  canPlace(trayIndex, r, c)    // boolean
  preview(trayIndex, r, c)     // → { valid, rows, cols, cells: [[r,c]] }
  isPiecePlaceable(trayIndex)  // boolean (false for null slots)
  placePiece(trayIndex, r, c)  // → PlaceResult | null (invalid)
  canRevive()                  // status 'over' && !reviveUsed && mode !== 'tutorial'
  revive()                     // clears the 2 fullest rows + 2 fullest cols, new reviveTray → ReviveResult
  useHammer(r, c)              // clears 3x3 around (r,c) (no score) → BoosterResult (journey/daily only)
  useShuffle()                 // replaces remaining tray pieces → { tray } (journey/daily only)
  tutorialHint()               // tutorial mode: { trayIndex, r, c } of the scripted move, else null
  stars()                      // journey/daily when won: 1..3
}
// PlaceResult = {
//   trayIndex, piece, r, c, placedCells: [[r,c]], placePoints,
//   lines: { rows, cols }, linesCount, cleared: [{r,c,color,gem}], gemsCollected: {type:n},
//   combo, clearPoints, allClear, allClearBonus, praise /* null|key */, totalPoints,
//   score /* after */, newBest /* score just passed bestScore for the first time this run */,
//   trayRefilled: boolean, tray /* current tray after refill */,
//   status /* 'playing'|'over'|'won' */
// }
// ReviveResult  = { cleared: [{r,c,color,gem}], tray }
// BoosterResult = { cleared: [{r,c,color,gem}], gemsCollected }
```
Game over is evaluated after every placement (and after refill): if no remaining tray piece fits
→ `status = 'over'`. Journey/daily: all gem goals and score goal reached → `status = 'won'`
(checked before game over). Tutorial mode: 3 scripted steps (pre-built boards; each step needs
exactly the hinted move to clear a line), `status = 'won'` after the last step.

### 4.8 `js/meta/storage.js` [meta]
```js
export const SAVE_KEY = 'blocko.save.v1'
export function defaultSave()   // full default SaveData (see below)
export function loadSave()      // never throws; merges stored data over defaults; migrates
export function writeSave(data) // never throws (quota/private mode safe)
export function clearSave()
```
SaveData (version 1):
```js
{
  version: 1, createdAt, lastPlayedAt,
  settings: { sound: true, music: true, haptics: true, lang: 'auto' },
  coins, xp,
  stats: { gamesPlayed, bestScore, totalScore, totalLines, bestCombo, piecesPlaced, allClears },
  themes: { owned: ['jewel'], selected: 'jewel' },
  boosters: { hammer, shuffle },
  daily: { lastClaimDay: null, streak: 0 },             // login calendar (day 1..7 cycle)
  missions: { day: null, list: [], bonusClaimed: false },
  journey: { unlocked: 1, stars: {} /* {n: 1..3} */ },
  challenge: { completed: {} /* {dayKey: stars} */, streak: 0, lastDay: null },
  ads: { gamesSinceInterstitial: 0, lastInterstitialAt: 0, lastRewardedAt: 0, freeCoins: { day: null, count: 0 } },
  iap: { adsRemoved: false, grantedTokens: [] /* last 50 */ },
  flags: { tutorialDone: false, notifAsked: false, reviewAsked: false },
  run: null   // GameSession.toJSON() of an unfinished classic run (resume), or null
}
```

### 4.9 `js/meta/progression.js` [meta]
```js
export function dayKey(date = new Date())        // local 'YYYY-MM-DD'
export function daysBetween(dayKeyA, dayKeyB)    // integer, B - A
export function xpForLevel(level)                 // XP needed to go from level → level+1
export class Progression {
  constructor(save, { now = () => new Date(), onChange } = {})  // keeps reference to save; onChange() after every mutation
  save
  // coins
  get coins(); addCoins(n, source); spendCoins(n) /* bool */
  // xp / level
  levelInfo()            // { level, xp, xpIntoLevel, xpForNext, progress 0..1 }
  addXP(n)               // → { leveledUp, levels: [newLevels...], coins, unlockedThemes: [ids] }
  // game results
  recordGame({ mode, score, lines, maxCombo, pieces, allClears })  // → { newBest, coinsEarned, xp: addXP result }
  get bestScore()
  // login calendar
  dailyRewardStatus()    // { available, day /*1..7*/, streak, rewards: [{day, coins, boosters?}] }
  claimDailyReward(multiplier = 1) // → { coins, boosters } (updates streak; missing a day resets to day 1)
  // missions (3 per day, regenerated when the day changes)
  missions()             // → Mission[] (see missions.js)
  trackEvent(evt)        // → Mission[] that just became complete (claimable)
                         // evt: {type:'place', cells} | {type:'clear', lines, combo} | {type:'game_end', mode, score}
                         //      | {type:'level_complete', stars} | {type:'daily_complete'} | {type:'booster_used'}
                         //      | {type:'all_clear'}
  claimMission(id)       // → coins (0 if not claimable)
  missionBonusStatus()   // { available, claimed }
  claimMissionBonus()    // → coins
  // themes
  ownsTheme(id); buyTheme(id, price) /* bool */; selectTheme(id); get selectedTheme()
  unlockThemesForLevel(level) // used internally by addXP (themes with unlockLevel)
  // boosters
  boosterCount(type); addBooster(type, n); useBooster(type) /* bool */; buyBooster(type) /* bool, uses CONFIG price */
  // journey & daily challenge
  get journeyUnlocked(); completeLevel(n, stars) // → { coins, firstTime }
  challengeStatus(dayKey) // { completed, stars, streak }
  completeChallenge(dayKey, stars) // → { coins, streak }
  // free coins via rewarded ad
  freeCoinsLeft(); grantFreeCoins() // → coins
}
```
### 4.10 `js/meta/missions.js` [meta]
```js
export const MISSION_TYPES // e.g. clear_lines, score_single, play_games, combo_reach, place_pieces,
                           //      multi_clear (≥3 lines at once), journey_levels, daily_challenge, use_booster
export function generateMissions(dayKey, playerLevel) // deterministic → Mission[3] (distinct types)
// Mission = { id, type, target, progress, reward, claimed, textKey: 'mission.<type>' }  (text: t(textKey, {n: target}))
```
### 4.11 `js/meta/adpolicy.js` [meta]
```js
export class AdPolicy {
  constructor(save, { config = CONFIG.ADS, nowMs = () => Date.now() })
  onRunFinished()                 // gamesSinceInterstitial++
  shouldShowInterstitial()        // respects adsRemoved, INTERSTITIAL_MIN_GAMES, EVERY_N_GAMES, MIN_INTERVAL_SEC (since last interstitial OR rewarded)
  markInterstitialShown()
  markRewardedShown()
}
```

### 4.12 `js/render/*` and `js/input/*` [render]
`js/render/theme.js`
```js
export const THEMES // [{ id, nameKey: 'theme.<id>', price, unlockLevel /* or 0 */, style: 'gloss'|'neon'|'candy'|'wood'|'pixel'|'gold',
                    //    palette: [8 css colors], bg: [top, bottom] gradient, board, cellEmpty, cellEmptyEdge, accent, text }]
                    // ids (exact): 'jewel' (default, free), 'neon', 'candy', 'wood', 'pixel', 'gold'
export function getTheme(id)
export function themeCssVars(theme) // { '--bg-top': …, '--bg-bottom': …, '--accent': …, '--text': … } for the DOM UI
export function renderThemePreview(canvas, theme) // small 4x4 preview for the shop
```
`js/render/renderer.js`
```js
export class Renderer {
  constructor(canvas, { theme })
  setTheme(theme)
  setSession(session)         // GameSession to draw (board + tray); null = draw empty board
  resize()                    // reads canvas CSS size + devicePixelRatio (cap 3), recomputes layout; called on ResizeObserver
  layout                      // { cell, boardX, boardY, boardPx, trayRects: [{x,y,w,h}], landscape }
  timeScale                   // 1 = normal; tests set e.g. 20
  start(); stop()             // RAF loop; draws only when something changed or animates (battery)
  invalidate()                // request a redraw
  // feedback / animations – all return Promises resolving when the visual is done
  animatePlace(result)        // pop-in of placed cells, then clear animation if lines (flash, sweep, shards), floating "+points",
                              //   praise text, combo text, all-clear celebration, screen shake for big clears
  animateTrayRefill()         // pieces bounce in
  animateGameOver()           // board cells turn grey row by row (bottom → top)
  animateRevive(reviveResult) // blast of cleared cells + tray refill
  animateBlast(cells)         // hammer
  floatText(text, x, y, opts) // canvas-space floating text
  celebrate(kind)             // 'newBest' | 'win' | 'allClear' confetti
  showHint(hint)              // animated hand: tray piece → target cell (tutorial); hideHint()
  setTargetMode(mode)         // null | 'hammer' (3x3 highlight under pointer)
  setPieceDimming(bool)       // dim tray pieces that cannot be placed anywhere (default true)
}
```
`js/input/drag.js`
```js
export class DragController {
  constructor(canvas, renderer, {
    canInteract: () => boolean,
    onPickup(trayIndex),                 // sfx + haptic
    onHover(placement /* {r,c,valid} | null */),
    onDrop(trayIndex, r, c) => boolean,  // controller tries session.placePiece; true = placed
    onCancel(trayIndex),                 // piece flies back to the tray
    onTapCell(r, c),                     // only when renderer target mode is set (hammer)
  })
  destroy()
}
```
Drag UX (important for feel): touching anywhere in a tray slot picks the piece; it scales from
tray size to board cell size and floats ABOVE the finger (offset ≈ 2 cells + half piece height)
so the finger never covers it. Snap: compute the fractional top-left board cell from the dragged
piece position, round it; if invalid, accept the nearest valid position within ~0.6 cell. While
hovering a valid spot: ghost on the board + the rows/cols that would clear are highlighted in the
piece colour. Release on invalid spot → piece flies back. Pointer Events with
`setPointerCapture`, `touch-action: none`, only one active pointer.

### 4.13 `js/audio/sfx.js` [audio]
```js
export const Sfx = {
  init(),                 // create AudioContext lazily
  unlock(),               // call on first user gesture (resumes context)
  setSoundEnabled(bool), setMusicEnabled(bool),
  play(name, opts),       // names: 'pickup','place','invalid','return','clear'{lines,combo},'combo'{combo},'praise'{level},
                          //   'allclear','gameover','newbest','coin','click','reward','levelwin','levelfail',
                          //   'hammer','shuffle','revive','tick','unlock','star'{index}
  startMusic(), stopMusic(),
  suspend(), resume(),    // app background / foreground
}
```
All sounds are synthesized with WebAudio (no audio files, no licensing issues). Pleasant,
soft, never harsh; clear sounds rise in pitch with combo (pentatonic). Music: calm generative loop,
low volume, crossfades, must never clip. Everything must fail silently if WebAudio is missing.

### 4.14 `js/platform/bridge.js` [platform] – JS side of the Android bridge
```js
export const Platform = {
  isNative,                       // true when window.BlockoNative exists
  info,                           // getInfo() result after init
  init(),                         // Promise<void>: read info, install window.__blockoNative.dispatch, call native ready()
  on(type, fn),                   // → unsubscribe; types: 'pause','resume','back','entitlements','grant'
  get adsRemoved(),
  showInterstitial(),             // Promise<boolean shown>
  showRewarded(placement),        // Promise<boolean rewarded> (placement: 'revive'|'double_coins'|'booster'|'daily_double'|'free_coins')
  isRewardedReady(),              // boolean (browser mock: true)
  setBannerVisible(visible),
  getProducts(),                  // Promise<[{ id, title, price /* formatted */ }]>  (empty array if billing unavailable)
  purchase(productId),            // Promise<'success'|'cancelled'|'pending'|'error'|'already_owned'|'unavailable'>
  restorePurchases(),             // Promise<{ ok, adsRemoved }>
  ackGrant(token),
  haptic(kind),                   // 'light'|'medium'|'heavy'|'success'|'error' (respect settings in caller)
  share(text),
  requestReview(),
  openUrl(url),
  isPrivacyOptionsRequired(),     // boolean → show "Privacy settings" in Settings
  showPrivacyOptions(),           // Promise<void>
  getNotificationPermission(),    // 'granted'|'denied'|'prompt'|'unsupported'
  requestNotificationPermission(),// Promise<boolean>
  scheduleReminder(delayMinutes, title, body),
  cancelReminder(),
  exitApp(),
}
```
Native protocol (implemented by `android/…/GameBridge.kt`, interface name **`BlockoNative`**):
JS → native methods (all args primitives, return string/boolean/void):
`getInfo(): String(JSON)` · `ready()` · `showInterstitial(requestId)` · `showRewarded(requestId, placement)` ·
`isRewardedReady(): Boolean` · `setBannerVisible(Boolean)` · `queryProducts(requestId)` ·
`purchase(requestId, productId)` · `restorePurchases(requestId)` · `ackGrant(token)` · `haptic(kind)` ·
`share(text)` · `requestReview()` · `openUrl(url)` · `isPrivacyOptionsRequired(): Boolean` ·
`showPrivacyOptions(requestId)` · `getNotificationPermission(): String` ·
`requestNotificationPermission(requestId)` · `scheduleReminder(delayMinutes: Int, title, body)` ·
`cancelReminder()` · `exitApp()` · `log(level, message)`.

`getInfo()` JSON: `{ platform:'android', appVersion, versionCode, sdkInt, locale, adsRemoved, privacyOptionsRequired, notificationPermission }`.

Native → JS: `window.__blockoNative.dispatch(event)` (event is a JSON object literal) with
- `{type:'interstitialResult', requestId, shown}`
- `{type:'rewardedResult', requestId, rewarded, shown}`
- `{type:'productsResult', requestId, products:[{id,title,price}]}`
- `{type:'purchaseResult', requestId, productId, status}`
- `{type:'restoreResult', requestId, ok, adsRemoved}`
- `{type:'privacyOptionsResult', requestId}`
- `{type:'notificationPermissionResult', requestId, granted}`
- `{type:'entitlements', adsRemoved}` – whenever ownership of `remove_ads` is (re)established
- `{type:'grant', token, productId}` – a consumable was bought & consumed; JS adds
  `CONFIG.PRODUCTS[productId].coins`, saves, then calls `ackGrant(token)`. Native re-sends unacked
  grants after every `ready()`. JS ignores tokens already in `save.iap.grantedTokens`.
- `{type:'pause'}`, `{type:'resume'}`, `{type:'back'}` (back is always forwarded once JS called `ready()`)

Browser mock (when not native): simulated ads via a small DOM overlay labelled "TEST AD"
(~1.5 s; `?mock=fast` → 50 ms; `?mock=nofill` → rewarded resolves false), purchases succeed and
emit `entitlements`/`grant` like native, haptic → `navigator.vibrate`, share → `navigator.share`
or clipboard, reminders → console log.

### 4.15 UI / App [ui]
- `js/main.js`: boots `App` after DOMContentLoaded.
- Screens: **home** (logo, Play (shows "Continue" if a classic run is saved), Journey card with
  level number, Daily Challenge card, coin counter, bottom nav: Themes/Shop, Missions (badge),
  Settings), **game** (HUD: score with count-up, best, pause; journey/daily: goals + moves +
  booster buttons), **pause**, **revive offer** (5 s countdown ring, "Watch ad" / "No thanks"),
  **game over** (score, best, coins earned, "x2 coins (ad)", Play again, Home), **level complete /
  failed**, **journey map**, **shop** (themes grid with previews, boosters, remove ads, coin packs,
  free coins via ad), **missions**, **daily reward** modal (7-day calendar), **settings** (sound,
  music, haptics, language, remove ads, restore purchases, privacy settings (if required), privacy
  policy, rate, share, reset progress with confirm, version), **tutorial** overlay.
- Android back button → `Platform.on('back')`: close top modal → pause game → on home: exit.
- When the app goes to background (`pause`) during a run: auto-pause, save, `Sfx.suspend()`.
- Layout must work from 320×480 up to tablets in **landscape** (Android 16 ignores portrait lock
  on large screens). The canvas fills the play area; DOM overlays are responsive.
- Text never overflows in any of the 8 languages: `en, de, es, fr, it, pt, tr, ru`.
- Respect `save.settings` (sound/music/haptics). Haptics: light on pickup, medium on place,
  heavy on multi-line clears, error on invalid.
- Debug API (enabled only with `?debug=1`): `window.__blocko = { state(), startGame(mode, opts),
  place(trayIndex, r, c) /* Promise<PlaceResult|null> */, validMoves(), setTimeScale(x), skipTutorial(),
  forceGameOver(), goto(screen), setCoins(n), save() /* SaveData */, reset() }` – used by
  e2e tests and the store screenshot generator.

Required i18n keys used by non-UI modules: `praise.good|great|excellent|amazing|unbelievable`,
`mission.<type>` (with `{n}`), `theme.<id>`, `gem.1|2|3`, `notify.title`, `notify.body`,
`notify.streak` (with `{n}`).

## 5. Android shell [android]
- Kotlin, single `MainActivity : ComponentActivity`, package/applicationId
  `io.github.memo5561.blocko`, minSdk 24, target/compileSdk 36 (Google Play requirement since
  31 Aug 2026), splash screen API, edge-to-edge + immersive (system bars hidden, swipe to show),
  cutout-safe padding, background colour `#1B1446`.
- WebView loads `https://appassets.androidplatform.net/assets/index.html` through
  `WebViewAssetLoader`; the `game/` folder is added as an assets source dir in Gradle (no copying).
  No file/content access, no zoom, `textZoom = 100`, navigation outside the asset host opens the
  external browser. Handles `onRenderProcessGone` without crashing.
- Ads: Google Mobile Ads SDK + UMP consent (EEA/UK/CH), test ad unit ids in debug builds, real ids
  from `android/gradle.properties` for release. Interstitial + rewarded preloaded, reloaded after
  show, retry with backoff; adaptive anchored banner below the WebView.
- Billing: Google Play Billing Library (≥ 8, as required by Play), `remove_ads` (acknowledge),
  `coins_small`/`coins_large` (consume → `grant` event with pending-grant persistence).
- Reminder notification via WorkManager, POST_NOTIFICATIONS runtime permission on API 33+.
- In-app review via Play Review API. Share via `ACTION_SEND`. Haptics via `Vibrator`.
- Release: R8 minify + resource shrinking, keep rules for `@JavascriptInterface`.
