// Game-screen HUD (DOM above the canvas in portrait, left column in landscape).
//
// Variants: classic (pause · best · combo / big score / "only n to beat your best" nudge),
// level (journey/daily: pause · title · boosters / goals / pieces + par meter) and tutorial
// (coach text + step dots + skip). The HUD is a view: it reads the GameSession and never mutates
// it. Updates write textContent/transform/classes only (no layout reads during play); numbers
// count up; collected gems pop into their counters when the flying gem arrives.

import { CONFIG } from '../config.js';
import { TUTORIAL_STEP_COUNT } from '../core/game.js';
import { icon } from './icons.js';
import { esc, setText, toggleClass, fitText } from './dom.js';
import { t, formatNumber, translateDom } from './i18n.js';
import { iconBtn, bar, setBar, starsRow } from './components.js';
import { countUp, pop, dur, animate } from './anim.js';

/** Classic: the nudge appears from this share of the best score on. */
const NUDGE_FROM = 0.85;
/** Gem counters update when the flying gem reaches the HUD (renderer gem flight ≈ 700 ms). */
const GEM_ARRIVAL_MS = 620;
/** Par meter scale: the track spans 0 … par2 × this. */
const PAR_SCALE = 1.25;

export class Hud {
  /**
   * @param {HTMLElement} root the `.hud` header of the game screen
   * @param {Object} app
   */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    /** @type {'classic'|'level'|'tutorial'|null} */
    this.kind = null;
    /** @type {Record<string, HTMLElement>} */
    this.e = {};
    /** @type {Record<string, {el: HTMLElement, num: HTMLElement, need: number, shown: number}>} */
    this.goals = {};
    this.session = null;
    this._gemTimers = [];
  }

  /** Rebuilds the HUD for a session (new run, tutorial, restored run). */
  build(session) {
    this._clearTimers();
    this.session = session;
    const mode = session.mode;
    this.kind = mode === 'tutorial' ? 'tutorial' : mode === 'classic' ? 'classic' : 'level';
    this.root.className = `hud hud--${this.kind}${mode === 'daily' ? ' hud--daily' : ''}`;
    this.root.innerHTML = this.kind === 'classic' ? classicHtml() : this.kind === 'tutorial' ? tutorialHtml() : levelHtml(session);
    this.e = {};
    for (const el of this.root.querySelectorAll('[data-h]')) this.e[el.getAttribute('data-h')] = el;
    this.goals = {};
    for (const el of this.root.querySelectorAll('[data-goal]')) {
      const type = el.getAttribute('data-goal');
      if (type === 'score') continue;
      const g = session.goals.gems[type];
      this.goals[type] = { el, num: el.querySelector('.goal__n'), need: g.need, shown: g.have };
    }
    if (this.kind === 'tutorial') this.setTutorialStep(session.tutorialStep || 0, { instant: true });
    this.sync({ instant: true });
    this.syncBoosters();
  }

  /**
   * Adopts the session state.
   * @param {{ instant?: boolean }} [opts] instant: no count-ups and gem counters jump too
   */
  sync({ instant = false } = {}) {
    const s = this.session;
    if (!s) return;
    const e = this.e;
    const ms = instant ? 0 : 380;
    if (this.kind === 'classic') {
      fitText(e.score, formatNumber(s.score)); // a 6-7 digit score shrinks to its column instead of being clipped
      countUp(e.score, s.score, { ms, format: formatNumber });
      const best = Math.max(s.bestScore, s.score);
      const record = s.bestScore > 0 && s.score > s.bestScore;
      if (Number(e.best.dataset.value) !== best) countUp(e.best, best, { ms, format: formatNumber });
      toggleClass(e.bestBox, 'is-record', record);
      // a new player has no best yet: no crown with a 0 (the space stays, nothing shifts)
      toggleClass(e.bestBox, 'is-empty', !(s.bestScore > 0));
      // no "only n to beat your best" behind the revive offer / result (they carry their own numbers)
      const near = s.status === 'playing' && s.bestScore > 0 && s.score >= s.bestScore * NUDGE_FROM && s.score <= s.bestScore;
      if (near) setText(e.nudge, t('hud.nudge', { n: s.bestScore - s.score + 1 }));
      toggleClass(e.nudge, 'is-on', near);
      this._syncCombo(s);
    } else if (this.kind === 'level') {
      if (e.score) {
        const g = s.goals.score;
        countUp(e.score, s.score, { ms, format: formatNumber });
        setBar(e.scoreBar, g ? Math.min(1, s.score / g.need) : 0);
        toggleClass(e.scoreGoal, 'is-done', !!g && s.score >= g.need);
      }
      if (instant) {
        for (const type of Object.keys(this.goals)) this._showGoal(type, s.goals.gems[type].have, false);
      }
      this._syncPar(s);
    }
  }

  /** Placement feedback (after the session changed). */
  onPlace(res) {
    this.sync();
    if (res) this.onGems(res.gemsCollected);
  }

  /** Collected gems pop into their counters when the flying gem arrives. */
  onGems(gems) {
    if (!gems || this.kind !== 'level') return;
    const s = this.session;
    for (const type of Object.keys(this.goals)) {
      if (!(gems[type] > 0)) continue;
      const timer = setTimeout(() => {
        if (this.session !== s) return;
        this._showGoal(type, s.goals.gems[type].have, true);
      }, dur(GEM_ARRIVAL_MS));
      this._gemTimers.push(timer);
    }
  }

  /** Booster counts / buy badges. */
  syncBoosters() {
    if (this.kind !== 'level') return;
    const P = this.app.progression;
    for (const btnEl of this.root.querySelectorAll('[data-booster]')) {
      const type = btnEl.getAttribute('data-booster');
      const n = P.boosterCount(type);
      const badge = btnEl.querySelector('.booster__count');
      setText(badge, n > 0 ? String(n) : '+');
      toggleClass(badge, 'is-add', n === 0);
    }
  }

  /** Highlights the booster whose target mode is active (null = none). */
  setTarget(type) {
    for (const btnEl of this.root.querySelectorAll('[data-booster]')) {
      toggleClass(btnEl, 'is-active', btnEl.getAttribute('data-booster') === type);
    }
  }

  /** Tutorial coach: step text, dots, skip from step 2. */
  setTutorialStep(step, { instant = false } = {}) {
    const e = this.e;
    if (this.kind !== 'tutorial') return;
    e.coachText.setAttribute('data-i18n', `tutorial.step${step + 1}`);
    setText(e.coachText, t(`tutorial.step${step + 1}`));
    e.dots.querySelectorAll('i').forEach((d, i) => toggleClass(d, 'is-on', i <= step));
    toggleClass(e.skip, 'is-on', step >= 1);
    e.skip.toggleAttribute('disabled', step < 1);
    if (!instant) animate(e.coachText, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260 });
  }

  /** Language changed. */
  refresh() {
    translateDom(this.root);
    for (const el of this.root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    if (this.session) {
      if (this.kind === 'tutorial') this.setTutorialStep(this.session.tutorialStep || 0, { instant: true });
      this.sync({ instant: true });
    }
  }

  /** @returns {HTMLElement|null} where collected gems fly to */
  gemTargetEl() {
    return this.kind === 'level' && Object.keys(this.goals).length ? this.root.querySelector('.hud__goals') : null;
  }

  // -------------------------------------------------------------------------------------------

  _syncCombo(s) {
    const e = this.e;
    const on = s.combo >= 2;
    toggleClass(e.combo, 'is-on', on);
    if (!on) return;
    setText(e.comboLabel, t('combo', { n: s.combo }));
    const left = s.combo > 0 ? CONFIG.SCORING.COMBO_KEEP_MOVES - s.movesSinceClear : 0;
    e.pips.querySelectorAll('i').forEach((pip, i) => toggleClass(pip, 'is-on', i < left));
  }

  _syncPar(s) {
    const e = this.e;
    if (!e.pieces || !s.level) return;
    const [par3, par2] = s.level.par;
    const n = s.piecesPlaced;
    setText(e.pieces, t('hud.pieces', { n }));
    const max = par2 * PAR_SCALE;
    setBar(e.parBar, n / max);
    const stars = n <= par3 ? 3 : n <= par2 ? 2 : 1;
    e.parStars.querySelectorAll('.star').forEach((st, i) => toggleClass(st, 'is-on', i < stars));
  }

  _showGoal(type, have, animated) {
    const g = this.goals[type];
    if (!g || g.shown === have && animated) return;
    g.shown = have;
    const left = Math.max(0, g.need - have);
    setText(g.num, String(left));
    toggleClass(g.el, 'is-done', left === 0);
    if (animated) pop(g.el, 1.3);
  }

  _clearTimers() {
    for (const id of this._gemTimers) clearTimeout(id);
    this._gemTimers.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------

function classicHtml() {
  return `<div class="hud__bar">
      ${iconBtn({ action: 'game.pause', icon: 'pause', aria: 'hud.pause', cls: 'hud__pause' })}
      <div class="hud__best" data-h="bestBox">${icon('crown', 'hud__crown')}<span class="hud__best-value" data-h="best" data-value="0">0</span></div>
      <div class="hud__combo" data-h="combo"><span class="hud__combo-label" data-h="comboLabel"></span><span class="pips" data-h="pips"><i></i><i></i><i></i></span></div>
    </div>
    <div class="hud__score" data-h="score" data-value="0">0</div>
    <div class="hud__nudge" data-h="nudge"></div>`;
}

function tutorialHtml() {
  let dots = '';
  for (let i = 0; i < TUTORIAL_STEP_COUNT; i++) dots += '<i></i>';
  return `<div class="coach">
      <div class="coach__head">
        <span class="coach__title" data-i18n="tutorial.title">${esc(t('tutorial.title'))}</span>
        <span class="coach__dots" data-h="dots">${dots}</span>
      </div>
      <p class="coach__text" data-h="coachText"></p>
      <button type="button" class="btn btn--ghost btn--sm coach__skip" data-action="tutorial.skip" data-h="skip" disabled>
        <span class="btn__label" data-i18n="tutorial.skip">${esc(t('tutorial.skip'))}</span></button>
    </div>`;
}

function levelHtml(s) {
  const L = s.level;
  const daily = s.mode === 'daily';
  const titleKey = daily ? 'hud.daily' : 'hud.level';
  const params = daily ? null : { n: L.number };
  const title = `<span class="hud__title-text" data-i18n="${titleKey}"${params ? ` data-i18n-params='${esc(JSON.stringify(params))}'` : ''}>${esc(t(titleKey, params))}</span>`;
  const tag = L.tag && L.tag !== 'normal' ? `<span class="badge badge--${L.tag}" data-i18n="tag.${L.tag}">${esc(t(`tag.${L.tag}`))}</span>` : '';
  let goals = '';
  if (s.goals.score) {
    goals += `<div class="goal goal--score" data-goal="score" data-h="scoreGoal">
        <div class="goal__score"><span class="goal__value" data-h="score" data-value="0">0</span><span class="goal__need">/ ${esc(formatNumber(s.goals.score.need))}</span></div>
        ${bar('goal__bar', 'data-h="scoreBar"')}
      </div>`;
  }
  if (s.goals.gems) {
    for (const type of Object.keys(s.goals.gems)) {
      goals += `<div class="goal" data-goal="${type}" data-i18n-aria="gem.${type}" aria-label="${esc(t(`gem.${type}`))}">
          ${icon('gem', 'goal__icon', Number(type))}<span class="goal__n">${s.goals.gems[type].need}</span>${icon('check', 'goal__check')}</div>`;
    }
  }
  const [par3, par2] = L.par;
  const max = par2 * PAR_SCALE;
  const mark = (p) => `<i class="par__mark" style="left:${((p / max) * 100).toFixed(1)}%"></i>`;
  return `<div class="hud__bar">
      ${iconBtn({ action: 'game.pause', icon: 'pause', aria: 'hud.pause', cls: 'hud__pause' })}
      <div class="hud__title">${title}${tag}</div>
      <div class="hud__boosters">${boosterBtn('hammer')}${boosterBtn('shuffle')}</div>
    </div>
    <div class="hud__goals">${goals}</div>
    <div class="hud__par">
      <span class="hud__pieces" data-h="pieces"></span>
      <div class="par">${bar('par__track', 'data-h="parBar"')}${mark(par3)}${mark(par2)}</div>
      ${starsRow(3, 3, 'par__stars', 'data-h="parStars"')}
    </div>`;
}

function boosterBtn(type) {
  return `<button type="button" class="booster" data-booster="${type}" data-action="game.booster.${type}" data-i18n-aria="booster.${type}" aria-label="${esc(t(`booster.${type}`))}">
      ${icon(type, 'booster__icon')}<span class="booster__count">0</span></button>`;
}
