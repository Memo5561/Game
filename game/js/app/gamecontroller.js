// Game controller (docs/ARCHITECTURE.md §4.15) – the ONLY owner of run sequencing.
//
// Per placement:   session.placePiece → persist save.run → meta events → sfx/haptics →
//                  renderer animations (input is not blocked while they play) → won/over flows.
// Game over:       busy → place animation → "No space!" → second chance (classic: revive modal with
//                  countdown; journey/daily: "stuck" panel with boosters / revive / give up) →
//                  finalizeRun exactly once → result modal (gameover | levelResult).
// Persistence:     save.run is rewritten after every successful placement / revive / booster
//                  (commit-then-animate). A run is written on its first placement; a run with no
//                  placement is simply discarded when abandoned.
// Tutorial (FTUE): 3 scripted steps on the game screen with a hand hint after 1.5 s idle; then a
//                  600 ms celebration and the first classic run starts on the same screen.
//
// The controller owns the Renderer, the DragController and the HUD of the game screen.

import { CONFIG } from '../config.js';
import { GameSession, SESSION_VERSION } from '../core/game.js';
import { getShape } from '../core/shapes.js';
import { generateLevel } from '../core/levels.js';
import { PRAISE_LEVELS } from '../core/scoring.js';
import { Renderer } from '../render/renderer.js';
import { getTheme } from '../render/theme.js';
import { DragController } from '../input/drag.js';
import { Sfx } from '../audio/sfx.js';
import { Platform } from '../platform/bridge.js';
import { requestSave, flushSave } from '../meta/storage.js';
import { Hud } from '../ui/hud.js';
import { t } from '../ui/i18n.js';
import { wait, dur } from '../ui/anim.js';

/** Thinking time between two moves counts as play time up to this cap (idle phones don't). */
const IDLE_CAP_MS = 20000;
/** Tutorial hand hint after this much idle time. */
const HINT_IDLE_MS = 1500;
/** Tutorial: celebration after the last step before the first classic run starts. */
const TUTORIAL_CELEBRATION_MS = 600;
/** Pause between the win celebration and the level result. */
const WIN_RESULT_DELAY_MS = 900;

export class GameController {
  /** @param {Object} app the App */
  constructor(app) {
    this.app = app;
    /** @type {GameSession|null} */
    this.session = null;
    /** @type {Renderer|null} */
    this.renderer = null;
    /** @type {DragController|null} */
    this.drag = null;
    /** @type {Hud|null} */
    this.hud = null;
    this.canvas = null;
    /** run sequencing in progress (game over / win / tutorial step change) – input blocked */
    this.busy = false;
    /** journey/daily run is 'over' and waits for boosters / revive / give up */
    this.stuck = false;
    /** finalizeRun() already ran for the current session */
    this.finalized = false;
    /** @type {Object|null} result of the last finalizeRun */
    this.summary = null;
    /** @type {Object|null} last PlaceResult (debug API) */
    this.lastResult = null;
    /** @type {null|'hammer'} */
    this.targetMode = null;
    /** active in-run seconds of the current run */
    this.playSec = 0;
    this._lastTick = 0;
    this._hintTimer = 0;
    this._pending = 0;
    this._leaving = false;
  }

  /**
   * Creates renderer, drag controller and HUD on the game screen. Resolves once the canvas font
   * is ready (max 1.5 s, see Renderer.ready).
   */
  async init() {
    const app = this.app;
    const screen = app.router.el('game');
    this.canvas = screen.querySelector('canvas');
    this.hud = new Hud(screen.querySelector('.hud'), app);
    this.renderer = new Renderer(this.canvas, { theme: getTheme(app.themeId), t });
    if (Platform.info && Platform.info.insets) this.renderer.setInsets(Platform.info.insets);
    this.drag = new DragController(this.canvas, this.renderer, {
      canInteract: () => this.canInteract(),
      getPiece: (i) => {
        const p = this.session && this.session.tray[i];
        return p ? { shape: getShape(p.shapeId), color: p.color } : null;
      },
      canPlace: (i, r, c) => !!this.session && this.session.canPlace(i, r, c),
      preview: (i, r, c) => this.session.preview(i, r, c),
      hint: () => (this.session ? this.session.tutorialHint() : null),
      onPickup: () => this.onPickup(),
      onDrop: (i, r, c) => this.drop(i, r, c),
      onCancel: (i, why) => this.onCancel(why),
      onTapCell: (r, c) => this.onTapCell(r, c),
    });
    await this.renderer.ready;
  }

