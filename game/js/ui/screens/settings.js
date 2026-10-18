// Settings (§4.15): sound, music, vibration, language (picker sheet: Automatic + 8 languages in
// their own names); daily reminder (switch; system permission asked only when switching on;
// 'denied' → "Open settings"; hidden where notifications are unsupported); remove ads (→ shop) and
// restore purchases; privacy settings (only while Platform.isPrivacyOptionsRequired(), checked
// every time the screen opens), privacy policy, legal notice (offline screen), rate (Play Store
// page – never the in-app review card), share; reset progress (confirm; purchases are kept);
// version + debug info line.

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { icon } from '../icons.js';
import { fromHtml, esc, setText } from '../dom.js';
import { t, LANG_NAMES, resolveLang } from '../i18n.js';
import { screenHeader, switchRow, setSwitch, navRow } from '../components.js';

let el = null;
/** "Open settings" was tapped for notifications: turn the reminder on once permission is granted. */
let notifSettingsOpened = false;

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
          <button type="button" class="row row--nav" data-action="settings.lang">
            ${icon('globe', 'row__icon')}<span class="row__label"><span data-i18n="settings.language"></span><span class="row__sub" data-ref="langSub"></span></span>
            <span class="row__value" data-ref="langValue"></span>${icon('next', 'row__chev')}</button>
        </div>
        <div class="settings-group" data-ref="notifGroup">
          <button type="button" class="row row--switch" role="switch" aria-checked="false" data-action="settings.notif" data-ref="notif">
            ${icon('bell', 'row__icon')}<span class="row__label"><span data-i18n="settings.notifications"></span><span class="row__sub" data-ref="notifSub"></span></span>
            <span class="switch" aria-hidden="true"><span class="switch__knob"></span></span></button>
          <button type="button" class="row row--nav" data-action="settings.notifOpen" data-ref="notifOpen" hidden>
            ${icon('bell', 'row__icon')}<span class="row__label"><span data-i18n="settings.notifications"></span><span class="row__sub" data-i18n="settings.notifDenied"></span></span>
            ${icon('external', 'row__chev')}</button>
        </div>
        <h2 class="settings-title" data-i18n="settings.purchases"></h2>
        <div class="settings-group">
          <div data-ref="removeAdsSlot"></div>
          ${navRow({ action: 'settings.restore', icon: 'retry', labelKey: 'settings.restore' })}
        </div>
        <h2 class="settings-title" data-i18n="settings.about"></h2>
        <div class="settings-group">
          ${navRow({ action: 'settings.rate', icon: 'star2', labelKey: 'settings.rate', external: true })}
          ${navRow({ action: 'settings.share', icon: 'share', labelKey: 'settings.share' })}
          <div data-ref="privacySlot"></div>
          ${navRow({ action: 'settings.privacyPolicy', icon: 'shield', labelKey: 'settings.privacyPolicy', external: true })}
          ${navRow({ action: 'settings.legal', icon: 'doc', labelKey: 'settings.legal' })}
        </div>
        <div class="settings-group settings-group--danger">
          ${navRow({ action: 'settings.reset', icon: 'trash', labelKey: 'settings.reset', cls: 'row--danger' })}
        </div>
        <p class="settings-version" data-ref="version"></p>
        <p class="settings-debug" data-ref="debug"></p>
      </div>
    </section>`);

    app.action('settings.toggle.*', (b, key) => {
      app.setSetting(key, !app.save.settings[key]);
      setSwitch(b, app.save.settings[key]);
    });
    app.action('settings.lang', () => app.modals.open('langPicker'));
    app.action('settings.notif', async (b) => {
      if (b.disabled) return;
      if (app.save.flags.notifOptIn && app.notifPermission === 'granted') {
        app.retention.disableReminders();
      } else {
        b.disabled = true;
        await app.retention.enableReminders();
        b.disabled = false;
      }
      render(app);
    });
    app.action('settings.notifOpen', () => {
      notifSettingsOpened = true;
      Platform.openNotificationSettings();
    });
    app.action('settings.removeAds', () => app.go('shop', { tab: 'coins', highlight: 'remove_ads' }));
    app.action('settings.restore', async (b) => {
      if (b.disabled) return;
      b.disabled = true;
      await app.restorePurchases();
      b.disabled = false;
      render(app);
    });
    app.action('settings.privacy', () => Platform.showPrivacyOptions());
    app.action('settings.privacyPolicy', () => Platform.openUrl(CONFIG.PRIVACY_POLICY_URL));
    app.action('settings.legal', () => app.go('legal'));
    app.action('settings.rate', () => Platform.openUrl(CONFIG.PLAY_STORE_MARKET_URL));
    app.action('settings.share', () => Platform.share(t('settings.shareText', { n: app.progression.bestScore, url: CONFIG.PLAY_STORE_URL })));
    // consent / privacy-options state can change after the UMP form ran
    app.on('adState', () => {
      if (app.router.current === 'settings') render(app);
    });
    app.action('settings.reset', () => app.modals.open('confirm', {
      titleKey: 'settings.resetTitle',
      bodyKey: 'settings.resetConfirm',
      okKey: 'settings.resetOk',
      okIcon: 'trash',
      okVariant: 'danger',
      icon: 'trash',
      onConfirm: () => app.resetProgress(),
    }));
    return el;
  },

  enter(params, app) {
    el.querySelector('.screen-body').scrollTop = 0;
    app.notifPermission = Platform.getNotificationPermission();
    render(app);
  },

  refresh(reason, app) {
    if (app.router.current === 'settings') app.notifPermission = Platform.getNotificationPermission();
    render(app);
  },
};

function render(app) {
  const s = app.save.settings;
  for (const key of ['sound', 'music', 'haptics']) setSwitch(el.querySelector(`[data-action="settings.toggle.${key}"]`), s[key]);

  // language: the active language in its own name (+ "Automatic" below the label)
  const code = resolveLang(s.lang, app.deviceLocale());
  setText(el.querySelector('[data-ref="langValue"]'), LANG_NAMES[code]);
  const langSub = el.querySelector('[data-ref="langSub"]');
  langSub.hidden = s.lang !== 'auto';
  setText(langSub, t('settings.langAuto'));

  // notifications
  const perm = app.notifPermission;
  if (notifSettingsOpened && perm === 'granted' && !app.save.flags.notifOptIn) {
    notifSettingsOpened = false;
    app.retention.enableReminders();
  }
  const on = app.save.flags.notifOptIn && perm === 'granted';
  el.querySelector('[data-ref="notifGroup"]').hidden = perm === 'unsupported';
  const sw = el.querySelector('[data-ref="notif"]');
  sw.hidden = perm === 'denied';
  el.querySelector('[data-ref="notifOpen"]').hidden = perm !== 'denied';
  setSwitch(sw, on);
  setText(el.querySelector('[data-ref="notifSub"]'), t(on ? 'settings.notifOn' : 'settings.notifOff'));

  // purchases
  const owned = app.save.iap.adsRemoved;
  el.querySelector('[data-ref="removeAdsSlot"]').innerHTML = owned
    ? `<div class="row row--static">${icon('noads', 'row__icon')}<span class="row__label">${esc(t('settings.removeAds'))}</span>
        <span class="row__value row__value--good">${icon('check')}${esc(t('shop.adFree'))}</span></div>`
    : navRow({ action: 'settings.removeAds', icon: 'noads', labelKey: 'settings.removeAds' });

  // privacy options (UMP) – re-checked every time
  el.querySelector('[data-ref="privacySlot"]').innerHTML = Platform.isPrivacyOptionsRequired()
    ? navRow({ action: 'settings.privacy', icon: 'shield', labelKey: 'settings.privacy' })
    : '';

  const info = Platform.info || {};
  setText(el.querySelector('[data-ref="version"]'), t('settings.version', { v: CONFIG.VERSION }));
  const parts = [`${CONFIG.APP_NAME} ${CONFIG.VERSION}`, `${info.platform || 'web'} ${info.appVersion || '–'}${info.versionCode ? ` (${info.versionCode})` : ''}`];
  if (info.sdkInt) parts.push(`SDK ${info.sdkInt}`);
  if (info.webViewVersion) parts.push(`WebView ${String(info.webViewVersion).split('.')[0]}`);
  setText(el.querySelector('[data-ref="debug"]'), parts.join(' · '));
}
