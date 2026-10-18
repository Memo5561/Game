// Language picker (Settings): "Automatic" (device language) + the 8 supported languages, each
// named in its own language. Picking one applies it immediately (DOM + canvas) and closes.

import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t, LANGS, LANG_NAMES, resolveLang } from '../i18n.js';

export const langPickerModal = {
  id: 'langPicker',
  variant: 'sheet',

  build(p, m, app) {
    const current = app.save.settings.lang || 'auto';
    const device = LANG_NAMES[resolveLang('auto', app.deviceLocale())];
    const option = (code, label, sub = '') => `<button type="button" class="row row--radio" role="radio" aria-checked="${code === current}" data-action="langPicker.pick.${code}" lang="${code === 'auto' ? '' : code}">
        <span class="row__label">${esc(label)}${sub ? ` <span class="row__sub">${esc(sub)}</span>` : ''}</span>${icon('check', 'row__check')}</button>`;
    return `<div class="modal__icon">${icon('globe')}</div>
      <h2 class="modal__title" data-i18n="settings.language">${esc(t('settings.language'))}</h2>
      <div class="settings-group lang-list" role="radiogroup">
        ${option('auto', t('settings.langAuto'), `(${device})`)}
        ${LANGS.map((code) => option(code, LANG_NAMES[code])).join('')}
      </div>`;
  },

  actions: {
    pick(m, el, app, name) {
      const code = name.split('.')[1];
      m.close(true);
      if (code && code !== app.save.settings.lang) app.setLanguage(code);
    },
  },
};