  // -------------------------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------------------------

  /** canInteract = !busy && status==='playing' && !modalOpen && !paused (§4.15). */
  canInteract() {
    const app = this.app;
    return !this.busy && !!this.session && this.session.status === 'playing' && !this.targetMode
      && !app.modals.isOpen && !app.appPaused && app.router.current === 'game';
  }

  /** @returns {GameSession|null} the unfinished, saved run (Continue on home), if any */
  savedRun() {
    const s = this.session;
    return s && !this.finalized && s.mode !== 'tutorial' && this.app.save.run ? s : null;
  }

  /**
   * UI animations / sequencing still running (debug idle()). `busy` with a modal open (the run
   * waits for the player's choice) or after the run was finalized is a stable state.
   * @returns {boolean}
   */
  get settling() {
    return this._pending > 0 || (this.busy && !this.finalized && !this.app.modals.isOpen);
  }

  // -------------------------------------------------------------------------------------------
  // Starting / restoring runs
  // -------------------------------------------------------------------------------------------

  /** First launch: the interactive tutorial on the game screen. */
  startTutorial() {
    this.useSession(GameSession.create({ mode: 'tutorial' }));
    if (this.app.router.current !== 'game') this.app.router.go('game');
    this.scheduleHint(700);
  }

  /**
   * Starts a new run (an unfinished current run is abandoned first).
   * @param {'classic'|'journey'|'daily'} mode
   * @param {{ level?: Object }} [opts] LevelDef for journey/daily
   * @returns {GameSession}
   */
  startRun(mode, { level = null } = {}) {
    this.abandonRun();
    const app = this.app;
    const s = GameSession.create({
      mode, level, bestScore: app.progression.bestScore, gamesPlayed: app.save.stats.gamesPlayed,
    });
    this.useSession(s);
    if (app.router.current !== 'game') app.router.go('game');
    return s;
  }

  /** Continue the saved run (home "Continue"). */
  continueRun() {
    if (!this.savedRun()) return false;
    this.app.router.go('game');
    return true;
  }

  /**
   * Boot: restores save.run. Incompatible data is dropped; a run that already ended ('over' while
   * the revive was offered, or 'won' before the result) is finalized silently.
   * @returns {GameSession|null} the restored, still playable run
   */
  restoreSavedRun() {
    const save = this.app.save;
    const run = save.run;
    if (!run) return null;
    let s;
    try {
      if (run.v !== SESSION_VERSION) throw new Error(`run version ${run.v}`);
      s = GameSession.fromJSON(run.session);
      if (s.mode === 'tutorial') throw new Error('tutorial runs are not resumable');
    } catch (e) {
      console.warn('[game] dropping incompatible saved run:', e && e.message);
      save.run = null;
      flushSave(save);
      return null;
    }
    this.useSession(s, { playSec: Number(run.playSec) || 0, refill: false });
    if (s.status !== 'playing') {
      this.finalizeRun(s.status === 'won' ? 'won' : 'over');
      return null;
    }
    return s;
  }

  /**
   * Makes `s` the current session (renderer, HUD, counters).
   * @param {GameSession} s
   * @param {{ playSec?: number, refill?: boolean }} [opts]
   */
  useSession(s, { playSec = 0, refill = true } = {}) {
    this.cancelHint();
    if (this.drag) this.drag.cancel();
    this._exitTarget(false);
    this.session = s;
    this.finalized = false;
    this.summary = null;
    this.busy = false;
    this.stuck = false;
    this.lastResult = null;
    this.playSec = playSec;
    this._lastTick = 0;
    this.renderer.setSession(s);
    if (refill) this.track(this.renderer.animateTrayRefill());
    this.hud.build(s);
    this.updateGemTarget();
  }

