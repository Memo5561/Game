// Shared parts of the two run-result screens (gameover, levelResult): coins (+ "Watch ad: ×2"
// once), XP bar with level-up line, nearest-mission line, arming of auto-opened ad buttons and
// the coin flight into the balance pill.

import { CONFIG } from '../../config.js';
import { Sfx } from '../../audio/sfx.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, bar, animateBar } from '../components.js';
import { countUp, wait, pop } from '../anim.js';

/** Attributes of an ad button that ignores taps for AD_BUTTON_ARM_MS after an auto-open. */
export const ARMING = 'data-arm aria-disabled="true"';

/** Arms the ad buttons of an auto-opened modal after AD_BUTTON_ARM_MS (real time). */
export function armAdButtons(m) {
  m.data.armTimer = setTimeout(() => {
    for (const b of m.el.querySelectorAll('[data-arm]')) {
      b.removeAttribute('aria-disabled');
      b.classList.remove('is-arming');
    }
  }, CONFIG.ADS.AD_BUTTON_ARM_MS);
}

/** The "Watch ad: ×2" button (starts unarmed: ignores taps for AD_BUTTON_ARM_MS). */
function doubleButton(modalId) {
  return btn({ action: `${modalId}.double`, labelKey: 'result.double', icon: 'ad', variant: 'ad', size: 'sm', cls: 'is-arming', attrs: ARMING });
}

/** Coins row: "+N" and, once, "Watch ad: ×2" (only with a rewarded video ready). */
export function coinsRow(sum, app, modalId) {
  if (!(sum.coinsEarned > 0)) return '';
  const ad = !sum.doubled && app.isRewardedAvailable();
  return `<div class="result__row result__coins">
      <span class="result__coin-amount" data-ref="coinsBox">${icon('coin')}<span>+</span><span data-ref="coins" data-value="0">0</span></span>
      ${ad ? doubleButton(modalId) : ''}
    </div>`;
}

/**
 * A rewarded video that finishes loading while the result screen is open (right after another ad,
 * during SDK warm-up) still gets its "Watch ad: ×2" offer. Call from onOpen; cleanupResult undoes it.
 */
export function watchDoubleOffer(m, app, modalId) {
  m.data.unsubAd = app.on('adState', () => {
    const sum = m.props.summary;
    if (m.isClosed || sum.doubled || m.data.doubling || !(sum.coinsEarned > 0) || !app.isRewardedAvailable()) return;
    const row = m.$('.result__coins');
    if (!row || row.querySelector('[data-action$=".double"], .result__doubled')) return;
    row.insertAdjacentHTML('beforeend', doubleButton(modalId));
    // armed late, like the auto-opened ones, so a tap meant for something else cannot hit it
    clearTimeout(m.data.lateArmTimer);
    m.data.lateArmTimer = setTimeout(() => {
      const b = row.querySelector('[data-arm]');
      if (b) {
        b.removeAttribute('aria-disabled');
        b.classList.remove('is-arming');
      }
    }, CONFIG.ADS.AD_BUTTON_ARM_MS);
  });
}

/** XP bar row + level-up / theme-unlock lines. */
export function xpRows(sum) {
  let html = '';
  if (sum.xpGained > 0) {
    html += `<div class="result__row result__xp">
        <span class="lvl-badge" data-ref="lvl">${sum.levelBefore.level}</span>
        ${bar('result__xpbar', 'data-ref="xpBar"')}
        <span class="result__xp-gain">${esc(t('result.xp', { n: sum.xpGained }))}</span>
      </div>`;
  }
  if (sum.levelUps.length) {
    const lvl = sum.levelUps[sum.levelUps.length - 1];
    html += `<div class="result__line result__levelup" data-ref="levelUp">${icon('star')}<span>${esc(t('result.levelUp', { n: lvl }))}</span>
      ${sum.levelUpCoins > 0 ? `<span class="result__bonus">${icon('coin')}+${esc(formatNumber(sum.levelUpCoins))}</span>` : ''}</div>`;
  }
  for (const id of sum.unlockedThemes) {
    html += `<div class="result__line result__theme">${icon('gift')}<span>${esc(t('result.themeUnlocked', { name: t(`theme.${id}`) }))}</span></div>`;
  }
  return html;
}

/**
 * Mission lines of a result card: every mission this run completed (the toasts wait for the result
 * screen, so they never cover it), else one line of progress toward the nearest daily mission
 * (empty while missions are locked).
 * @param {Object} app
 * @param {{ missionsDone?: Object[] }} [sum] run summary
 */
