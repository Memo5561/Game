// Booster offer (user-opened when a booster count is 0): buy one for coins or watch a video for a
// free one. Closes with `true` when the player got a booster (the controller then uses it).
// props: { type: 'hammer'|'shuffle' }

import { CONFIG } from '../../config.js';
import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, formatNumber } from '../i18n.js';
import { btn } from '../components.js';
import { shake } from '../anim.js';

export const boosterModal = {
  id: 'booster',
  variant: 'sheet',

  build(p, m, app) {
    const type = p.type;
    const price = CONFIG.ECONOMY.BOOSTER_PRICES[type];
    const name = t(`booster.${type}`);
    return `<div class="modal__icon modal__icon--booster">${icon(type)}</div>
      <h2 class="modal__title">${esc(name)}</h2>
      <p class="modal__text">${esc(t(`booster.${type}.desc`))}</p>
      <div class="modal__actions">
        ${btn({ action: 'booster.buy', label: formatNumber(price), icon: 'coin', size: 'lg', cls: app.progression.coins < price ? 'is-short' : '' })}
        ${app.isRewardedAvailable() ? btn({ action: 'booster.watch', label: t('booster.watch', { name }), icon: 'ad', variant: 'ad' }) : ''}
        ${btn({ action: 'booster.close', labelKey: 'common.notNow', variant: 'ghost' })}
      </div>`;
  },

  actions: {
    buy(m, el, app) {
      const type = m.props.type;
      if (!app.progression.buyBooster(type)) {
        shake(el);
        app.toast(t('toast.notEnoughCoins'), { icon: 'coin' });
        return;
      }
      app.refreshCoins();
      m.close(true);
    },
    async watch(m, el, app) {
      if (m.data.busy) return;
      m.data.busy = true;
      el.disabled = true;
      const ok = await app.showRewarded('booster');
      m.data.busy = false;
      if (m.isClosed) return;
      if (ok) {
        app.progression.addBooster(m.props.type, 1);
        m.close(true);
      } else {
        el.disabled = false;
      }
    },
    close(m) {
      m.close(false);
    },
  },

  back(m) {
    if (!m.data.busy) m.close(false);
  },
};
