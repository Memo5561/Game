// Daily reward: the 7-day login calendar (§1, §4.9 dailyRewardStatus / claimDailyReward).
// Opened automatically on arrival at home (popup 'dailyReward', highest priority) or from the
// home gift button. Days 1–6 pay coins, day 7 is a chest with boosters. "Claim" (or, with a video
// ready, "Watch ad: ×2" – placement 'daily_double', coins only) → today's tile flips to claimed,
// coins fly into the pill, the sheet closes, then the reminder soft ask may follow.
// A claim that used the grace day shows "Streak saved!". Without a claimable reward the sheet is a
// read-only calendar with the time until the next reward.
// props: { auto?: boolean }

import { Sfx } from '../../audio/sfx.js';
import { flushSave } from '../../meta/storage.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, coinPill, formatDuration, msUntilMidnight } from '../components.js';
import { countUp, pop, wait } from '../anim.js';
import { ARMING, armAdButtons } from './result.js';

/** Pause after the coin flight before the sheet closes by itself. */
const CLOSE_DELAY_MS = 900;

export const dailyRewardModal = {
  id: 'dailyReward',
  variant: 'sheet',

  build(p, m, app) {
    const P = app.progression;
    const st = P.dailyRewardStatus();
    const today = app.clock.today();
    const claimedToday = app.save.daily.lastClaimDay === today;
    m.data.available = st.available;
    let sub;
    if (st.available) {
      if (st.graceUsed) sub = t('daily.sub.grace');
      else if (st.streak > 0) sub = t('daily.sub.streak', { n: st.streak });
      else sub = t('daily.sub.first');
    } else {
      sub = t('daily.sub.next', { time: formatDuration(msUntilMidnight(app.clock.now())) });
    }
    const cells = st.rewards.map((r) => {
      let state = '';
      if (st.available) state = r.day < st.day ? 'is-claimed' : r.day === st.day ? 'is-today' : '';
      else if (claimedToday) state = r.day < st.day ? 'is-claimed' : r.day === st.day ? 'is-claimed is-today' : '';
      return dayCell(r, state);
    }).join('');
    const actions = st.available ? claimButtons(app, p.auto)
      : btn({ action: 'dailyReward.close', labelKey: 'common.ok', variant: 'secondary', size: 'lg' });
    return `<div class="daily">
        <div class="daily__pill">${coinPill(null)}</div>
        <div class="modal__icon daily__icon">${icon('calendar')}</div>
        <h2 class="modal__title" data-i18n="daily.title">${esc(t('daily.title'))}</h2>
        <p class="modal__text daily__sub" data-ref="sub">${esc(sub)}</p>
        <div class="daily__grid">${cells}</div>
        <div class="modal__actions" data-ref="actions">${actions}</div>
      </div>`;
  },

  onOpen(m, app) {
    const pill = m.$('[data-coins]');
    if (pill) countUp(pill, app.save.coins, { ms: 0, format: formatNumber });
    if (m.props.auto) armAdButtons(m);
    // a video becoming (un)available updates the ×2 offer (never while claiming)
    m.data.unsub = app.on('adState', () => {
      if (m.isClosed || !m.data.available || m.data.claiming || m.data.claimed) return;
      const had = !!m.$('[data-action="dailyReward.double"]');
      if (had === app.isRewardedAvailable()) return;
      m.$('[data-ref="actions"]').innerHTML = claimButtons(app, false);
    });
    const todayCell = m.$('.dday.is-today:not(.is-claimed)');
    if (todayCell) setTimeout(() => { if (!m.isClosed) pop(todayCell, 1.1); }, 320);
  },

  onClose(m) {
    clearTimeout(m.data.armTimer);
    if (m.data.unsub) m.data.unsub();
  },

  actions: {
    claim(m, el, app) {
      claim(m, app, 1, el);
    },
    double(m, el, app) {
      claim(m, app, 2, el);
    },
    close(m, el, app) {
      closeSheet(m, app);
    },
  },

  back(m, app) {
    if (!m.data.claiming) closeSheet(m, app);
  },
};

