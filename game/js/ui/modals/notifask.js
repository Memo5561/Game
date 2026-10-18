// Reminder soft ask (§4.15): "Tomorrow: +{n} coins. Remind me?" – shown right after a
// daily-reward claim (see js/app/retention.js for when). The system permission dialog appears
// only after "Yes"; "Not now" (or Back) is recorded and the ask returns at most once more after
// NOTIF_ASK_RETRY_DAYS.
// props: { coins: number } tomorrow's login reward

import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t } from '../i18n.js';
import { btn } from '../components.js';

export const notifAskModal = {
  id: 'notifAsk',
  variant: 'sheet',

  build(p) {
    const n = Number(p.coins) || 0;
    return `<div class="modal__icon notif__icon">${icon('bell')}</div>
      <h2 class="modal__title" data-i18n="notifAsk.title">${esc(t('notifAsk.title'))}</h2>
      <p class="modal__text notif__text">${esc(t('notifAsk.text', { n }))}</p>
      <p class="modal__hint">${esc(t('notifAsk.hint'))}</p>
      <div class="modal__actions">
        ${btn({ action: 'notifAsk.yes', labelKey: 'notifAsk.yes', icon: 'bell', size: 'lg' })}
        ${btn({ action: 'notifAsk.no', labelKey: 'notifAsk.no', variant: 'ghost' })}
      </div>`;
  },

  actions: {
    yes(m, el, app) {
      answer(m, app, true);
    },
    no(m, el, app) {
      answer(m, app, false);
    },
  },

  back(m, app) {
    answer(m, app, false);
  },
};

function answer(m, app, yes) {
  if (m.data.answered) return;
  m.data.answered = true;
  m.close(yes);
  app.retention.answerNotif(yes);
}