  /**
   * Ends the current run without a result screen (New game / Restart / switching modes).
   * classic → recorded with coins & best; journey/daily → failed, no level reward.
   * @returns {Object|null} summary (null if nothing was recorded)
   */
  abandonRun() {
    const s = this.session;
    if (!s || s.mode === 'tutorial' || this.finalized) return null;
    if (s.piecesPlaced === 0) {
      // never placed a piece: nothing to record (no game counted, no coins)
      this.finalized = true;
      if (this.app.save.run) {
        this.app.save.run = null;
        requestSave(this.app.save);
      }
      return null;
    }
    const summary = this.finalizeRun('abandoned');
    if (summary && summary.coinsEarned > 0) {
      this.app.toast(t('toast.coins', { n: summary.coinsEarned }), { icon: 'coin', tone: 'good' });
      this.app.refreshCoins();
    }
    return summary;
  }

  /**
   * finalizeRun(reason) – exactly once per run, in the same tick that clears save.run (§4.15).
   * Order: recordGame → trackEvent(game_end) → completeLevel/completeChallenge (+ events) →
   * adPolicy.onRunFinished → flushSave.
   * @param {'won'|'over'|'abandoned'} reason
   * @returns {Object|null} summary for the result screens
   */
  finalizeRun(reason) {
    const s = this.session;
    const app = this.app;
    if (!s || s.mode === 'tutorial' || this.finalized) return null;
    this.finalized = true;
    this.stuck = false;
    this.stopPlayClock();
    const P = app.progression;
    const save = app.save;
    const playSec = Math.round(this.playSec);
    const before = { best: P.bestScore, coins: P.coins, xp: save.xp, level: P.levelInfo() };
    save.run = null;
    const rec = P.recordGame({
      mode: s.mode, score: s.score, lines: s.linesCleared, maxCombo: s.maxCombo,
      pieces: s.piecesPlaced, allClears: s.allClears, playSec,
    });
    const missions = P.trackEvent({ type: 'game_end', mode: s.mode, score: s.score, pieces: s.piecesPlaced });
    const xpResults = [rec.xp];
    let stars = 0;
    let levelCoins = 0;
    let firstTime = false;
    let streak = 0;
    if (reason === 'won' && s.level) {
      stars = s.stars();
      if (s.mode === 'journey') {
        const r = P.completeLevel(s.level.number, stars);
        levelCoins = r.coins;
        firstTime = r.firstTime;
        xpResults.push(r.xp);
        missions.push(...P.trackEvent({ type: 'level_complete', stars }));
      } else if (s.mode === 'daily') {
        const r = P.completeChallenge(s.level.id, stars);
        levelCoins = r.coins;
        firstTime = r.firstTime;
        streak = r.streak;
        xpResults.push(r.xp);
        missions.push(...P.trackEvent({ type: 'daily_complete' }));
      }
    }
    app.adPolicy.onRunFinished({ playSec, pieces: s.piecesPlaced });
    flushSave(save);
    const levels = [];
    const unlockedThemes = [];
    let levelUpCoins = 0;
    for (const x of xpResults) {
      levels.push(...x.levels);
      unlockedThemes.push(...x.unlockedThemes);
      levelUpCoins += x.coins;
    }
    this.summary = {
      reason,
      mode: s.mode,
      level: s.level,
      score: s.score,
      bestBefore: before.best,
      best: P.bestScore,
      newBest: rec.newBest,
      firstRecord: rec.firstRecord,
      runCoins: rec.coinsEarned,
      levelCoins,
      coinsEarned: rec.coinsEarned + levelCoins,
      coinsBefore: before.coins,
      coinsAfter: P.coins,
      levelUpCoins,
      levelUps: levels,
      unlockedThemes,
      firstTime,
      streak,
      stars,
      pieces: s.piecesPlaced,
      goals: JSON.parse(JSON.stringify(s.goals)),
      counted: rec.counted,
      xpGained: save.xp - before.xp,
      levelBefore: before.level,
      levelAfter: P.levelInfo(),
      missionsDone: missions,
      doubled: false,
    };
    if (missions.length) app.announceMissions(missions);
    // level-up celebration on the next arrival at home (the result screen shows a level-up line)
    if (levels.length && app.retention) app.retention.queueLevelUp({ levels, coins: levelUpCoins, themes: unlockedThemes });
    return this.summary;
  }

  /** Debug: drops the current run without recording anything. */
  discardRun() {
    this.finalized = true;
    this.app.save.run = null;
    requestSave(this.app.save);
  }

