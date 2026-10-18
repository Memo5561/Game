// Home screen: player level badge + XP bar, daily-reward gift (once unlocked), coin pill (→ shop),
// logo with slowly floating blocks, best score, big Play / Continue, the Journey card (current
// level, hard / super-hard tag, stars collected, locked teaser) and the Daily Challenge card
// (date, goal or completed stars + streak flame, locked teaser), dock (shop, missions with a
// claimable badge, settings).
// Auto popups drain on every arrival (app.popups.drainOnHome()) and on a day rollover while the
// home screen is shown.

import { generateLevel, generateDailyLevel, levelKind } from '../../core/levels.js';
import { CONFIG } from '../../config.js';
import { icon } from '../icons.js';
import { fromHtml, setText, toggleClass, esc } from '../dom.js';
import { t, formatNumber, formatDay } from '../i18n.js';
import { coinPill, bar, setBar, starsRow } from '../components.js';

const LETTER_COLORS = [0, 1, 2, 3, 4, 6];
/** Decorative blocks drifting behind the logo: [x %, y %, size px, palette index, delay s, duration s, rotation deg]. */
const FLOATERS = [
  [9, 18, 26, 4, 0, 7.5, -14], [86, 12, 20, 0, 1.4, 8.5, 12], [16, 70, 18, 2, 2.6, 9, 20],
  [90, 62, 28, 6, 0.8, 7, -8], [74, 34, 14, 3, 3.2, 10, 30], [28, 40, 12, 7, 1.9, 8, -24],
];

/** @type {Record<string, HTMLElement>} */
let refs = {};
let dailyCache = { day: '', level: null };

