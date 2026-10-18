// Daily missions (§4.10): three cards (easy / medium / hard) with text, progress bar and reward;
// a completed mission gets a Claim button (coins fly into the pill), claimed ones are checked off.
// Claiming all three unlocks the bonus chest (MISSION_BONUS_COINS) with an opening animation.
// A countdown shows the time until the missions reset at local midnight. Before the 'missions'
// unlock the screen shows a teaser instead.

import { CONFIG } from '../../config.js';
import { Sfx } from '../../audio/sfx.js';
import { icon } from '../icons.js';
import { fromHtml, esc, setText } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { screenHeader, coinPill, bar, setBar, btn, formatDuration, msUntilMidnight } from '../components.js';
import { pop, wait, animate } from '../anim.js';
import { lockText } from './home.js';

const SLOT_KEYS = ['missions.easy', 'missions.medium', 'missions.hard'];
const TICK_MS = 30000;

let el = null;
let listEl = null;
let timerEl = null;
let ticker = 0;
let opening = false;

export const missionsScreen = {
  id: 'missions',

  build(app) {
    el = fromHtml(`<section class="screen--missions">
      ${screenHeader('nav.missions', { right: coinPill() })}
      <div class="screen-body">
        <div class="missions-timer" data-ref="timer">${icon('clock')}<span data-ref="timerText"></span></div>
        <div class="mission-list" data-ref="list"></div>
      </div>
    </section>`);
    listEl = el.querySelector('[data-ref="list"]');
    timerEl = el.querySelector('[data-ref="timerText"]');
    app.action('missions.claim.*', (b, id) => claim(app, id, b));
    app.action('missions.bonus', (b) => openChest(app, b));
    app.action('missions.play', () => app.go('home'));
    return el;
  },

  enter(params, app) {
    el.querySelector('.screen-body').scrollTop = 0;
    app.refreshCoins({ instant: true });
    render(app);
    tick(app);
    clearInterval(ticker);
    ticker = setInterval(() => tick(app), TICK_MS);
  },

  leave() {
    clearInterval(ticker);
    ticker = 0;
  },

  refresh(reason, app) {
    if (opening) return;
    render(app);
    tick(app);
  },
};

function tick(app) {
  setText(timerEl, t('missions.resets', { time: formatDuration(msUntilMidnight(app.clock.now())) }));
}