  // -------------------------------------------------------------------------------------------
  // Input → placement
  // -------------------------------------------------------------------------------------------

  onPickup() {
    this.cancelHint();
    this.renderer.hideHint();
    this.tickPlay();
    Sfx.play('pickup');
    this.app.haptic('light');
  }

  onCancel(why) {
    if (why === 'invalid') {
      Sfx.play('invalid');
      this.app.haptic('error');
    } else if (why === 'return') {
      Sfx.play('return');
    }
    this.scheduleHint();
  }

  /**
   * The drop path (DragController.onDrop and debug place()). Synchronous.
   * @returns {boolean} placed
   */
  drop(i, r, c) {
    const s = this.session;
    if (!this.canInteract()) return false;
    const res = s.placePiece(i, r, c);
    if (!res) return false;
    this.lastResult = res;
    this.tickPlay();
    const tutorial = s.mode === 'tutorial';
    // 1) commit
    if (!tutorial) this.persist();
    // 2) meta events (the controller is their only sender)
    if (!tutorial) {
      const P = this.app.progression;
      const done = P.trackEvent({ type: 'place', cells: res.placedCells.length });
      if (res.linesCount > 0) done.push(...P.trackEvent({ type: 'clear', lines: res.linesCount, combo: res.combo }));
      if (res.allClear) done.push(...P.trackEvent({ type: 'all_clear' }));
      if (done.length) this.app.announceMissions(done);
    }
    // 3) sound + haptics
    this.feedback(res);
    // 4) animations (input stays enabled)
    const anim = this.track(this.renderer.animatePlace(res));
    if (res.trayRefilled) this.track(this.renderer.animateTrayRefill());
    this.hud.onPlace(res);
    if (res.newBest) {
      this.renderer.celebrate('newBest');
      Sfx.play('newbest');
    }
    // 5) end of run / tutorial flow
    if (tutorial) this.afterTutorialPlace(res, anim);
    else if (res.status === 'won') this.onWon(anim);
    else if (res.status === 'over') this.onOver(anim);
    return true;
  }

  /** Sound and haptic feedback of a placement. */
  feedback(res) {
    Sfx.play('place', { cells: res.placedCells.length });
    if (res.linesCount > 0) {
      Sfx.play('clear', { lines: res.linesCount, combo: res.combo });
      if (res.combo >= 2) Sfx.play('combo', { combo: res.combo });
      if (res.praise) Sfx.play('praise', { level: PRAISE_LEVELS.indexOf(res.praise) + 1 });
      if (res.allClear) Sfx.play('allclear');
    }
    this.app.haptic(res.linesCount >= 2 ? 'heavy' : 'medium');
  }

  /** Writes the run to save.run (requestSave). */
  persist() {
    const s = this.session;
    if (!s || s.mode === 'tutorial' || this.finalized) return;
    this.app.save.run = {
      v: SESSION_VERSION,
      mode: s.mode,
      level: s.level,
      session: s.toJSON(),
      playSec: Math.round(this.playSec * 10) / 10,
    };
    requestSave(this.app.save);
  }

  // -------------------------------------------------------------------------------------------
  // Won / over
  // -------------------------------------------------------------------------------------------

  async onWon(anim) {
    const s = this.session;
    this.busy = true;
    await this.track(anim);
    if (this.session !== s || this.finalized) return;
    const summary = this.finalizeRun('won');
    this.renderer.celebrate('win');
    Sfx.play('levelwin');
    this.app.haptic('success');
    await this.track(wait(WIN_RESULT_DELAY_MS));
    if (this.session !== s) return;
    this.app.modals.open('levelResult', { summary });
  }

  async onOver(anim) {
    const s = this.session;
    this.busy = true;
    await this.track(anim);
    if (this.session !== s || this.finalized) return;
    Sfx.play('gameover');
    this.app.haptic('heavy');
    await this.track(this.renderer.animateGameOver());
    if (this.session !== s || this.finalized) return;
    this.offerSecondChance();
  }

  /** Classic → revive offer; journey/daily → stuck panel. */
  offerSecondChance() {
    const s = this.session;
    if (s.mode === 'classic') {
      const o = this.reviveOptions();
      if (!o.canRevive || !(o.free || o.ad || o.coins)) {
        this.declineRevive();
        return;
      }
      this.app.modals.open('revive', { variant: 'classic' });
      return;
    }
    this.stuck = true;
    this.showStuck();
  }