function closeSheet(m, app) {
  if (m.data.available && !m.data.claimed) app.retention.dismissDailyReward();
  m.close(false);
}

/** Claim + (with a video ready) "Watch ad: ×2"; auto-opened sheets arm the ad button late. */
function claimButtons(app, arming) {
  return `${btn({ action: 'dailyReward.claim', labelKey: 'daily.claim', icon: 'gift', size: 'lg' })}
    ${app.isRewardedAvailable() ? btn({ action: 'dailyReward.double', labelKey: 'daily.double', icon: 'ad', variant: 'ad', cls: arming ? 'is-arming' : '', attrs: arming ? ARMING : '' }) : ''}`;
}

function dayCell(r, state) {
  const big = !!r.boosters;
  const boosters = big
    ? `<span class="dday__boosters">${Object.keys(r.boosters).map((type) => `<span class="dday__booster">${icon(type)}<span>×${r.boosters[type]}</span></span>`).join('')}</span>`
    : '';
  return `<div class="dday${big ? ' dday--chest' : ''}${state ? ` ${state}` : ''}" data-day="${r.day}">
      <span class="dday__label">${esc(t('daily.day', { n: r.day }))}</span>
      <span class="dday__icon">${icon(big ? 'chest' : 'coin')}</span>
      <span class="dday__amount">${esc(formatNumber(r.coins))}</span>
      ${boosters}
      <span class="dday__check">${icon('check')}</span>
    </div>`;
}

/**
 * Claims today's reward (× multiplier after a rewarded video).
 * @param {Object} m modal handle
 * @param {Object} app
 * @param {1|2} mult
 * @param {Element} el the tapped button
 */
async function claim(m, app, mult, el) {
  if (m.data.claiming || m.data.claimed) return;
  m.data.claiming = true;
  const buttons = m.el.querySelectorAll('[data-ref="actions"] .btn');
  if (mult === 2) {
    el.disabled = true;
    const ok = await app.showRewarded('daily_double');
    if (!ok) {
      m.data.claiming = false;
      el.disabled = false;
      return;
    }
  }
  for (const b of buttons) b.disabled = true;
  const r = app.progression.claimDailyReward(mult);
  flushSave(app.save);
  m.data.claimed = r;
  const cell = m.$('.dday.is-today');
  if (cell) {
    cell.classList.add('is-claimed');
    pop(cell, 1.12);
  }
  Sfx.play('reward');
  app.haptic('success');
  if (r.graceUsed) app.toast(t('daily.streakSaved'), { icon: 'flame', tone: 'good' });
  const b = r.boosters || {};
  if (b.hammer || b.shuffle) {
    app.toast(t('daily.boosterGift', { hammer: b.hammer || 0, shuffle: b.shuffle || 0 }), { icon: 'gift', tone: 'good' });
  }
  if (mult === 2) {
    const amount = cell && cell.querySelector('.dday__amount');
    if (amount) countUp(amount, r.coins, { ms: 400, format: formatNumber });
  }
  await app.flyCoins(cell || el, r.coins);
  await wait(CLOSE_DELAY_MS);
  m.data.claiming = false;
  if (m.isClosed) return;
  await m.close(true);
  app.router.refresh('data');
  afterClaim(app, r);
}

/** After a claim: the notification soft ask (never stacked – the calendar is closed by now). */
function afterClaim(app, r) {
  if (app.modals.isOpen || app.router.current !== 'home') return;
  if (!app.retention.shouldAskNotif()) return;
  const rewards = app.progression.dailyRewardStatus().rewards;
  const next = rewards[r.day % rewards.length];
  app.modals.open('notifAsk', { coins: next ? next.coins : rewards[0].coins });
}
