// Info sheet for a purchase that Google Play reports as pending (e.g. cash payment / slow card
// check). Nothing is granted yet; native delivers it in the background once it completes.
// props: { productId?: string }

import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t } from '../i18n.js';
import { btn } from '../components.js';

export const purchasePendingModal = {
  id: 'purchasePending',
  variant: 'sheet',

  build() {
    return `<div class="modal__icon">${icon('clock')}</div>
      <h2 class="modal__title" data-i18n="pending.title">${esc(t('pending.title'))}</h2>
      <p class="modal__text">${esc(t('pending.body'))}</p>
      <div class="modal__actions">${btn({ action: 'purchasePending.ok', labelKey: 'common.ok', size: 'lg' })}</div>`;
  },

  actions: {
    ok(m) {
      m.close();
    },
  },
};
