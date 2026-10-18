// Settings screen – PLACEHOLDER of part A (minimal, functional): sound, music, vibration,
// language and the app version. Part B replaces this file with the full settings (remove ads,
// restore purchases, privacy, legal notice, rate, share, notifications, reset progress).

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t, LANGS, LANG_NAMES } from '../i18n.js';
import { screenHeader, switchRow, setSwitch } from '../components.js';

let el = null;

export const settingsScreen = {
  id: 'settings',

  build(app) {
    el = fromHtml(`<section class="screen--settings">
      ${screenHeader('nav.settings')}
      <div class="screen-body">
        <div class="settings-group">
          ${switchRow({ action: 'settings.toggle.sound', on: app.save.settings.sound, labelKey: 'settings.sound', icon: 'sound' })}
          ${switchRow({ action: 'settings.toggle.music', on: app.save.settings.music, labelKey: 'settings.music', icon: 'music' })}
          ${switchRow({ action: 'settings.toggle.haptics', on: app.save.settings.haptics, labelKey: 'settings.haptics', icon: 'vibration' })}
          <label class="row row--select">${icon('globe', 'row__icon')}<span class="row__label" data-i18n="settings.language"></span>
            <select class="select" data-ref="lang"></select></label>
        </div>
        <p class="screen-note" data-ref="version"></p>
      </div>
    </section>`);
    app.action('settings.toggle.*', (btn, key) => {
      app.setSetting(key, !app.save.settings[key]);
      setSwitch(btn, app.save.settings[key]);
    });
    el.querySelector('[data-ref="lang"]').addEventListener('change', (e) => app.setLanguage(e.target.value));
    return el;
  },

  enter(params, app) {
    render(app);
  },

  refresh(reason, app) {
    render(app);
  },
};

function render(app) {
  const s = app.save.settings;
  for (const key of ['sound', 'music', 'haptics']) setSwitch(el.querySelector(`[data-action="settings.toggle.${key}"]`), s[key]);
  const select = el.querySelector('[data-ref="lang"]');
  select.innerHTML = [`<option value="auto">${esc(t('settings.langAuto'))}</option>`]
    .concat(LANGS.map((code) => `<option value="${code}">${esc(LANG_NAMES[code])}</option>`)).join('');
  select.value = s.lang;
  const info = Platform.info || {};
  el.querySelector('[data-ref="version"]').textContent = t('settings.version', { v: info.appVersion || CONFIG.VERSION });
}
