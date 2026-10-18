// Journey / daily result (§4.15 "levelResult"): stars pop in one by one (Sfx 'star'), coins
// (+ "Watch ad: ×2" once), XP / level-up, daily streak; Next / Retry / Map (journey) or Home /
// Retry (daily). Failure variant: what was missing, Try again / Map|Home.
// props: { summary } (GameController.finalizeRun)

import { Sfx } from '../../audio/sfx.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, coinPill, starsRow } from '../components.js';
import { wait, pop } from '../anim.js';
import { coinsRow, xpRows, missionLine, armAdButtons, playRewards, doubleCoins, backHome, cleanupResult } from './result.js';

const STAR_FIRST_MS = 350;
const STAR_STEP_MS = 380;

export const levelResultModal = {
  id: 'levelResult',
  variant: 'full',

  build(p, m, app) {
    const s = p.summary;
    const won = s.reason === 'won';
    const daily = s.mode === 'daily';
    const label = daily ? t('hud.daily') : t('hud.level', { n: s.level.number });
    const title = won ? t(daily ? 'result.dailyComplete' : 'result.levelComplete') : t('result.levelFailed');
    let middle = '';
    if (won) {
      middle = starsRow(0, 3, 'result__stars', 'data-ref="stars"');
    } else {
      middle = `<div class="result__missing"><span class="result__missing-label">${esc(t('result.missing'))}</span>${missingGoals(s)}</div>`;
    }
    let card = '';
    if (won) {
      card += coinsRow(s, app, 'levelResult');
      if (daily && s.firstTime && s.streak > 0) {
        card += `<div class="result__line result__streak">${icon('flame')}<span>${esc(t('result.streak', { n: s.streak }))}</span></div>`;
      }
      card += `<div class="result__line">${icon('check')}<span>${esc(t('hud.pieces', { n: s.pieces }))}</span></div>`;
    }
    card += xpRows(s) + missionLine(app);
    let actions;
    if (won && !daily) {
      actions = `${btn({ action: 'levelResult.next', labelKey: 'result.next', icon: 'next', size: 'xl' })}
        <div class="result__pair">
          ${btn({ action: 'levelResult.retry', labelKey: 'result.retry', icon: 'retry', variant: 'secondary' })}
          ${btn({ action: 'levelResult.map', labelKey: 'result.map', icon: 'map', variant: 'secondary' })}
        </div>`;
    } else if (won) {
      actions = `${btn({ action: 'levelResult.home', labelKey: 'common.continue', icon: 'next', size: 'xl' })}
        ${btn({ action: 'levelResult.retry', labelKey: 'result.retry', icon: 'retry', variant: 'secondary' })}`;
    } else {
      actions = `${btn({ action: 'levelResult.retry', labelKey: 'result.tryAgain', icon: 'retry', size: 'xl' })}
        ${btn({ action: daily ? 'levelResult.home' : 'levelResult.map', labelKey: daily ? 'common.home' : 'result.map', icon: daily ? 'home' : 'map', variant: 'secondary' })}`;
    }
    return `<div class="result result--level${won ? ' is-won' : ' is-failed'}">
        <div class="result__top">${coinPill(null)}</div>
        <div class="result__head">
          <div class="result__label">${esc(label)}</div>
          <h2 class="result__title">${esc(title)}</h2>
          ${middle}
        </div>
        ${card ? `<div class="panel result__card">${card}</div>` : ''}
        <div class="result__actions">${actions}</div>
      </div>`;
  },

  onOpen(m, app) {
    const s = m.props.summary;
    armAdButtons(m);
    let delay = 200;
    if (s.reason === 'won') {
      const stars = m.$('[data-ref="stars"]');
      const items = stars ? stars.querySelectorAll('.star') : [];
      (async () => {
        await wait(STAR_FIRST_MS);
        for (let i = 0; i < s.stars && i < items.length; i++) {
          if (m.isClosed) return;
          items[i].classList.add('is-on');
          pop(items[i], 1.35);
          Sfx.play('star', { index: i });
          await wait(STAR_STEP_MS);
        }
      })();
      delay = STAR_FIRST_MS + STAR_STEP_MS * s.stars;
    }
    playRewards(m, app, delay);
  },

  onClose(m) {
    cleanupResult(m);
  },

  actions: {
    next(m, el, app) {
      app.game.leaveResult('next', m);
    },
    retry(m, el, app) {
      app.game.leaveResult('retry', m);
    },
    map(m, el, app) {
      app.game.leaveResult('map', m);
    },
    home(m, el, app) {
      app.game.leaveResult('home', m);
    },
    double(m, el, app) {
      doubleCoins(m, el, app);
    },
  },

  back(m, app) {
    backHome(m, app);
  },
};

/** Goals that were still open when the run failed. */
function missingGoals(s) {
  let html = '';
  const g = s.goals || {};
  if (g.score && g.score.have < g.score.need) {
    html += `<span class="result__goal">${icon('trophy')}${esc(formatNumber(g.score.need - g.score.have))}</span>`;
  }
  if (g.gems) {
    for (const type of Object.keys(g.gems)) {
      const left = g.gems[type].need - g.gems[type].have;
      if (left > 0) html += `<span class="result__goal">${icon('gem', '', Number(type))}${left}</span>`;
    }
  }
  return html;
}