  /** (Re)opens the journey/daily stuck panel. */
  showStuck() {
    if (!this.stuck || this.app.modals.find('revive')) return;
    this.app.modals.open('revive', { variant: 'level' });
  }

  /** @returns {{ canRevive: boolean, free: boolean, ad: boolean, coins: boolean, price: number }} */
  reviveOptions() {
    const s = this.session;
    const price = CONFIG.ECONOMY.REVIVE_COINS;
    return {
      canRevive: !!s && s.canRevive(),
      free: this.app.save.stats.gamesPlayed < 2,
      ad: this.app.isRewardedAvailable(),
      coins: this.app.progression.coins >= price,
      price,
    };
  }

  /**
   * Second chance. On success the revive modal is closed before the revive animation starts.
   * @param {'free'|'ad'|'coins'} source
   * @returns {Promise<boolean>}
   */
  async revive(source) {
    const s = this.session;
    const app = this.app;
    if (!s || !s.canRevive() || this.finalized) return false;
    if (source === 'free' && !this.reviveOptions().free) return false;
    if (source === 'ad') {
      const ok = await app.showRewarded('revive');
      if (!ok || this.session !== s || !s.canRevive()) return false;
    } else if (source === 'coins') {
      if (!app.progression.spendCoins(CONFIG.ECONOMY.REVIVE_COINS)) return false;
      app.refreshCoins();
    }
    const rr = s.revive();
    if (!rr) return false;
    const modal = app.modals.find('revive');
    if (modal) app.modals.close(modal);
    this.stuck = false;
    this.persist();
    const anim = this.track(this.renderer.animateRevive(rr));
    Sfx.play('revive');
    app.haptic('success');
    this.hud.sync();
    this.hud.onGems(rr.gemsCollected);
    this._lastTick = 0;
    this.afterRescue(rr.status, anim);
    return true;
  }

  /** "No thanks" / countdown expiry / give up → result screen. */
  declineRevive() {
    const s = this.session;
    if (!s || this.finalized) return;
    this._exitTarget(false);
    const summary = this.finalizeRun('over');
    if (!summary) return;
    if (s.mode === 'classic') {
      this.app.modals.open('gameover', { summary });
    } else {
      Sfx.play('levelfail');
      this.app.modals.open('levelResult', { summary });
    }
  }

  /** After a revive / booster: continue, win or fall back into the over flow. */
  afterRescue(status, anim) {
    this.stuck = false;
    if (status === 'won') this.onWon(anim);
    else if (status === 'over') this.onOver(anim);
    else this.busy = false;
  }

  // -------------------------------------------------------------------------------------------
  // Boosters (journey / daily)
  // -------------------------------------------------------------------------------------------

  /** HUD / stuck-panel booster button. */
  boosterTap(type) {
    const s = this.session;
    if (!s || !s.canUseBooster(type) || this.finalized) return;
    if (this.busy && !this.stuck) return;
    if (this.targetMode) {
      const same = this.targetMode === type;
      this._exitTarget(!same);
      if (same) {
        if (this.stuck) this._regreyAndShowStuck();
        return;
      }
    }
    if (this.app.progression.boosterCount(type) < 1) {
      this.drag.cancel();
      const m = this.app.modals.open('booster', { type });
      m.closed.then((got) => {
        if (got && this.session === s) this.applyBooster(type);
        else if (this.stuck) this._regreyAndShowStuck();
      });
      return;
    }
    this.applyBooster(type);
  }

  /** Uses one owned booster: hammer → target mode, shuffle → immediately. */
  applyBooster(type) {
    if (type === 'hammer') this._enterTarget();
    else this.shuffle();
  }

  shuffle() {
    const s = this.session;
    const res = s.useShuffle();
    if (!res) return;
    const anim = this.track(this.renderer.animateShuffle());
    if (s.status !== 'over') this.renderer.clearGameOver();
    this.consumeBooster('shuffle');
    Sfx.play('shuffle');
    this.app.haptic('medium');
    this.afterRescue(res.status, anim);
  }