function render(app) {
  const P = app.progression;
  const open = P.isFeatureUnlocked('missions');
  el.querySelector('[data-ref="timer"]').hidden = !open;
  if (!open) {
    listEl.innerHTML = `<div class="locked-card">
        <span class="locked-card__icon">${icon('missions')}<span class="locked-card__lock">${icon('lock')}</span></span>
        <span class="locked-card__title">${esc(t('missions.lockedTitle'))}</span>
        <span class="locked-card__text">${esc(lockText(app, 'missions'))}</span>
        ${btn({ action: 'missions.play', labelKey: 'common.play', icon: 'play', size: 'lg' })}
      </div>`;
    return;
  }
  const missions = P.missions();
  let html = '';
  missions.forEach((m, i) => {
    const done = m.progress >= m.target;
    const state = m.claimed ? 'is-claimed' : done ? 'is-done' : '';
    let action;
    if (m.claimed) action = `<span class="mission__check">${icon('check')}</span>`;
    else if (done) action = btn({ action: `missions.claim.${m.id}`, label: `+${formatNumber(m.reward)}`, icon: 'coin', size: 'sm', cls: 'mission__claim' });
    else action = `<span class="mission__reward">${icon('coin')}<span>${esc(formatNumber(m.reward))}</span></span>`;
    html += `<div class="mission mission--slot${Math.min(i, 2)} ${state}" data-mission="${esc(m.id)}">
        <span class="mission__body">
          <span class="mission__level">${esc(t(SLOT_KEYS[i] || SLOT_KEYS[2]))}</span>
          <span class="mission__text">${esc(t(m.textKey, { n: m.target }))}</span>
          <span class="mission__progress">${bar('mission__bar')}<span class="mission__count">${esc(formatNumber(Math.min(m.progress, m.target)))}/${esc(formatNumber(m.target))}</span></span>
        </span>
        <span class="mission__action">${action}</span>
      </div>`;
  });
  const bonus = P.missionBonusStatus();
  const claimedCount = missions.filter((m) => m.claimed).length;
  const chestState = bonus.claimed ? 'is-open' : bonus.available ? 'is-ready' : '';
  html += `<div class="chest-card ${chestState}" data-ref="chest">
      <span class="chest-card__chest" data-ref="chestIcon">${icon(bonus.claimed ? 'chest-open' : 'chest')}<span class="chest-card__rays"></span></span>
      <span class="chest-card__body">
        <span class="chest-card__title">${esc(t('missions.bonusTitle'))}</span>
        <span class="chest-card__text">${esc(bonus.claimed ? t('missions.bonusDone') : t('missions.bonus'))}</span>
        ${bonus.claimed ? '' : `<span class="chest-card__pips">${missions.map((m) => `<i class="${m.claimed ? 'is-on' : ''}"></i>`).join('')}<span class="chest-card__count">${claimedCount}/${missions.length}</span></span>`}
      </span>
      <span class="chest-card__action">${bonus.claimed
    ? `<span class="mission__check">${icon('check')}</span>`
    : bonus.available
      ? btn({ action: 'missions.bonus', labelKey: 'common.open', icon: 'gift', size: 'sm' })
      : `<span class="mission__reward">${icon('coin')}<span>${esc(formatNumber(CONFIG.ECONOMY.MISSION_BONUS_COINS))}</span></span>`}</span>
    </div>`;
  listEl.innerHTML = html;
  listEl.querySelectorAll('.mission__bar').forEach((b, i) => {
    const m = missions[i];
    setBar(b, m.progress / m.target);
  });
}

async function claim(app, id, b) {
  if (b.disabled) return;
  b.disabled = true;
  const coins = app.progression.claimMission(id);
  if (!(coins > 0)) {
    render(app);
    return;
  }
  Sfx.play('reward');
  app.haptic('success');
  const card = b.closest('.mission');
  const fly = app.flyCoins(b, coins);
  if (card) {
    card.classList.add('is-claimed');
    pop(card, 1.03);
  }
  await fly;
  if (app.router.current !== 'missions') return;
  render(app);
  const chest = listEl.querySelector('.chest-card.is-ready');
  if (chest) {
    pop(chest, 1.06);
    Sfx.play('unlock');
  }
}

/** Bonus chest: shake → lid pops open with a burst → coins fly → claimed. */
async function openChest(app, b) {
  if (opening || b.disabled) return;
  const P = app.progression;
  if (!P.missionBonusStatus().available) return;
  opening = true;
  b.disabled = true;
  const card = listEl.querySelector('[data-ref="chest"]');
  const chest = card.querySelector('[data-ref="chestIcon"]');
  try {
    await animate(chest, [
      { transform: 'rotate(0)' }, { transform: 'rotate(-9deg) scale(1.05)' }, { transform: 'rotate(8deg) scale(1.08)' },
      { transform: 'rotate(-6deg) scale(1.1)' }, { transform: 'rotate(0) scale(1.12)' },
    ], { duration: 520, easing: 'ease-in-out' });
    const coins = P.claimMissionBonus();
    chest.innerHTML = `${icon('chest-open')}<span class="chest-card__rays"></span>`;
    card.classList.remove('is-ready');
    card.classList.add('is-open', 'is-burst');
    Sfx.play('reward');
    app.haptic('success');
    await animate(chest, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    if (coins > 0) await app.flyCoins(chest, coins);
    await wait(250);
  } finally {
    opening = false;
  }
  if (app.router.current === 'missions') render(app);
}

