// Home screen: logo, best score, big Play / Continue, Journey + Daily cards, dock (shop,
// missions, settings), level chip and coin pill. Part B may enrich it (daily reward entry,
// mission badges …); the auto popups drain on every arrival (app.popups.drainOnHome()).

import { generateLevel, generateDailyLevel } from '../../core/levels.js';
import { CONFIG } from '../../config.js';
import { icon } from '../icons.js';
import { fromHtml, setText, toggleClass } from '../dom.js';
import { t, formatNumber, formatDay } from '../i18n.js';
import { coinPill, bar, setBar } from '../components.js';

const LETTER_COLORS = [0, 1, 2, 3, 4, 6];

/** @type {Record<string, HTMLElement>} */
let refs = {};

export const homeScreen = {
  id: 'home',

  build(app) {
    const letters = 'Blocko'.split('').map((ch, i) => `<span style="--c: var(--color-${LETTER_COLORS[i]})">${ch}</span>`).join('');
    const el = fromHtml(`<section class="screen--home">
      <div class="home__glow" aria-hidden="true"></div>
      <header class="topbar">
        <div class="level-chip" data-ref="levelChip">
          <span class="level-chip__badge" data-ref="level">1</span>
          <span class="level-chip__info"><span class="level-chip__label" data-ref="levelLabel"></span>${bar('level-chip__bar', 'data-ref="levelBar"')}</span>
        </div>
        <div class="topbar__spacer"></div>
        ${coinPill()}
      </header>
      <div class="home__hero">
        <div class="logo">${icon('logo', 'logo__mark')}<div class="logo__word" role="img" aria-label="Blocko">${letters}</div></div>
        <div class="home__best">${icon('crown', 'home__crown')}<span class="home__best-label" data-i18n="home.best"></span><span class="home__best-value" data-ref="best">0</span></div>
      </div>
      <div class="home__cta">
        <div class="breathe"><button type="button" class="btn btn--primary btn--xl btn--shine home__play" data-action="home.play" data-ref="play">
          ${icon('play', 'btn__icon')}<span class="btn__label" data-ref="playLabel"></span></button></div>
        <button type="button" class="link-btn" data-action="home.newGame" data-ref="newGame" data-i18n="home.newGame"></button>
      </div>
      <div class="home__modes">
        <div class="mode-card mode-card--journey" data-ref="journey">
          <button type="button" class="mode-card__main" data-action="home.journeyCard">
            <span class="mode-card__icon">${icon('map')}</span>
            <span class="mode-card__text"><span class="mode-card__title" data-i18n="mode.journey"></span><span class="mode-card__sub" data-ref="journeySub"></span></span>
          </button>
          <button type="button" class="mode-card__play" data-action="home.journeyPlay" data-ref="journeyPlay" data-i18n-aria="common.play">${icon('play', 'mode-card__go')}${icon('lock', 'mode-card__lock')}</button>
        </div>
        <div class="mode-card mode-card--daily" data-ref="daily">
          <button type="button" class="mode-card__main" data-action="home.daily">
            <span class="mode-card__icon cal"><span class="cal__month" data-ref="calMonth"></span><span class="cal__day" data-ref="calDay"></span></span>
            <span class="mode-card__text"><span class="mode-card__title" data-i18n="mode.daily"></span><span class="mode-card__sub" data-ref="dailySub"></span></span>
          </button>
          <button type="button" class="mode-card__play" data-action="home.daily" data-ref="dailyPlay" data-i18n-aria="common.play">${icon('play', 'mode-card__go')}${icon('check', 'mode-card__done')}${icon('lock', 'mode-card__lock')}</button>
        </div>
      </div>
      <nav class="dock">
        <button type="button" class="dock__btn" data-action="nav.shop">${icon('shop', 'dock__icon')}<span class="dock__label" data-i18n="nav.shop"></span></button>
        <button type="button" class="dock__btn" data-action="home.missions" data-ref="missions">${icon('missions', 'dock__icon')}<span class="dock__label" data-i18n="nav.missions"></span><span class="dock__badge" data-ref="missionsBadge"></span></button>
        <button type="button" class="dock__btn" data-action="nav.settings">${icon('settings', 'dock__icon')}<span class="dock__label" data-i18n="nav.settings"></span></button>
      </nav>
    </section>`);
    refs = {};
    for (const node of el.querySelectorAll('[data-ref]')) refs[node.getAttribute('data-ref')] = node;

    const game = app.game;
    const P = app.progression;
    app.action('home.play', () => withAbandonConfirm(app, () => game.startRun('classic')));
    app.action('home.continue', () => game.continueRun());
    app.action('home.newGame', () => withAbandonConfirm(app, () => game.startRun('classic')));
    app.action('home.journeyCard', () => {
      if (!P.isFeatureUnlocked('journey')) lockedToast(app, 'journey');
      else app.go('journey');
    });
    app.action('home.journeyPlay', () => startJourney(app, P.journeyUnlocked));
    app.action('home.daily', () => startDaily(app));
    app.action('home.missions', () => {
      if (!P.isFeatureUnlocked('missions')) lockedToast(app, 'missions');
      else app.go('missions');
    });
    return el;
  },

  enter(params, app) {
    render(app);
    app.refreshCoins({ instant: true });
    requestAnimationFrame(() => app.popups.drainOnHome());
  },

  refresh(reason, app) {
    render(app);
  },
};

