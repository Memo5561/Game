// Player level-up celebration (popup 'levelUp', queued by GameController.finalizeRun and shown on
// the next arrival at home – never during a run, never stacked). Shows the new level in a star
// burst, the level-up coins (already credited by Progression.addXP – they fly into the pill as a
// celebration) and, when a level theme was unlocked, its preview with "Use now".
// props: { levels: number[], coins: number, themes: string[] }

import { Sfx } from '../../audio/sfx.js';
import { getTheme, renderThemePreview } from '../../render/theme.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn, coinPill } from '../components.js';
import { countUp, wait } from '../anim.js';

export const levelUpModal = {
  id: 'levelUp',
  variant: 'sheet',

  build(p, m, app) {
    const levels = Array.isArray(p.levels) && p.levels.length ? p.levels : [app.progression.levelInfo().level];
    const level = Math.max(...levels);
    const coins = Number(p.coins) || 0;
    const theme = (p.themes || []).find((id) => app.progression.ownsTheme(id)) || null;
    m.data.theme = theme;
    m.data.coins = coins;
    return `<div class="lvlup">
        <div class="lvlup__pill">${coinPill(null)}</div>
        <div class="lvlup__burst" aria-hidden="true"><span class="lvlup__rays"></span>
          <span class="lvlup__star">${icon('star')}<span class="lvlup__num">${level}</span></span></div>
        <h2 class="modal__title" data-i18n="levelUp.title">${esc(t('levelUp.title'))}</h2>
        <p class="modal__text">${esc(t('levelUp.reached', { n: level }))}</p>
        ${coins > 0 ? `<div class="lvlup__reward" data-ref="coinsBox">${icon('coin')}<span>+${esc(formatNumber(coins))}</span></div>` : ''}
        ${theme ? `<div class="lvlup__theme">
            <canvas class="theme-canvas lvlup__canvas" data-ref="preview"></canvas>
            <span class="lvlup__theme-text"><span class="lvlup__new">${esc(t('levelUp.newTheme'))}</span>
              <span class="lvlup__name">${esc(t(`theme.${theme}`))}</span></span>
          </div>` : ''}
        <div class="modal__actions">
          ${theme && app.themeId !== theme ? btn({ action: 'levelUp.use', labelKey: 'levelUp.useNow', icon: 'palette', size: 'lg' }) : ''}
          ${btn({ action: 'levelUp.close', labelKey: 'common.continue', variant: theme && app.themeId !== theme ? 'ghost' : 'primary', size: theme && app.themeId !== theme ? 'md' : 'lg' })}
        </div>
      </div>`;
  },

  async onOpen(m, app) {
    Sfx.play('unlock');
    app.haptic('success');
    const canvas = m.$('[data-ref="preview"]');
    if (canvas) renderThemePreview(canvas, getTheme(m.data.theme));
    const pill = m.$('[data-coins]');
    const coins = m.data.coins;
    if (pill) countUp(pill, Math.max(0, app.save.coins - coins), { ms: 0, format: formatNumber });
    if (!(coins > 0)) {
      app.refreshCoins({ instant: true });
      return;
    }
    await wait(450);
    if (m.isClosed) return;
    app.flyCoins(m.$('[data-ref="coinsBox"]'), coins);
  },

  actions: {
    use(m, el, app) {
      const id = m.data.theme;
      if (id && app.progression.selectTheme(id)) {
        app.applyTheme(id);
        app.toast(t('shop.theme.applied', { name: t(`theme.${id}`) }), { icon: 'palette', tone: 'good' });
      }
      m.close(true);
    },
    close(m) {
      m.close(false);
    },
  },
};