  /** Booster target mode: tap on the board. */
  onTapCell(r, c) {
    if (this.targetMode !== 'hammer') return;
    const s = this.session;
    const br = s.useHammer(r, c);
    if (!br) {
      Sfx.play('invalid');
      this.app.haptic('error');
      return;
    }
    this._exitTarget(false);
    const anim = this.track(this.renderer.animateBlast(br));
    this.consumeBooster('hammer');
    Sfx.play('hammer');
    this.app.haptic('heavy');
    this.hud.onGems(br.gemsCollected);
    this.afterRescue(br.status, anim);
  }

  /** Consumes a booster after the session applied it (§4.15 meta event order). */
  consumeBooster(type) {
    const P = this.app.progression;
    P.useBooster(type);
    const done = P.trackEvent({ type: 'booster_used' });
    if (done.length) this.app.announceMissions(done);
    this.persist();
    this.tickPlay();
    this.hud.sync();
    this.hud.syncBoosters();
  }

  _enterTarget() {
    this.targetMode = 'hammer';
    this.drag.cancel();
    if (this.session.status === 'over') this.renderer.clearGameOver();
    this.renderer.setTargetMode('hammer');
    this.hud.setTarget('hammer');
    this.app.toast(t('booster.tapCell'), { icon: 'hammer' });
  }

  _exitTarget(reshowStuck) {
    if (!this.targetMode) return;
    this.targetMode = null;
    this.renderer.setTargetMode(null);
    this.hud.setTarget(null);
    if (reshowStuck && this.stuck) this._regreyAndShowStuck();
  }

  _regreyAndShowStuck() {
    const s = this.session;
    this.track(this.renderer.animateGameOver()).then(() => {
      if (this.session === s && this.stuck && !this.targetMode) this.showStuck();
    });
  }

  // -------------------------------------------------------------------------------------------
  // Tutorial
  // -------------------------------------------------------------------------------------------

  afterTutorialPlace(res, anim) {
    const s = this.session;
    this.renderer.hideHint();
    if (res.status === 'won') {
      this.busy = true;
      this.track(anim.then(async () => {
        if (this.session !== s) return;
        this.renderer.celebrate('win');
        Sfx.play('levelwin');
        await wait(TUTORIAL_CELEBRATION_MS);
        if (this.session === s) this.finishTutorial();
      }));
    } else if (res.tutorialStep && res.tutorialStep.done && res.tutorialStep.hasNext) {
      this.busy = true;
      this.track(anim.then(() => {
        if (this.session !== s) return;
        s.nextTutorialStep();
        this.renderer.sync();
        this.busy = false;
        this.hud.setTutorialStep(s.tutorialStep);
        this.scheduleHint();
      }));
    }
  }

  /** Tutorial done (or skipped): flag, flush, first classic run on the same screen. */
  finishTutorial() {
    const save = this.app.save;
    this.cancelHint();
    save.flags.tutorialDone = true;
    flushSave(save);
    this.startRun('classic');
    this.app.toast(t('tutorial.done'), { icon: 'play', tone: 'good' });
  }

  skipTutorial() {
    if (!this.session || this.session.mode !== 'tutorial' || this.busy) return;
    this.finishTutorial();
  }

  scheduleHint(ms = HINT_IDLE_MS) {
    clearTimeout(this._hintTimer);
    const s = this.session;
    if (!s || s.mode !== 'tutorial') return;
    this._hintTimer = setTimeout(() => {
      if (this.session !== s || this.busy || this.drag.active) return;
      const h = s.tutorialHint();
      if (h) this.renderer.showHint(h);
    }, dur(ms));
  }

