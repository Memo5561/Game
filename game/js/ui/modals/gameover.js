// Classic run-end screen (§4.15): score count-up ≤ 0.8 s → best bar ("New best!" / "First record
// set!" / "Only n to beat your best!") → coins + "Watch ad: ×2" (once) → XP bar + level-up → nearest
// mission → big "Play again" (middle third) + "Home". Optional soft upsell chip. After a new best
// the Play review card is requested automatically (rules below), with no question before it.
// props: { summary } (GameController.finalizeRun)

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { Sfx } from '../../audio/sfx.js';
import { flushSave, requestSave } from '../../meta/storage.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, bar, coinPill, setBar } from '../components.js';
import { countUp, pop } from '../anim.js';
import { coinsRow, xpRows, missionLine, armAdButtons, playRewards, doubleCoins, backHome, cleanupResult } from './result.js';

/** "Only n to beat your best!" from this share of the best score on. */
const NUDGE_FROM = 0.6;
const SCORE_COUNT_MS = 800;
const REVIEW_DELAY_MS = 1600;

export const gameoverModal = {
  id: 'gameover',
  variant: 'full',

  build(p, m, app) {
    const s = p.summary;
    m.data.upsell = app.adPolicy.shouldShowUpsell();
    let best;
    if (s.newBest) {
      best = `<div class="result__record" data-ref="record">${icon('crown')}<span>${esc(t(s.firstRecord ? 'result.firstRecord' : 'result.newBest'))}</span></div>`;
    } else {
      const near = s.bestBefore > 0 && s.score >= s.bestBefore * NUDGE_FROM;
      best = `<div class="best-bar">
          <div class="best-bar__labels"><span class="best-bar__label">${icon('crown')}<span>${esc(t('common.best'))}</span></span><span class="best-bar__value">${esc(formatNumber(s.bestBefore))}</span></div>
          ${bar('best-bar__bar', 'data-ref="bestBar"')}
        </div>
        ${near ? `<p class="result__nudge">${esc(t('hud.nudge', { n: s.bestBefore - s.score + 1 }))}</p>` : ''}`;
    }
    const card = coinsRow(s, app, 'gameover') + xpRows(s) + missionLine(app);
    return `<div class="result">
        <div class="result__top">${coinPill(null)}</div>
        <div class="result__head">
          <div class="result__label">${esc(t('result.score'))}</div>
          <div class="result__score" data-ref="score" data-value="0">0</div>
          <div class="result__best">${best}</div>
        </div>
        ${card ? `<div class="panel result__card">${card}</div>` : ''}
        <div class="result__actions">
          ${btn({ action: 'gameover.again', labelKey: 'result.again', icon: 'retry', size: 'xl' })}
          ${btn({ action: 'gameover.home', labelKey: 'common.home', icon: 'home', variant: 'ghost' })}
        </div>
        ${m.data.upsell ? `<button type="button" class="chip result__upsell" data-action="gameover.upsell">${icon('noads')}<span>${esc(t('result.upsell'))}</span></button>` : ''}
      </div>`;
  },

  onOpen(m, app) {
    const s = m.props.summary;
    armAdButtons(m);
    if (m.data.upsell) app.adPolicy.markUpsellShown();
    if (s.firstRecord && !app.save.flags.firstRecordShown) {
      app.save.flags.firstRecordShown = true;
      requestSave(app.save);
    }
    const bestBar = m.$('[data-ref="bestBar"]');
    if (bestBar) setBar(bestBar, 0);
    countUp(m.$('[data-ref="score"]'), s.score, { from: 0, ms: SCORE_COUNT_MS, format: formatNumber }).then(() => {
      if (m.isClosed) return;
      if (bestBar) setBar(bestBar, s.bestBefore > 0 ? s.score / s.bestBefore : 0);
      const record = m.$('[data-ref="record"]');
      if (record) {
        record.classList.add('is-on');
        pop(record, 1.15);
        Sfx.play('newbest');
      }
    });
    playRewards(m, app, SCORE_COUNT_MS);
    maybeAskReview(m, app, s);
  },

  onClose(m) {
    cleanupResult(m);
  },

  actions: {
    again(m, el, app) {
      app.game.leaveResult('again', m);
    },
    home(m, el, app) {
      app.game.leaveResult('home', m);
    },
    double(m, el, app) {
      doubleCoins(m, el, app);
    },
    upsell(m, el, app) {
      app.startAds();
      m.close();
      app.go('shop');
    },
  },

  back(m, app) {
    backHome(m, app);
  },
};

/** Play review card: automatically after a new best, from ASK_REVIEW_AFTER_GAMES games, once ever. */
function maybeAskReview(m, app, s) {
  const save = app.save;
  if (!s.newBest || save.stats.gamesPlayed < CONFIG.RETENTION.ASK_REVIEW_AFTER_GAMES || save.flags.reviewAsked) return;
  save.flags.reviewAsked = true;
  flushSave(save);
  m.data.reviewTimer = setTimeout(() => {
    if (!m.isClosed) Platform.requestReview();
  }, REVIEW_DELAY_MS);
}