export function missionLine(app, sum = {}) {
  const list = app.progression.missions().filter((m) => !m.claimed);
  if (!list.length) return '';
  const completed = list.filter((m) => m.progress >= m.target);
  const fresh = completed.filter((m) => (sum.missionsDone || []).some((d) => d.id === m.id));
  const done = fresh.length ? fresh : completed.slice(0, 1);
  if (done.length) {
    return done.map((d) => `<div class="result__line result__mission is-done">${icon('check')}<span>${esc(t('result.missionDone', { text: t(d.textKey, { n: d.target }) }))}</span></div>`).join('');
  }
  const best = list.reduce((a, b) => (b.progress / b.target > a.progress / a.target ? b : a));
  return `<div class="result__line result__mission">${icon('missions')}<span class="result__mission-text">${esc(t(best.textKey, { n: best.target }))}</span>
      <span class="result__mission-count">${esc(formatNumber(best.progress))}/${esc(formatNumber(best.target))}</span></div>`;
}

/**
 * Shared opening animation: pill shows the balance before the run, coins count up and fly into
 * the pill, the XP bar fills (through a level-up).
 * @param {Object} m modal handle (refs via m.$)
 * @param {Object} app
 * @param {number} [delay] ms before the coins start (after the score count-up)
 */
export async function playRewards(m, app, delay = 0) {
  const sum = m.props.summary;
  const pill = m.$('[data-coins]');
  if (pill) countUp(pill, sum.coinsBefore, { ms: 0, format: formatNumber });
  const xpBar = m.$('[data-ref="xpBar"]');
  if (xpBar) xpBar.firstElementChild.style.transform = `scaleX(${sum.levelBefore.progress})`;
  await wait(delay);
  if (m.isClosed) return;
  const coinsEl = m.$('[data-ref="coins"]');
  if (coinsEl) {
    await countUp(coinsEl, sum.coinsEarned, { ms: 500, format: formatNumber });
    if (m.isClosed) return;
    Sfx.play('coin');
    app.flyCoins(m.$('[data-ref="coinsBox"]'), sum.coinsEarned + sum.levelUpCoins);
  } else if (pill) {
    app.refreshCoins();
  }
  if (xpBar) {
    const before = sum.levelBefore;
    const after = sum.levelAfter;
    if (after.level > before.level) {
      await animateBar(xpBar, before.progress, 1, 450);
      if (m.isClosed) return;
      m.$('[data-ref="lvl"]').textContent = String(after.level);
      pop(m.$('[data-ref="lvl"]'), 1.3);
      Sfx.play('unlock');
      await animateBar(xpBar, 0, after.progress, 400);
    } else {
      await animateBar(xpBar, before.progress, after.progress, 600);
    }
  }
  const lu = m.$('[data-ref="levelUp"]');
  if (lu) pop(lu, 1.08);
}

/** "Watch ad: ×2" on a result screen. */
export async function doubleCoins(m, el, app) {
  if (m.data.doubling) return;
  m.data.doubling = true;
  el.disabled = true;
  const added = await app.game.doubleReward(m);
  m.data.doubling = false;
  if (m.isClosed) return;
  if (added > 0) {
    const sum = m.props.summary;
    el.outerHTML = `<span class="result__doubled">${icon('check')}${esc(t('result.doubled'))}</span>`;
    countUp(m.$('[data-ref="coins"]'), sum.coinsEarned * 2, { ms: 500, format: formatNumber });
    Sfx.play('reward');
    app.flyCoins(m.$('[data-ref="coinsBox"]'), added);
  } else {
    el.disabled = false;
  }
}

/** Back on a result screen → home (never an interstitial on back). */
export function backHome(m, app) {
  app.startAds();
  m.close();
  app.go('home');
}

/**
 * Marks a result taller than its screen (small phone, landscape): `.is-overflowing` pins the
 * buttons to the bottom edge, so Home / Retry never hide below the fold.
 */
export function trackOverflow(m) {
  const root = m.$('.result');
  const check = () => {
    if (!m.isClosed && root) root.classList.toggle('is-overflowing', m.dialog.scrollHeight > m.dialog.clientHeight + 1);
  };
  m.data.overflowCheck = check;
  window.addEventListener('resize', check);
  requestAnimationFrame(check);
  m.data.overflowTimer = setTimeout(check, 500); // after the entry animation and the first reflows
}

export function cleanupResult(m) {
  if (m.data.overflowCheck) window.removeEventListener('resize', m.data.overflowCheck);
  clearTimeout(m.data.overflowTimer);
  clearTimeout(m.data.armTimer);
  clearTimeout(m.data.lateArmTimer);
  clearTimeout(m.data.reviewTimer);
  if (m.data.unsubAd) m.data.unsubAd();
}
