// Missions screen – PLACEHOLDER of part A (minimal, functional): today's three missions with
// progress and claim buttons plus the all-missions bonus. Part B replaces this file.

import { CONFIG } from '../../config.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { screenHeader, coinPill, bar } from '../components.js';

let listEl = null;

export const missionsScreen = {
  id: 'missions',

  build(app) {
    const el = fromHtml(`<section class="screen--missions">
      ${screenHeader('nav.missions', { right: coinPill() })}
      <div class="screen-body"><div class="mission-list" data-ref="list"></div></div>
    </section>`);
    listEl = el.querySelector('[data-ref="list"]');
    app.action('missions.claim.*', (btn, id) => {
      const coins = app.progression.claimMission(id);
      if (coins > 0) app.flyCoins(btn, coins);
      render(app);
    });
    app.action('missions.bonus', (btn) => {
      const coins = app.progression.claimMissionBonus();
      if (coins > 0) app.flyCoins(btn, coins);
      render(app);
    });
    return el;
  },

  enter(params, app) {
    app.refreshCoins({ instant: true });
    render(app);
  },

  refresh(reason, app) {
    render(app);
  },
};

function render(app) {
  const P = app.progression;
  if (!P.isFeatureUnlocked('missions')) {
    listEl.innerHTML = `<p class="screen-note">${esc(t('home.locked.games', { n: CONFIG.UNLOCKS.missions.games }))}</p>`;
    return;
  }
  let html = '';
  for (const m of P.missions()) {
    const done = m.progress >= m.target;
    html += `<div class="mission${done ? ' is-done' : ''}${m.claimed ? ' is-claimed' : ''}">
        <span class="mission__text">${esc(t(m.textKey, { n: m.target }))}</span>
        <span class="mission__progress">${bar('mission__bar')}<span class="mission__count">${esc(formatNumber(Math.min(m.progress, m.target)))}/${esc(formatNumber(m.target))}</span></span>
        ${m.claimed ? icon('check', 'mission__check')
    : done ? `<button type="button" class="btn btn--primary btn--sm" data-action="missions.claim.${esc(m.id)}">${icon('coin', 'btn__icon')}<span class="btn__label">+${esc(formatNumber(m.reward))}</span></button>`
      : `<span class="mission__reward">${icon('coin')}${esc(formatNumber(m.reward))}</span>`}
      </div>`;
  }
  const bonus = P.missionBonusStatus();
  html += `<div class="mission mission--bonus${bonus.claimed ? ' is-claimed' : ''}">
      <span class="mission__text">${esc(t('missions.bonus'))}</span>
      ${bonus.claimed ? icon('check', 'mission__check')
    : bonus.available ? `<button type="button" class="btn btn--primary btn--sm" data-action="missions.bonus">${icon('gift', 'btn__icon')}<span class="btn__label">+${esc(formatNumber(CONFIG.ECONOMY.MISSION_BONUS_COINS))}</span></button>`
      : `<span class="mission__reward">${icon('gift')}${esc(formatNumber(CONFIG.ECONOMY.MISSION_BONUS_COINS))}</span>`}
    </div>`;
  listEl.innerHTML = html;
  const missions = P.missions();
  listEl.querySelectorAll('.mission__bar').forEach((b, i) => {
    const m = missions[i];
    b.firstElementChild.style.transform = `scaleX(${Math.min(1, m.progress / m.target)})`;
  });
}
