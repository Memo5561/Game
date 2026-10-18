// Second-chance modal.
//
// variant 'classic' (§4.15 offerRevive): countdown ring REVIVE_COUNTDOWN_SEC (paused while the app
// is in the background or a video is showing; expiry = decline, never starts an ad), "{n} to your
// best", options "Free revive!" (first games) / "Watch ad: Revive" (only with a video ready; armed
// after AD_BUTTON_ARM_MS) / "Use 200 coins", and "No thanks" – visible from the first frame, same
// size as the other buttons.
// variant 'level' (journey/daily "stuck" panel): boosters, revive options, give up. No countdown.
// props: { variant: 'classic'|'level' }

import { CONFIG } from '../../config.js';
import { Sfx } from '../../audio/sfx.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t } from '../i18n.js';
import { btn } from '../components.js';
import { shake } from '../anim.js';
import { ARMING, armAdButtons } from './result.js';

const RING_R = 28;

export const reviveModal = {
  id: 'revive',
  variant: 'sheet',

  build(p, m, app) {
    const level = p.variant === 'level';
    m.data.level = level;
    const s = app.game.session;
    if (!level) {
      const toBest = s.bestScore - s.score;
      return `<div class="ring" data-ref="ring">
          <svg class="ring__svg" viewBox="0 0 64 64" aria-hidden="true"><circle class="ring__track" cx="32" cy="32" r="${RING_R}"/>
            <circle class="ring__progress" data-ref="ringProgress" cx="32" cy="32" r="${RING_R}" pathLength="100"/></svg>
          <span class="ring__num" data-ref="num">${CONFIG.ADS.REVIVE_COUNTDOWN_SEC}</span>
        </div>
        <h2 class="modal__title">${esc(t('revive.title'))}</h2>
        ${toBest > 0 ? `<p class="modal__text revive__best">${icon('crown')}<span>${esc(t('revive.toBest', { n: toBest }))}</span></p>` : ''}
        <p class="modal__hint">${esc(t('revive.hint'))}</p>
        <div class="modal__actions" data-ref="actions">${reviveButtons(app)}${btn({ action: 'revive.skip', labelKey: 'revive.skip', variant: 'ghost' })}</div>`;
    }
    return `<div class="modal__icon">${icon('info')}</div>
      <h2 class="modal__title">${esc(t('revive.title'))}</h2>
      <p class="modal__text">${esc(t('stuck.body'))}</p>
      <div class="stuck__boosters">${boosterButton('hammer', app)}${boosterButton('shuffle', app)}</div>
      <div class="modal__actions" data-ref="actions">${reviveButtons(app)}${btn({ action: 'revive.giveUp', labelKey: 'stuck.giveUp', variant: 'ghost' })}</div>`;
  },

  onOpen(m, app) {
    armAdButtons(m);
    m.data.unsub = app.on('adState', () => {
      if (m.data.locked || m.isClosed) return;
      const wrap = m.$('[data-ref="actions"]');
      const skip = wrap.lastElementChild;
      wrap.innerHTML = reviveButtons(app) + skip.outerHTML;
      armAdButtons(m);
    });
    if (m.data.level) return;
    const ring = m.$('[data-ref="ringProgress"]');
    const total = CONFIG.ADS.REVIVE_COUNTDOWN_SEC * 1000;
    // Real time on purpose (not the debug animation scale): the countdown is a player-facing rule.
    m.data.anim = ring.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 100 }], { duration: total, fill: 'forwards' });
    m.data.anim.onfinish = () => expire(m, app);
    let shown = CONFIG.ADS.REVIVE_COUNTDOWN_SEC;
    m.data.ticker = setInterval(() => {
      const a = m.data.anim;
      if (!a) return;
      const left = Math.max(0, Math.ceil((total - (a.currentTime || 0)) / 1000));
      if (left !== shown) {
        shown = left;
        m.$('[data-ref="num"]').textContent = String(left);
        if (left > 0) Sfx.play('tick');
      }
    }, 100);
    if (app.appPaused) m.data.anim.pause();
  },

  onClose(m) {
    clearTimeout(m.data.armTimer);
    clearInterval(m.data.ticker);
    if (m.data.anim) {
      m.data.anim.onfinish = null;
      m.data.anim.cancel();
    }
    if (m.data.unsub) m.data.unsub();
  },

  pauseTimers(m) {
    if (m.data.anim) m.data.anim.pause();
  },

  resumeTimers(m) {
    if (m.data.anim && !m.data.locked) m.data.anim.play();
  },

  actions: {
    free(m, el, app) {
      run(m, app, 'free');
    },
    watch(m, el, app) {
      run(m, app, 'ad');
    },
    coins(m, el, app) {
      if (app.progression.coins < CONFIG.ECONOMY.REVIVE_COINS) {
        shake(el);
        app.toast(t('toast.notEnoughCoins'), { icon: 'coin' });
        return;
      }
      run(m, app, 'coins');
    },
    skip(m, el, app) {
      m.close();
      app.game.declineRevive();
    },
    giveUp(m, el, app) {
      m.close();
      app.game.declineRevive();
    },
    booster(m, el, app, name) {
      const type = name.split('.')[1];
      m.close();
      app.game.boosterTap(type);
    },
  },

  back(m, app) {
    if (m.data.locked) return;
    m.close();
    app.game.declineRevive();
  },
};

/** Revive option buttons for the current options (ad button only with a video ready). */
function reviveButtons(app) {
  const o = app.game.reviveOptions();
  if (!o.canRevive) return '';
  let html = '';
  if (o.free) {
    html += btn({ action: 'revive.free', labelKey: 'revive.free', icon: 'play', size: 'lg' });
  } else {
    if (o.ad) html += btn({ action: 'revive.watch', labelKey: 'revive.watch', icon: 'ad', variant: 'ad', size: 'lg', cls: 'is-arming', attrs: ARMING });
    html += btn({ action: 'revive.coins', labelKey: 'revive.coins', params: { n: o.price }, icon: 'coin', variant: 'secondary', size: o.ad ? 'md' : 'lg' });
  }
  return html;
}

function boosterButton(type, app) {
  const n = app.progression.boosterCount(type);
  return `<button type="button" class="booster booster--big" data-action="revive.booster.${type}" data-booster="${type}">
      ${icon(type, 'booster__icon')}<span class="booster__count${n ? '' : ' is-add'}">${n || '+'}</span>
      <span class="booster__label">${esc(t(`booster.${type}`))}</span></button>`;
}

/** Runs a revive option; the modal is closed by the controller on success. */
async function run(m, app, source) {
  if (m.data.locked) return;
  m.data.locked = true;
  if (m.data.anim) m.data.anim.pause();
  for (const b of m.el.querySelectorAll('button')) b.disabled = true;
  const ok = await app.game.revive(source);
  if (ok || m.isClosed) return;
  m.data.locked = false;
  for (const b of m.el.querySelectorAll('button')) b.disabled = false;
  if (m.data.anim && !app.appPaused) m.data.anim.play();
}

function expire(m, app) {
  if (m.isClosed || m.data.locked) return;
  m.close();
  app.game.declineRevive();
}
