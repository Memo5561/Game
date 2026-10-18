// Legal notice (Impressum, § 5 DDG) – PLACEHOLDER of part A (minimal, functional): renders
// CONFIG.LEGAL offline plus a link to the privacy policy. Part B may restyle it.

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { fromHtml, esc } from '../dom.js';
import { t } from '../i18n.js';
import { screenHeader, btn } from '../components.js';

let body = null;

export const legalScreen = {
  id: 'legal',

  build(app) {
    const el = fromHtml(`<section class="screen--legal">
      ${screenHeader('legal.title')}
      <div class="screen-body"><div class="panel legal" data-ref="body"></div></div>
    </section>`);
    body = el.querySelector('[data-ref="body"]');
    app.action('legal.privacy', () => Platform.openUrl(CONFIG.PRIVACY_POLICY_URL));
    return el;
  },

  enter() {
    render();
  },

  refresh() {
    render();
  },
};

function render() {
  const L = CONFIG.LEGAL;
  const line = (labelKey, value) => (value ? `<p><span class="legal__label">${esc(t(labelKey))}</span><br>${esc(value)}</p>` : '');
  body.innerHTML = `<p class="legal__owner">${esc(L.OWNER_NAME)}<br>${L.ADDRESS_LINES.map(esc).join('<br>')}</p>
    ${line('legal.email', L.EMAIL)}${line('legal.phone', L.PHONE)}${line('legal.vat', L.VAT_ID)}
    ${btn({ action: 'legal.privacy', labelKey: 'settings.privacyPolicy', icon: 'shield', variant: 'secondary', size: 'sm' })}`;
}
