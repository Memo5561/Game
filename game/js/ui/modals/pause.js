// Pause sheet: resume, restart (confirm → the run is abandoned), home (the run stays saved),
// sound and music toggles. Never closes by itself (no auto-unpause).

import { icon } from '../icons.js';
import { esc } from '../dom.js';
import { t } from '../i18n.js';
import { btn } from '../components.js';

export const pauseModal = {
  id: 'pause',
  variant: 'sheet',

  build(p, m, app) {
    return `<h2 class="modal__title" data-i18n="pause.title">${esc(t('pause.title'))}</h2>
      <div class="modal__actions">
        ${btn({ action: 'pause.resume', labelKey: 'pause.resume', icon: 'play', size: 'lg' })}
        ${btn({ action: 'pause.restart', labelKey: 'pause.restart', icon: 'retry', variant: 'secondary' })}
        ${btn({ action: 'pause.home', labelKey: 'pause.home', icon: 'home', variant: 'secondary' })}
      </div>
      <div class="toggles">${toggle('sound', app)}${toggle('music', app)}</div>`;
  },

  actions: {
    resume(m) {
      m.close();
    },
    restart(m, el, app) {
      app.modals.open('confirm', {
        titleKey: 'confirm.restart.title',
        bodyKey: 'confirm.restart.body',
        okKey: 'pause.restart',
        okIcon: 'retry',
        icon: 'retry',
        onConfirm: () => app.game.restart(),
      });
    },
    home(m, el, app) {
      m.close();
      app.game.goHome();
    },
    sound(m, el, app) {
      app.setSetting('sound', !app.save.settings.sound);
      refreshToggles(m, app);
    },
    music(m, el, app) {
      app.setSetting('music', !app.save.settings.music);
      refreshToggles(m, app);
    },
  },

  back(m) {
    m.close();
  },

  refresh(m, app) {
    refreshToggles(m, app);
  },
};

function toggle(key, app) {
  const on = app.save.settings[key];
  return `<button type="button" class="toggle" data-action="pause.${key}" aria-pressed="${on}">
      <span class="toggle__icon">${icon(key)}${icon(`${key}-off`)}</span><span class="toggle__label" data-i18n="settings.${key}">${esc(t(`settings.${key}`))}</span></button>`;
}

function refreshToggles(m, app) {
  for (const key of ['sound', 'music']) {
    const el = m.$(`[data-action="pause.${key}"]`);
    if (el) el.setAttribute('aria-pressed', String(app.save.settings[key]));
  }
}
