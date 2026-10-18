// Legal notice (Impressum, § 5 DDG) – fully offline: CONFIG.LEGAL (name, address, email as a
// mailto link, phone and/or contact form link – § 5 DDG wants a second fast channel – and the
// VAT id when set), links to the online legal notice and the privacy
// policy, open-source licenses (Nunito – SIL OFL 1.1; all sounds are synthesized in the app) and
// the "contains ads / in-app purchases" note. Text is selectable.

import { CONFIG } from '../../config.js';
import { Platform } from '../../platform/bridge.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t } from '../i18n.js';
import { screenHeader } from '../components.js';

let body = null;

export const legalScreen = {
  id: 'legal',

  build(app) {
    const el = fromHtml(`<section class="screen--legal">
      ${screenHeader('legal.title')}
      <div class="screen-body"><div class="legal" data-ref="body"></div></div>
    </section>`);
    body = el.querySelector('[data-ref="body"]');
    app.action('legal.email', () => Platform.openUrl(`mailto:${CONFIG.LEGAL.EMAIL}`));
    app.action('legal.form', () => Platform.openUrl(CONFIG.LEGAL.CONTACT_FORM_URL));
    app.action('legal.online', () => Platform.openUrl(CONFIG.IMPRINT_URL));
    app.action('legal.privacy', () => Platform.openUrl(CONFIG.PRIVACY_POLICY_URL));
    return el;
  },

  enter() {
    body.parentElement.scrollTop = 0;
    render();
  },

  refresh() {
    render();
  },
};

function render() {
  const L = CONFIG.LEGAL;
  const contact = [];
  if (L.EMAIL) {
    contact.push(`<button type="button" class="legal__link" data-action="legal.email">${icon('mail')}<span>${esc(L.EMAIL)}</span></button>`);
  }
  if (L.PHONE) contact.push(`<p class="legal__line"><span class="legal__label">${esc(t('legal.phone'))}</span> ${esc(L.PHONE)}</p>`);
  if (L.CONTACT_FORM_URL) {
    contact.push(`<button type="button" class="legal__link" data-action="legal.form">${icon('external')}<span>${esc(t('legal.contactForm'))}</span></button>`);
  }
  body.innerHTML = `
    <section class="panel legal__card">
      <h2 class="legal__heading">${esc(t('legal.heading'))}</h2>
      <p class="legal__owner">${esc(L.OWNER_NAME)}<br>${L.ADDRESS_LINES.map(esc).join('<br>')}</p>
      <h3 class="legal__sub">${esc(t('legal.contact'))}</h3>
      ${contact.join('')}
      ${L.VAT_ID ? `<h3 class="legal__sub">${esc(t('legal.vat'))}</h3><p class="legal__line">${esc(L.VAT_ID)}</p>` : ''}
      <div class="legal__buttons">
        <button type="button" class="legal__link" data-action="legal.online">${icon('external')}<span>${esc(t('legal.online'))}</span></button>
        <button type="button" class="legal__link" data-action="legal.privacy">${icon('shield')}<span>${esc(t('settings.privacyPolicy'))}</span></button>
      </div>
    </section>
    <section class="panel legal__card">
      <h2 class="legal__heading">${esc(t('legal.licenses'))}</h2>
      <p class="legal__line"><strong>Nunito</strong> – ${esc(t('legal.font'))}</p>
      <p class="legal__line legal__dim">SIL Open Font License 1.1 · Copyright 2014 The Nunito Project Authors</p>
      <p class="legal__line">${esc(t('legal.sounds'))}</p>
    </section>
    <section class="panel legal__card">
      <h2 class="legal__heading">${esc(t('legal.about'))}</h2>
      <p class="legal__line">${esc(CONFIG.APP_NAME)} ${esc(CONFIG.VERSION)}</p>
      <p class="legal__line legal__chips"><span class="chip">${icon('ad')}${esc(t('legal.ads'))}</span><span class="chip">${icon('shop')}${esc(t('legal.iap'))}</span></p>
    </section>`;
}
