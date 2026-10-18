// Journey level start sheet (opened from a node of the journey map): level number + difficulty
// tag, the gems to collect, the star thresholds (pieces used, LevelDef.par) with the coins each
// result would pay per Progression.completeLevel (first clear: base + per star; replays: only
// newly earned stars), and Play / Continue.
// props: { n: number }

import { CONFIG } from '../../config.js';
import { generateLevel } from '../../core/levels.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, iconBtn, starsRow } from '../components.js';
import { startJourney } from '../screens/home.js';

const { LEVEL_COMPLETE_COINS, LEVEL_STAR_COINS } = CONFIG.ECONOMY;
/** First-clear base coins of a level (hard / super hard levels pay more: LevelDef.rewardCoins). */
const baseCoins = (level) => (Number(level.rewardCoins) > 0 ? Number(level.rewardCoins) : LEVEL_COMPLETE_COINS);

export const levelStartModal = {
  id: 'levelStart',
  variant: 'sheet',

  build(p, m, app) {
    const n = Math.max(1, Math.floor(Number(p.n)) || app.progression.journeyUnlocked);
    m.data.n = n;
    const level = generateLevel(n);
    const best = Number(app.save.journey.stars[n]) || 0;
    const saved = app.game.savedRun();
    const resume = !!(saved && saved.mode === 'journey' && saved.level && saved.level.number === n);
    const tag = level.tag !== 'normal'
      ? `<span class="badge badge--${level.tag} ls__tag">${icon(level.tag === 'superhard' ? 'skull' : 'flame')}${esc(t(`tag.${level.tag}`))}</span>`
      : '';
    const gems = level.goals.gems || {};
    const goals = Object.keys(gems).map((type) => `<span class="ls__gem">${icon('gem', 'ls__gem-icon', Number(type))}<span>${esc(formatNumber(gems[type]))}</span></span>`).join('');
    const rows = [3, 2, 1].map((s) => {
      const coins = best === 0 ? baseCoins(level) + LEVEL_STAR_COINS * s : LEVEL_STAR_COINS * Math.max(0, s - best);
      const text = s === 3 ? t('levelStart.par', { n: level.par[0] }) : s === 2 ? t('levelStart.par', { n: level.par[1] }) : t('levelStart.finish');
      return `<div class="ls__row${s <= best ? ' is-done' : ''}">
          ${starsRow(s, 3, 'ls__stars')}
          <span class="ls__row-text">${esc(text)}</span>
          ${coins > 0 ? `<span class="ls__coins">${icon('coin')}+${esc(formatNumber(coins))}</span>` : `<span class="ls__coins ls__coins--done">${icon('check')}</span>`}
        </div>`;
    }).join('');
    return `<div class="ls">
        ${iconBtn({ action: 'levelStart.close', icon: 'close', aria: 'common.close', cls: 'modal__close' })}
        <div class="ls__badge${level.tag !== 'normal' ? ` ls__badge--${level.tag}` : ''}">${n}</div>
        <h2 class="modal__title">${esc(t('hud.level', { n }))}</h2>
        ${tag || best ? `<div class="ls__meta">${tag}${best ? starsRow(best, 3, 'ls__best') : ''}</div>` : ''}
        <div class="ls__section">
          <span class="ls__label">${esc(t('levelStart.goal'))}</span>
          <div class="ls__goals">${goals}</div>
        </div>
        <div class="ls__section ls__par">${rows}</div>
        <div class="modal__actions">
          ${btn({ action: 'levelStart.play', labelKey: resume ? 'common.continue' : 'common.play', icon: 'play', size: 'xl' })}
        </div>
      </div>`;
  },

  actions: {
    play(m, el, app) {
      const n = m.data.n;
      m.close(true);
      startJourney(app, n);
    },
    close(m) {
      m.close(false);
    },
  },
};