/**
 * Starts journey level `n` (or continues the saved journey run).
 * Exported for the journey screen placeholder.
 */
export function startJourney(app, n) {
  const P = app.progression;
  if (!P.isFeatureUnlocked('journey')) {
    lockedToast(app, 'journey');
    return;
  }
  const saved = app.game.savedRun();
  if (saved && saved.mode === 'journey' && saved.level.number === n) {
    app.game.continueRun();
    return;
  }
  withAbandonConfirm(app, () => app.game.startRun('journey', { level: generateLevel(n) }));
}

/** Starts (or continues) today's daily challenge. */
export function startDaily(app) {
  if (!app.progression.isFeatureUnlocked('daily')) {
    lockedToast(app, 'daily');
    return;
  }
  const saved = app.game.savedRun();
  if (saved && saved.mode === 'daily') {
    app.game.continueRun();
    return;
  }
  withAbandonConfirm(app, () => app.game.startRun('daily', { level: generateDailyLevel(app.clock.today()) }));
}

/** Runs `start` – after a confirmation if a saved run (with placed pieces) would end. */
export function withAbandonConfirm(app, start) {
  const saved = app.game.savedRun();
  if (!saved || saved.piecesPlaced === 0) {
    start();
    return;
  }
  app.modals.open('confirm', {
    titleKey: 'confirm.abandon.title',
    bodyKey: `confirm.abandon.body.${saved.mode}`,
    okKey: 'confirm.abandon.ok',
    okIcon: 'play',
    onConfirm: start,
  });
}

function lockedToast(app, feature) {
  app.toast(lockText(app, feature), { icon: 'lock' });
}

/** Teaser text of a locked feature. */
function lockText(app, feature) {
  const req = CONFIG.UNLOCKS[feature];
  if (req.journeyLevel !== undefined) return t('home.locked.journeyLevel', { n: req.journeyLevel });
  const left = Math.max(1, req.games - app.save.stats.gamesPlayed);
  return t('home.locked.games', { n: left });
}

function render(app) {
  if (!refs.play) return;
  const P = app.progression;
  const save = app.save;
  const info = P.levelInfo();
  setText(refs.level, String(info.level));
  setText(refs.levelLabel, t('home.level', { n: info.level }));
  setBar(refs.levelBar, info.progress);
  setText(refs.best, formatNumber(P.bestScore));

  // Play / Continue
  const saved = app.game.savedRun();
  const classicSaved = saved && saved.mode === 'classic';
  refs.play.setAttribute('data-action', classicSaved ? 'home.continue' : 'home.play');
  setText(refs.playLabel, t(classicSaved ? 'home.continue' : 'home.play'));
  toggleClass(refs.newGame, 'is-on', !!classicSaved);
  refs.newGame.toggleAttribute('disabled', !classicSaved);

  // Journey card
  const journeyOpen = P.isFeatureUnlocked('journey');
  toggleClass(refs.journey, 'is-locked', !journeyOpen);
  const journeySaved = saved && saved.mode === 'journey';
  setText(refs.journeySub, !journeyOpen ? lockText(app, 'journey')
    : journeySaved ? t('home.continueLevel', { n: saved.level.number })
      : t('home.journeyLevel', { n: P.journeyUnlocked }));

  // Daily card
  const today = app.clock.today();
  setText(refs.calMonth, formatDay(today, { month: 'short' }).replace('.', '').toUpperCase());
  setText(refs.calDay, String(Number(today.slice(8))));
  const dailyOpen = P.isFeatureUnlocked('daily');
  const status = P.challengeStatus(today);
  const dailySaved = saved && saved.mode === 'daily';
  toggleClass(refs.daily, 'is-locked', !dailyOpen);
  toggleClass(refs.daily, 'is-done', dailyOpen && status.completed && !dailySaved);
  let sub;
  if (!dailyOpen) sub = lockText(app, 'daily');
  else if (dailySaved) sub = t('home.continue');
  else if (status.completed) sub = t('home.dailyDone');
  else sub = t('home.dailyGoal', { n: generateDailyLevel(today).goals.score });
  setText(refs.dailySub, sub);

  // Missions badge: completed but unclaimed missions
  const missionsOpen = P.isFeatureUnlocked('missions');
  const claimable = missionsOpen ? P.missions().filter((m) => !m.claimed && m.progress >= m.target).length : 0;
  setText(refs.missionsBadge, claimable ? String(claimable) : '');
  toggleClass(refs.missionsBadge, 'is-on', claimable > 0);
  toggleClass(refs.missions, 'is-locked', !missionsOpen);
}
