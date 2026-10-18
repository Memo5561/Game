// Generic confirmation sheet.
// props: { titleKey, bodyKey?, params?, okKey, okIcon?, okVariant?: 'primary'|'danger',
//          cancelKey?, onConfirm(), onCancel?() }

import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t } from '../i18n.js';
import { btn } from '../components.js';

export const confirmModal = {
  id: 'confirm',
  variant: 'sheet',

  build(p) {
    return `<div class="modal__icon modal__icon--warn">${icon(p.icon || 'info')}</div>
      <h2 class="modal__title" data-i18n="${p.titleKey}">${esc(t(p.titleKey, p.params))}</h2>
      ${p.bodyKey ? `<p class="modal__text">${esc(t(p.bodyKey, p.params))}</p>` : ''}
      <div class="modal__actions">
        ${btn({ action: 'confirm.ok', labelKey: p.okKey || 'common.ok', icon: p.okIcon, variant: p.okVariant || 'primary', size: 'lg' })}
        ${btn({ action: 'confirm.cancel', labelKey: p.cancelKey || 'common.cancel', variant: 'ghost' })}
      </div>`;
  },

  actions: {
    ok(m) {
      m.close(true);
      if (m.props.onConfirm) m.props.onConfirm();
    },
    cancel(m) {
      m.close(false);
      if (m.props.onCancel) m.props.onCancel();
    },
  },

  back(m) {
    confirmModal.actions.cancel(m);
  },
};