export const homeScreen = {
  id: 'home',

  build(app) {
    const letters = 'Blocko'.split('').map((ch, i) => `<span style="--c: var(--color-${LETTER_COLORS[i]})">${ch}</span>`).join('');
    const floaters = FLOATERS.map(([x, y, s, c, d, dur, r]) => `<i style="--x:${x}%;--y:${y}%;--s:${s}px;--c:var(--color-${c});--d:-${d}s;--t:${dur}s;--r:${r}deg"></i>`).join('');
    const el = fromHtml(`<section class="screen--home">
      <div class="home__glow" aria-hidden="true"></div>
      <header class="topbar">
        <div class="level-chip" data-ref="levelChip">
          <span class="level-chip__badge" data-ref="level">1</span>
          <span class="level-chip__info"><span class="level-chip__label" data-ref="levelLabel"></span>${bar('level-chip__bar', 'data-ref="levelBar"')}</span>
        </div>
        <div class="topbar__spacer"></div>
        <button type="button" class="gift-btn" data-action="home.dailyReward" data-ref="gift" data-i18n-aria="daily.title" aria-label="${esc(t('daily.title'))}" hidden>
          ${icon('gift', 'gift-btn__icon')}<span class="gift-btn__dot"></span></button>
        ${coinPill('home.coins')}
      </header>
      <div class="home__hero">
        <div class="home__floaters" aria-hidden="true">${floaters}</div>
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
            <span class="mode-card__text">
              <span class="mode-card__title"><span data-i18n="mode.journey"></span><span class="badge mode-card__tag" data-ref="journeyTag" hidden></span></span>
              <span class="mode-card__sub"><span data-ref="journeySub"></span><span class="mode-card__stars" data-ref="journeyStars" hidden>${icon('star')}<span data-ref="journeyStarsN"></span></span></span>
            </span>
          </button>
          <button type="button" class="mode-card__play" data-action="home.journeyPlay" data-ref="journeyPlay" data-i18n-aria="common.play">${icon('play', 'mode-card__go')}${icon('lock', 'mode-card__lock')}</button>
        </div>
        <div class="mode-card mode-card--daily" data-ref="daily">
          <button type="button" class="mode-card__main" data-action="home.daily">
            <span class="mode-card__icon cal"><span class="cal__month" data-ref="calMonth"></span><span class="cal__day" data-ref="calDay"></span></span>
            <span class="mode-card__text"><span class="mode-card__title" data-i18n="mode.daily"></span>
              <span class="mode-card__sub"><span data-ref="dailySub"></span><span class="mode-card__result" data-ref="dailyStars" hidden></span><span class="streak-chip" data-ref="dailyStreak" hidden>${icon('flame')}<span data-ref="dailyStreakN"></span></span></span>
            </span>
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
    app.action('home.dailyReward', () => {
      if (P.isFeatureUnlocked('daily_reward') && !app.modals.isOpen) app.modals.open('dailyReward', { auto: false });
    });
    app.action('home.coins', () => app.go('shop', { tab: 'coins' }));
    return el;
  },

  enter(params, app) {
    render(app);
    app.refreshCoins({ instant: true });
    requestAnimationFrame(() => app.popups.drainOnHome());
  },

  refresh(reason, app) {
    render(app);
    // a new day while home is shown (midnight, resume next morning) counts as an arrival
    if (reason === 'day' && app.router.current === 'home') requestAnimationFrame(() => app.popups.drainOnHome());
  },
};

/**
 * Starts journey level `n` (or continues the saved journey run of that level).
 * Used by the journey map / level start sheet as well.
 */
export function startJourney(app, n) {
  const P = app.progression;
  if (!P.isFeatureUnlocked('journey')) {
    lockedToast(app, 'journey');
    return;
  }
  if (n > P.journeyUnlocked) {
    app.toast(t('journey.lockedToast', { n: P.journeyUnlocked }), { icon: 'lock' });
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

export function lockedToast(app, feature) {
  app.toast(lockText(app, feature), { icon: 'lock' });
}

/** Teaser text of a locked feature ("Unlocks after 2 more games" / "Unlocks at journey level 4"). */
export function lockText(app, feature) {
  const req = CONFIG.UNLOCKS[feature];
  if (req.journeyLevel !== undefined) return t('home.locked.journeyLevel', { n: req.journeyLevel });
  const left = Math.max(1, req.games - app.save.stats.gamesPlayed);
  return t('home.locked.games', { n: left });
}

/** Completed-but-unclaimed missions (+ the bonus chest once it can be opened). */
export function claimableMissions(app) {
  const P = app.progression;
  if (!P.isFeatureUnlocked('missions')) return 0;
  const n = P.missions().filter((m) => !m.claimed && m.progress >= m.target).length;
  return n + (P.missionBonusStatus().available ? 1 : 0);
}

function dailyLevel(day) {
  if (dailyCache.day !== day) dailyCache = { day, level: generateDailyLevel(day) };
  return dailyCache.level;
}

function render(app) {
  if (!refs.play) return;
  const P = app.progression;
  const save = app.save;
  const info = P.levelInfo();
  setText(refs.level, String(info.level));
  setText(refs.levelLabel, t('home.level', { n: info.level }));
  setBar(refs.levelBar, info.progress);
  refs.levelChip.setAttribute('aria-label', t('home.levelAria', { n: info.level, xp: info.xpIntoLevel, next: info.xpForNext }));
  setText(refs.best, formatNumber(P.bestScore));

  // daily reward gift (only once unlocked; dot while claimable)
  const giftOpen = P.isFeatureUnlocked('daily_reward');
  refs.gift.hidden = !giftOpen;
  toggleClass(refs.gift, 'is-ready', giftOpen && P.dailyRewardStatus().available);

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
  const current = journeySaved ? saved.level.number : P.journeyUnlocked;
  setText(refs.journeySub, !journeyOpen ? lockText(app, 'journey')
    : journeySaved ? t('home.continueLevel', { n: saved.level.number })
      : t('home.journeyLevel', { n: P.journeyUnlocked }));
  const tag = journeyOpen ? levelKind(current) : 'normal';
  refs.journeyTag.hidden = tag === 'normal';
  if (tag !== 'normal') {
    refs.journeyTag.className = `badge badge--${tag} mode-card__tag`;
    refs.journeyTag.innerHTML = `${icon(tag === 'superhard' ? 'skull' : 'flame')}<span>${esc(t(`tag.${tag}`))}</span>`;
  }
  const starValues = Object.values(save.journey.stars).map(Number).filter((v) => v > 0);
  const stars = starValues.reduce((a, b) => a + b, 0);
  refs.journeyStars.hidden = !journeyOpen || starValues.length === 0;
  setText(refs.journeyStarsN, `${formatNumber(stars)}/${formatNumber(starValues.length * 3)}`);
  refs.journeyStars.setAttribute('aria-label', t('home.starsAria', { n: stars, max: starValues.length * 3 }));

  // Daily card
  const today = app.clock.today();
  setText(refs.calMonth, formatDay(today, { month: 'short' }).replace('.', '').toUpperCase());
  setText(refs.calDay, String(Number(today.slice(8))));
  const dailyOpen = P.isFeatureUnlocked('daily');
  const status = P.challengeStatus(today);
  const dailySaved = saved && saved.mode === 'daily';
  const done = dailyOpen && status.completed && !dailySaved;
  toggleClass(refs.daily, 'is-locked', !dailyOpen);
  toggleClass(refs.daily, 'is-done', done);
  let sub;
  if (!dailyOpen) sub = lockText(app, 'daily');
  else if (dailySaved) sub = t('home.continue');
  else if (status.completed) sub = '';
  else sub = t('home.dailyGoal', { n: dailyLevel(today).goals.score });
  setText(refs.dailySub, sub);
  refs.dailySub.hidden = !sub;
  refs.dailyStars.hidden = !done;
  if (done) {
    refs.dailyStars.innerHTML = starsRow(status.stars, 3, 'mode-card__stars-row');
    refs.dailyStars.setAttribute('aria-label', t('home.dailyDone'));
  }
  refs.dailyStreak.hidden = !dailyOpen || !(status.streak > 0);
  setText(refs.dailyStreakN, formatNumber(status.streak));
  refs.dailyStreak.setAttribute('aria-label', t('result.streak', { n: status.streak }));

  // Missions badge: claimable missions (+ bonus chest)
  const missionsOpen = P.isFeatureUnlocked('missions');
  const claimable = claimableMissions(app);
  setText(refs.missionsBadge, claimable ? String(claimable) : '');
  toggleClass(refs.missionsBadge, 'is-on', claimable > 0);
  toggleClass(refs.missions, 'is-locked', !missionsOpen);
}
