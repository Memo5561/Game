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

/** Coins row: "+N" and, once, "Watch ad: ×2" (only with a rewarded video ready). */
export function coinsRow(sum, app, modalId) {
  if (!(sum.coinsEarned > 0)) return '';
  const ad = !sum.doubled && app.isRewardedAvailable();
  return `<div class="result__row result__coins">
      <span class="result__coin-amount" data-ref="coinsBox">${icon('coin')}<span>+</span><span data-ref="coins" data-value="0">0</span></span>
      ${ad ? btn({ action: `${modalId}.double`, labelKey: 'result.double', icon: 'ad', variant: 'ad', size: 'sm', cls: 'is-arming', attrs: ARMING }) : ''}
    </div>`;
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

/** One line of progress toward the nearest daily mission (empty while missions are locked). */
export function missionLine(app) {
  const list = app.progression.missions().filter((m) => !m.claimed);
  if (!list.length) return '';
  const done = list.find((m) => m.progress >= m.target);
  if (done) {
    return `<div class="result__line result__mission is-done">${icon('check')}<span>${esc(t('result.missionDone', { text: t(done.textKey, { n: done.target }) }))}</span></div>`;
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

export function cleanupResult(m) {
  clearTimeout(m.data.armTimer);
  clearTimeout(m.data.reviewTimer);
}