  cancelHint() {
    clearTimeout(this._hintTimer);
    this._hintTimer = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Pause, navigation, result screens
  // -------------------------------------------------------------------------------------------

  /** Pause button / Back while playing. */
  openPause() {
    const s = this.session;
    if (!s || s.mode === 'tutorial' || s.status !== 'playing' || this.busy || this.app.modals.isOpen) return;
    this._exitTarget(false);
    this.drag.cancel();
    this.app.modals.open('pause');
  }

  /** Back on the game screen (no modal open). */
  back() {
    const s = this.session;
    if (!s || s.mode === 'tutorial') return;
    if (this.targetMode) {
      this._exitTarget(true);
      return;
    }
    if (!this.busy && s.status === 'playing') this.openPause();
  }

  /** Pause modal → Restart (after confirm). */
  restart() {
    const s = this.session;
    if (!s) return;
    this.app.modals.closeAll();
    this.startRun(s.mode, { level: s.level });
  }

  /** Pause modal → Home: the run stays saved (Continue). */
  goHome() {
    this.app.router.go('home');
  }

  /**
   * Result-screen buttons (gameover.again|home, levelResult.next|retry|map|home). The interstitial
   * is attempted only here, after the screen was visible ≥ RESULT_SCREEN_MIN_MS (App.maybeInterstitial).
   * @param {'again'|'home'|'next'|'retry'|'map'} action
   * @param {Object} m result modal handle
   */
  async leaveResult(action, m) {
    if (this._leaving) return;
    this._leaving = true;
    try {
      await this.app.maybeInterstitial(m.shownAt);
      // FTUE: ads (consent, banner) start only once the first result screen is left
      this.app.startAds();
      const sum = m.props.summary || {};
      this.app.modals.close(m);
      if (action === 'again') this.startRun('classic');
      else if (action === 'retry') this.startRun(sum.mode, { level: sum.level });
      else if (action === 'next') this.startRun('journey', { level: generateLevel((sum.level ? sum.level.number : 0) + 1) });
      else if (action === 'map') this.app.router.go('journey');
      else this.app.router.go('home');
    } finally {
      this._leaving = false;
    }
  }

  /**
   * "Watch ad: ×2" on a result screen (once per run).
   * @returns {Promise<number>} coins added (0 = not rewarded)
   */
  async doubleReward(m) {
    const sum = m.props.summary;
    if (!sum || sum.doubled || !(sum.coinsEarned > 0)) return 0;
    const ok = await this.app.showRewarded('double');
    if (!ok || sum.doubled) return 0;
    sum.doubled = true;
    return this.app.progression.doubleRunCoins(sum.coinsEarned);
  }

  /** Debug: ends the current run as if no piece fitted. */
  forceGameOver() {
    const s = this.session;
    if (!s || s.mode === 'tutorial' || s.status !== 'playing' || this.busy) return false;
    this.drag.cancel();
    s.status = 'over';
    this.persist();
    this.onOver(Promise.resolve());
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle hooks (called by the App)
  // -------------------------------------------------------------------------------------------

  /** The game screen became active / inactive. */
  onScreen(active) {
    if (active) {
      this.renderer.start();
      requestAnimationFrame(() => this.updateGemTarget());
      return;
    }
    this.drag.cancel();
    this._exitTarget(false);
    this.stopPlayClock();
    this.cancelHint();
    this.renderer.stop();
  }

  /** A modal opened or closed. */
  onModal(type) {
    if (type === 'open') {
      this.drag.cancel();
      this.stopPlayClock();
    }
  }

  /** App went to the background. */
  onAppPause() {
    this.drag.cancel();
    this.stopPlayClock();
  }

  /** Viewport changed. */
  onResize() {
    this.drag.cancel();
    requestAnimationFrame(() => this.updateGemTarget());
  }

  /** Points the renderer's gem flights at the HUD goal counters (canvas coordinates). */
  updateGemTarget() {
    const target = this.hud.gemTargetEl();
    if (!target) {
      this.renderer.gemTarget = null;
      return;
    }
    const a = target.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    if (!c.width || !a.width) return;
    this.renderer.gemTarget = { x: a.left + a.width / 2 - c.left, y: a.top + a.height / 2 - c.top };
  }

  // -------------------------------------------------------------------------------------------

  /** Accumulates active play time (capped per gap, never across pauses/modals). */
  tickPlay() {
    const now = performance.now();
    if (this._lastTick && this.session && this.session.mode !== 'tutorial') {
      this.playSec += Math.min(now - this._lastTick, IDLE_CAP_MS) / 1000;
    }
    this._lastTick = now;
  }

  stopPlayClock() {
    if (this._lastTick) this.tickPlay();
    this._lastTick = 0;
  }

  /** Counts a UI-relevant promise as pending until it settles (debug idle()). */
  track(promise) {
    this._pending++;
    const done = () => { this._pending--; };
    Promise.resolve(promise).then(done, done);
    return promise;
  }
}
