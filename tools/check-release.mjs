// Pre-release sanity check. Run before building the production AAB:
//   node tools/check-release.mjs
// Fails (exit code 1) while placeholders are left that would make the app non-compliant
// (Impressum, support e-mail, ad unit ids) or inconsistent (package id, version).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../game/js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function readProps(file) {
  const props = {};
  if (!fs.existsSync(file)) return props;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/);
    // Like blockoProperty() in android/app/build.gradle.kts: a trailing " # ..." is not part of the value.
    if (m && !line.trim().startsWith('#')) props[m[1]] = m[2].replace(/(^|\s)#.*$/, '').trim();
  }
  return props;
}

const PLACEHOLDER = /example\.com|Vorname|Nachname|Musterstra|Musterstadt|12345|Hausnummer fehlt|XXXX/i;

// --- legal / contact -------------------------------------------------------
const legal = CONFIG.LEGAL;
if (!legal.OWNER_NAME || PLACEHOLDER.test(legal.OWNER_NAME)) errors.push('CONFIG.LEGAL.OWNER_NAME is a placeholder (Impressum!)');
if (!legal.ADDRESS_LINES.length || legal.ADDRESS_LINES.some((l) => PLACEHOLDER.test(l))) errors.push('CONFIG.LEGAL.ADDRESS_LINES contains placeholders (Impressum needs a ladungsfähige Anschrift)');
if (!legal.EMAIL || PLACEHOLDER.test(legal.EMAIL)) errors.push('CONFIG.LEGAL.EMAIL is a placeholder');
if (!legal.PHONE && !legal.CONTACT_FORM_URL) errors.push('CONFIG.LEGAL: set PHONE or CONTACT_FORM_URL – § 5 DDG requires a second fast contact channel besides e-mail');

// --- site pages -------------------------------------------------------------
for (const f of ['docs/site/privacy-policy.html', 'docs/site/impressum.html']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    errors.push(`${f} is missing`);
  } else if (PLACEHOLDER.test(fs.readFileSync(p, 'utf8'))) {
    errors.push(`${f} still contains placeholders – fill in your data before publishing it`);
  }
}
const appAds = path.join(ROOT, 'docs/site/app-ads.txt');
if (!fs.existsSync(appAds)) {
  errors.push('docs/site/app-ads.txt is missing');
} else if (/pub-X{4}/i.test(fs.readFileSync(appAds, 'utf8'))) {
  errors.push('docs/site/app-ads.txt still contains the placeholder publisher id (pub-XXXX…) – use your AdMob publisher id');
}
if (!/^https:\/\//.test(CONFIG.PRIVACY_POLICY_URL)) errors.push('CONFIG.PRIVACY_POLICY_URL must be an https URL');

// --- android ----------------------------------------------------------------
const gradleProps = readProps(path.join(ROOT, 'android/gradle.properties'));
const mode = (gradleProps.BLOCKO_ADS_MODE || 'test').toLowerCase();
const adKeys = ['BLOCKO_ADMOB_APP_ID', 'BLOCKO_ADMOB_BANNER_ID', 'BLOCKO_ADMOB_INTERSTITIAL_ID', 'BLOCKO_ADMOB_REWARDED_ID'];
if (mode !== 'live') {
  errors.push('android/gradle.properties: BLOCKO_ADS_MODE is not "live" – the production build would only show test ads (no revenue). Use "test" only for closed testing.');
}
for (const k of adKeys) {
  const v = gradleProps[k] || '';
  if (mode === 'live' && (!v || v.includes('3940256099942544') || /X{4}/.test(v))) {
    errors.push(`android/gradle.properties: ${k} is empty or a test/placeholder id`);
  }
}
if (gradleProps.BLOCKO_VERSION_NAME && gradleProps.BLOCKO_VERSION_NAME !== CONFIG.VERSION) {
  warnings.push(`Version mismatch: CONFIG.VERSION=${CONFIG.VERSION} vs BLOCKO_VERSION_NAME=${gradleProps.BLOCKO_VERSION_NAME}`);
}
const appGradle = path.join(ROOT, 'android/app/build.gradle.kts');
if (fs.existsSync(appGradle)) {
  const src = fs.readFileSync(appGradle, 'utf8');
  const m = src.match(/applicationId\s*=\s*"([^"]+)"/);
  if (m && m[1] !== CONFIG.PACKAGE_ID) errors.push(`applicationId (${m[1]}) differs from CONFIG.PACKAGE_ID (${CONFIG.PACKAGE_ID})`);
}
if (!CONFIG.PLAY_STORE_URL.includes(CONFIG.PACKAGE_ID) || !CONFIG.PLAY_STORE_MARKET_URL.includes(CONFIG.PACKAGE_ID)) {
  errors.push('CONFIG.PLAY_STORE_URL / PLAY_STORE_MARKET_URL do not contain CONFIG.PACKAGE_ID');
}
if (!fs.existsSync(path.join(ROOT, 'android/keystore.properties'))) {
  warnings.push('android/keystore.properties not found – fine if you sign via Android Studio "Generate Signed Bundle"');
}

// --- report -----------------------------------------------------------------
for (const w of warnings) console.log(`⚠  ${w}`);
for (const e of errors) console.log(`✘  ${e}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s) – not ready for a production release.`);
  process.exit(1);
}
console.log('✔ Release check passed.');
