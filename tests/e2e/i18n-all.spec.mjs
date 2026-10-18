// E2E i18n for all 8 languages.
// - String tables: every table has exactly the keys of en.js, the same {placeholders} per key (over all
//   plural forms), and plural objects carry every category Intl.PluralRules(lang) picks for counts
//   (ru: one/few/many/other); a table may use a plural object where en.js has a plain "{n}" string.
// - Content rules per language (checkContent): nothing left in English, typography (fr: no-break space
//   before ! ? ; :, es: ¡ ¿ pairs, ru: «» and no Latin text, tr: capital İ), real plural forms (ru: 1 / 2–4 /
//   5–20 / 21 …), the legal-notice label of every language and no imperative "buy" wording (EU UWG
//   Annex No. 28: nothing in the UI urges players to purchase).
// - 'auto' follows the device language for every language (regional variants like es-MX, pt-PT too);
//   the tutorial opens in it.
// - On the smallest phone (320×518) the main screens, sheets and run modals have no missing or
//   untranslated key, no text overflow (layoutProblems: in-word wrapping disabled) and no word that
//   wraps inside itself (measured per word with Range rects – catches sub-pixel overflows that the
//   integer scrollWidth check rounds away); canvas texts render with the bundled Nunito (no glyph
//   falls back to another font).
// Run: node tests/e2e/run.mjs i18n
import { LANGS, resolveLang, setLang, t, formatNumber, upper } from '../../game/js/ui/i18n.js';
import { openGame, veteranSave, todayKey, VIEWPORTS, assert, ev, idle, waitModal, tap, playMoves, layoutProblems, brokenWords, shot, assertNoErrors } from './ui.helpers.mjs';

const LOCALES = { en: 'en-GB', de: 'de-AT', es: 'es-MX', fr: 'fr-CA', it: 'it-IT', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };

/**
 * Keys that exist in en.js and de.js but are still to be translated into es / fr / it / pt / tr /
 * ru (they fall back to English meanwhile). Empty when the tables are in sync; the UI engineer
 * adds keys to en.js + de.js first, so list them here until the translator has caught up.
 */
const PENDING_TRANSLATION = new Set([]);

/** Legal-notice label (settings row + screen title) per language. */
const LEGAL_LABEL = {
  en: 'Legal notice', de: 'Impressum', es: 'Aviso legal', fr: 'Mentions légales', it: 'Note legali',
  pt: 'Aviso legal', tr: 'Yasal bildirim', ru: 'Правовая информация',
};

/** Strings that are legitimately identical to English (shared loanwords, symbols, names): `lang:key` or `key`. */
const SAME_AS_EN_OK = new Set([
  'combo', 'result.xp', 'shop.booster.got', 'notify.title', 'theme.neon', 'theme.pixel', 'theme.gold', 'common.ok', 'common.home',
  'booster.hammer', 'theme.candy', 'settings.haptics', 'settings.version', 'home.level', 'home.journeyLevel', 'hud.level',
  'hud.pause', 'pause.home', 'shop.theme.level', 'nav.shop', 'shop.title',
  'fr:nav.missions', 'fr:result.score', 'fr:legal.contact', 'fr:common.best',
]);

/** Latin words allowed inside Russian strings (names, abbreviations, the "x" of "Комбо x5"). */
const RU_LATIN_OK = /Blocko|Google Play|Google|XP|DDG|Wi-Fi|The Nunito Project Authors|\bx(?=\{n\})/g;

/**
 * Imperative / infinitive "buy" wording per language. Purchases are named as nouns or states
 * ("Remove ads", "Active"), never as a call to buy. Notices about a purchase (toasts, pending) are exempt.
 */
const BUY_CTA = {
  en: /\bbuy\b/i, de: /\bkauf(e|en)?\b/i, es: /\b(compra ya|comprar|compra ahora)\b/i, fr: /\b(achète|acheter|achetez)\b/i,
  it: /\b(acquista|acquistare|comprare|compra ora)\b/i, pt: /\b(compre|comprar|compra agora)\b/i,
  tr: /satın al(?![\p{L}])/iu, ru: /(?<![\p{L}])купи(ть|те)?(?![\p{L}])/iu,
};

function placeholders(value) {
  const forms = typeof value === 'string' ? [value] : Object.values(value);
  return new Set(forms.flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Plural categories Intl.PluralRules picks for whole counts 0…1000. */
function countCategories(lang) {
  const rules = new Intl.PluralRules(lang);
  const cats = new Set();
  for (let n = 0; n <= 1000; n++) cats.add(rules.select(n));
  return cats;
}

export async function checkTables() {
  const en = (await import('../../game/js/ui/strings/en.js')).default;
  const problems = [];
  for (const lang of LANGS) {
    const table = (await import(`../../game/js/ui/strings/${lang}.js`)).default;
    const cats = countCategories(lang);
    for (const key of Object.keys(en)) {
      if (!(key in table) && !(PENDING_TRANSLATION.has(key) && lang !== 'de')) problems.push(`${lang}: missing key ${key}`);
    }
    for (const key of Object.keys(table)) if (!(key in en)) problems.push(`${lang}: key not in en.js: ${key}`);
    for (const [key, value] of Object.entries(table)) {
      if (!(key in en)) continue;
      const ref = en[key];
      if (typeof value !== 'string' && (typeof value !== 'object' || value === null)) {
        problems.push(`${lang}: ${key} is neither a string nor a plural object`);
        continue;
      }
      const forms = typeof value === 'string' ? [value] : Object.values(value);
      if (forms.some((s) => typeof s !== 'string' || !s.trim())) problems.push(`${lang}: ${key} has an empty form`);
      const want = placeholders(ref);
      const got = placeholders(value);
      if (!sameSet(want, got)) problems.push(`${lang}: ${key} placeholders {${[...got]}} ≠ en {${[...want]}}`);
      for (const s of forms) {
        const extra = [...placeholders(String(s))].filter((p) => !want.has(p));
        if (extra.length) problems.push(`${lang}: ${key} form "${s}" has unknown {${extra}}`);
      }
      if (typeof value === 'object') {
        if (typeof ref === 'string' && !/\{n\}/.test(ref)) problems.push(`${lang}: ${key} is plural but en.js has no {n}`);
        for (const c of ['other', ...cats]) if (typeof value[c] !== 'string') problems.push(`${lang}: ${key} lacks plural form "${c}"`);
      }
    }
  }
  assert(problems.length === 0, `string tables:\n  ${problems.join('\n  ')}`);
  // every supported language is reachable from the device language, regional variants included
  for (const lang of LANGS) assert(resolveLang('auto', LOCALES[lang]) === lang, `auto: ${LOCALES[lang]} → ${resolveLang('auto', LOCALES[lang])}`);
  assert(resolveLang('auto', 'pt-PT') === 'pt' && resolveLang('auto', 'es-419') === 'es', 'auto: pt-PT / es-419');
}

const forms = (value) => (typeof value === 'string' ? [value] : Object.values(value));

/** Content and typography rules over the string tables (pure Node, no browser). */
export async function checkContent() {
  const en = (await import('../../game/js/ui/strings/en.js')).default;
  const problems = [];
  const letters = (s) => s.replace(/\{\w+\}/g, '').replace(/[^\p{L}]/gu, '');
  for (const lang of LANGS) {
    const table = (await import(`../../game/js/ui/strings/${lang}.js`)).default;
    for (const [key, value] of Object.entries(table)) {
      if (!(key in en)) continue;
      for (const f of forms(value)) {
        const where = `${lang}: ${key} "${f}"`;
        if (/[\u0000-\u0008\u000B-\u001F]/.test(f) || f.includes('\uFFFD')) problems.push(`${where} has a control / replacement character`);
        if (f.includes("'") || f.includes('"')) problems.push(`${where} uses a straight quote (use ’ … “ ” « »)`);
        if (/ - /.test(f) || /--/.test(f)) problems.push(`${where} uses a hyphen as a dash`);
        if (/\.\.\./.test(f)) problems.push(`${where} uses three dots instead of …`);
        if (/ {2,}|^\s|\s$/.test(f)) problems.push(`${where} has stray spaces`);
        if (lang !== 'en' && lang !== 'de' && typeof en[key] === 'string' && f === en[key] && letters(f).length > 3
          && !SAME_AS_EN_OK.has(key) && !SAME_AS_EN_OK.has(`${lang}:${key}`)) problems.push(`${where} is still English`);
        if (lang === 'fr') {
          // French: narrow no-break space before ! ? ; and no-break space before :
          for (const m of f.matchAll(/(.)([!?;:])/g)) {
            if (/\{\w*$/.test(f.slice(0, m.index + 1))) continue;
            if (m[1] !== '\u202F' && m[1] !== '\u00A0') problems.push(`${where} lacks a no-break space before "${m[2]}"`);
            else if (m[2] === ':' && m[1] === '\u202F') problems.push(`${where}: use U+00A0 before ":"`);
            else if (m[2] !== ':' && m[1] === '\u00A0') problems.push(`${where}: use U+202F before "${m[2]}"`);
          }
        }
        if (lang === 'es') {
          if ((f.match(/!/g) || []).length !== (f.match(/¡/g) || []).length) problems.push(`${where} has unbalanced ¡ !`);
          if ((f.match(/\?/g) || []).length !== (f.match(/¿/g) || []).length) problems.push(`${where} has unbalanced ¿ ?`);
        } else if (/[¡¿]/.test(f)) problems.push(`${where} uses Spanish inverted marks`);
        if (lang === 'ru') {
          const latin = f.replace(RU_LATIN_OK, '').replace(/\{\w+\}/g, '').match(/[A-Za-z]+/g);
          if (latin) problems.push(`${where} has Latin text: ${latin.join(', ')}`);
        }
        if (lang === 'tr' && /(^|[\s(])I[a-zçğıöşü]/.test(f)) problems.push(`${where}: a capital "I" starts a word – Turkish needs "İ" (dotted) unless the word is dotless (Işık …)`);
        if (lang !== 'tr' && /[İıĞğŞş]/.test(f)) problems.push(`${where} contains Turkish letters`);
        if (lang !== 'ru' && /[\u0400-\u04FF]/.test(f)) problems.push(`${where} contains Cyrillic`);
        if (!/^(toast|pending|settings\.purchases|settings\.restore|shop\.theme\.short)/.test(key) && BUY_CTA[lang] && BUY_CTA[lang].test(f)) problems.push(`${where} urges the player to buy (UWG Annex No. 28)`);
      }
    }
    if (table['settings.legal'] !== LEGAL_LABEL[lang] || table['legal.title'] !== LEGAL_LABEL[lang]) problems.push(`${lang}: legal-notice label must be "${LEGAL_LABEL[lang]}" (settings.legal "${table['settings.legal']}", legal.title "${table['legal.title']}")`);
  }
  // plural forms: every plural key renders for every count without a left-over placeholder, and Russian
  // picks 1 / 2–4 / 5–20 correctly (also 21, 22, 25, 101 …)
  const params = { n: 0, coins: 1, hammer: 1, shuffle: 1, xp: 1, next: 1, max: 1, h: 1, m: 1, time: 'x', text: 'x', name: 'x', url: 'x', v: '1' };
  const counts = [0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 20, 21, 22, 24, 25, 30, 31, 100, 101, 102, 111, 112, 150, 1000, 1500, 12840];
  for (const lang of LANGS) {
    setLang(lang);
    const table = (await import(`../../game/js/ui/strings/${lang}.js`)).default;
    for (const key of Object.keys(en)) {
      if (!(key in table)) continue;
      for (const n of counts) {
        const out = t(key, { ...params, n });
        if (/[{}]/.test(out) || !out.trim()) problems.push(`${lang}: ${key} (n=${n}) renders "${out}"`);
        const needsN = forms(en[key]).some((s) => s.includes('{n}'));
        if (needsN && typeof table[key] === 'object' && forms(table[key]).filter((s) => s.includes('{n}')).length < 1) problems.push(`${lang}: ${key} lost {n}`);
      }
    }
  }
  setLang('ru');
  const ru = (key, n) => t(key, { n });
  const expect = [
    ['journey.starsAria', 1, '1 звезда'], ['journey.starsAria', 2, '2 звезды'], ['journey.starsAria', 4, '4 звезды'], ['journey.starsAria', 5, '5 звёзд'],
    ['journey.starsAria', 11, '11 звёзд'], ['journey.starsAria', 21, '21 звезда'], ['journey.starsAria', 22, '22 звезды'], ['journey.starsAria', 25, '25 звёзд'], ['journey.starsAria', 101, '101 звезда'],
    ['toast.coins', 1, '+1 монета'], ['toast.coins', 3, '+3 монеты'], ['toast.coins', 40, '+40 монет'], ['toast.coins', 1500, `+${formatNumber(1500)} монет`],
    ['mission.play_games', 2, 'Заверши 2 игры'], ['mission.play_games', 5, 'Заверши 5 игр'],
  ];
  for (const [key, n, want] of expect) if (ru(key, n) !== want) problems.push(`ru plural: ${key}(${n}) = "${ru(key, n)}", expected "${want}"`);
  // upper(): Turkish i → İ (the calendar month "Eki" → "EKİ"), everything else unchanged
  setLang('tr');
  if (upper('eki') !== 'EKİ' || upper('ılık') !== 'ILIK') problems.push(`tr upper(): "${upper('eki')}" / "${upper('ılık')}"`);
  setLang('ru');
  if (upper('Ёж') !== 'ЁЖ') problems.push(`ru upper(): "${upper('Ёж')}"`);
  setLang('en');
  if (upper('eki') !== 'EKI') problems.push(`en upper(): "${upper('eki')}"`);
  assert(problems.length === 0, `string content:\n  ${problems.join('\n  ')}`);
}

/** Canvas texts (praise words, Combo, No space!, New best!) fit the board at (nearly) their normal size in every language. */
async function checkCanvasTexts(page, lang) {
  const tight = await ev(page, async (l) => {
    const { t } = await import('/js/ui/i18n.js');
    window.__blocko.setLang(l);
    const R = window.__blocko.app.game.renderer;
    await document.fonts.load('900 40px Nunito', 'AaĞğŞşİıЖж');
    const ctx = document.createElement('canvas').getContext('2d');
    const items = [['praise.good', 1], ['praise.great', 1], ['praise.excellent', 1], ['praise.amazing', 1], ['praise.unbelievable', 1], ['nospace', 0.95], ['newbest', 0.9]]
      .map(([k, f]) => [t(k), R._bigFont(f)]);
    items.push([t('combo', { n: 12 }), R._smallFont(0.62)]);
    return items.filter(([s, size]) => {
      ctx.font = `900 ${size}px Nunito`;
      // the renderer shrinks a text that is wider than the board; a few percent are fine, more is not
      return (R.layout.boardPx * 0.98) / (ctx.measureText(s).width + size * 0.6) < 0.9;
    }).map(([s]) => s);
  }, lang);
  assert(tight.length === 0, `[${lang}] canvas texts that the renderer would shrink by more than 10 % to fit the board: ${tight.join(' | ')}`);
}

async function check(page, lang, where) {
  await idle(page);
  await page.waitForTimeout(120);
  const problems = await layoutProblems(page);
  assert(problems.length === 0, `[${lang}] ${where}:\n  ${problems.join('\n  ')}`);
  const broken = await brokenWords(page);
  assert(broken.length === 0, `[${lang}] ${where}: words wrapped inside themselves: ${broken.join(', ')}`);
  const raw = await ev(page, () => [...document.querySelectorAll('.screen.is-active [data-i18n], .modal:not(.is-closing) [data-i18n]')]
    .filter((el) => el.textContent.trim() === el.getAttribute('data-i18n')).map((el) => el.getAttribute('data-i18n')));
  assert(raw.length === 0, `[${lang}] ${where}: untranslated ${raw.join(', ')}`);
}

async function openModal(page, id, props) {
  await ev(page, ([m, p]) => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open(m, p); }, [id, props]);
  await waitModal(page, id);
}

async function walk(page, lang) {
  await ev(page, (l) => window.__blocko.setLang(l), lang);
  await ev(page, () => window.__blocko.goto('home'));
  await check(page, lang, 'home');
  await shot(page, `i18n-all-home-${lang}`);
  await ev(page, () => window.__blocko.goto('journey'));
  await check(page, lang, 'journey');
  await openModal(page, 'levelStart', { n: 12 });
  await check(page, lang, 'level start');
  await ev(page, () => window.__blocko.goto('shop'));
  await page.waitForSelector('.screen.is-active [data-product="coins_large"]');
  await check(page, lang, 'shop coins');
  await tap(page, 'shop.tab.themes');
  await check(page, lang, 'shop themes');
  const name = await ev(page, async () => (await import('/js/ui/i18n.js')).t('theme.candy'));
  await openModal(page, 'confirm', { titleKey: 'shop.theme.confirmTitle', bodyKey: 'shop.theme.confirmBody', params: { name, n: 2500 }, okKey: 'shop.theme.unlock', okIcon: 'palette', icon: 'palette' });
  await check(page, lang, 'theme unlock confirm');
  await ev(page, () => window.__blocko.app.modals.closeAll());
  await tap(page, 'shop.tab.boosters');
  await check(page, lang, 'shop boosters');
  await shot(page, `i18n-all-shop-${lang}`);
  for (const screen of ['missions', 'settings', 'legal']) {
    await ev(page, (id) => window.__blocko.goto(id), screen);
    await check(page, lang, screen);
  }
  await ev(page, () => window.__blocko.goto('settings'));
  await openModal(page, 'langPicker', {});
  await check(page, lang, 'language picker');
  await ev(page, () => window.__blocko.goto('home'));
  await openModal(page, 'dailyReward', { auto: false });
  await check(page, lang, 'daily reward');
  // claimed days wear a check badge in the tile corner: no day label may run under it
  const yesterday = new Date();
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  await ev(page, (d) => window.__blocko.save({ daily: { lastClaimDay: d, day: 6, streak: 6 } }), todayKey(yesterday));
  await openModal(page, 'dailyReward', { auto: false });
  await check(page, lang, 'daily reward (6 days claimed)');
  await page.waitForTimeout(500); // the badges pop in with a spring animation
  const covered = await ev(page, () => [...document.querySelectorAll('.modal .dday.is-claimed')].map((tile) => {
    const label = tile.querySelector('.dday__label');
    const badge = tile.querySelector('.dday__check');
    const text = label.firstChild;
    const range = document.createRange(); // the last glyph (the day number in most languages)
    range.setStart(text, Math.max(0, text.textContent.length - 1));
    range.setEnd(text, text.textContent.length);
    const a = range.getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let inside = 0;
    let total = 0;
    for (let x = a.left; x <= a.right; x += 0.5) {
      for (let y = a.top; y <= a.bottom; y += 0.5) {
        total++;
        if (Math.hypot(x - cx, y - cy) < b.width / 2) inside++;
      }
    }
    return total && inside / total > 0.3 ? label.textContent : null;
  }).filter(Boolean));
  assert(covered.length === 0, `[${lang}] daily reward: the check badge hides the end of the day label ${covered.join(', ')}`);
  await ev(page, (d) => window.__blocko.save({ daily: { lastClaimDay: d, day: 1, streak: 1 } }), todayKey());
  await openModal(page, 'levelUp', { levels: [5], coins: 100, themes: ['candy'] });
  await check(page, lang, 'level up');
  await openModal(page, 'notifAsk', { coins: 100 });
  await check(page, lang, 'notification ask');
  await openModal(page, 'purchasePending', {});
  await check(page, lang, 'purchase pending');
  await ev(page, () => window.__blocko.app.modals.closeAll());
  // classic run: HUD with combo + nudge, pause, confirm, revive, game over (with the upsell chip)
  await ev(page, () => window.__blocko.startGame('classic', { seed: 9, score: 1400, best: 1500 }));
  await ev(page, () => { const s = window.__blocko.app.game.session; s.combo = 4; window.__blocko.app.game.hud.sync({ instant: true }); });
  await check(page, lang, 'classic HUD');
  await tap(page, 'game.pause');
  await waitModal(page, 'pause');
  await check(page, lang, 'pause');
  await tap(page, 'pause.restart');
  await waitModal(page, 'confirm');
  await check(page, lang, 'restart confirm');
  await tap(page, 'confirm.cancel');
  await tap(page, 'pause.resume');
  await playMoves(page, 2);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await check(page, lang, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
  await page.waitForTimeout(1600);
  await check(page, lang, 'game over');
  // journey: hard level HUD, booster offer, stuck panel, failed result
  await ev(page, () => window.__blocko.save({ boosters: { hammer: 0 } }));
  await ev(page, () => window.__blocko.startGame('journey', { level: 10 }));
  await check(page, lang, 'journey HUD');
  await tap(page, 'game.booster.hammer');
  await waitModal(page, 'booster');
  await check(page, lang, 'booster offer');
  await tap(page, 'booster.close');
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await check(page, lang, 'stuck panel');
  await tap(page, 'revive.giveUp');
  await waitModal(page, 'levelResult');
  await check(page, lang, 'level failed');
  // daily HUD + won level result
  await ev(page, () => window.__blocko.startGame('daily'));
  await check(page, lang, 'daily HUD');
  await ev(page, () => window.__blocko.modal('levelResult'));
  await waitModal(page, 'levelResult');
  await page.waitForTimeout(1500);
  await check(page, lang, 'level complete');
  // canvas texts: Nunito covers every glyph (a fallback font would change the measured width)
  const fallback = await ev(page, async () => {
    const { t } = await import('/js/ui/i18n.js');
    const texts = ['praise.good', 'praise.great', 'praise.excellent', 'praise.amazing', 'praise.unbelievable', 'nospace', 'newbest'].map((k) => t(k));
    texts.push(t('combo', { n: 5 }));
    await document.fonts.load('900 40px Nunito', texts.join(''));
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, s) => { ctx.font = font; return ctx.measureText(s).width; };
    return texts.filter((s) => !document.fonts.check('900 40px Nunito', s) || Math.abs(width('900 40px Nunito, monospace', s) - width('900 40px Nunito, serif', s)) > 0.01);
  });
  assert(fallback.length === 0, `[${lang}] canvas texts not fully covered by Nunito: ${fallback.join(' | ')}`);
  await checkCanvasTexts(page, lang);
  const missing = await ev(page, () => window.__blocko.missingKeys());
  assert(missing.length === 0, `[${lang}] missing keys: ${missing.join(', ')}`);
}

/** The main screens on a 360×700 phone as well (the common size; 320×518 is the tightest). */
async function walkMain(page, lang) {
  await ev(page, (l) => window.__blocko.setLang(l), lang);
  await ev(page, () => window.__blocko.goto('home'));
  await check(page, lang, 'home 360');
  await ev(page, () => window.__blocko.goto('journey'));
  await check(page, lang, 'journey 360');
  await openModal(page, 'levelStart', { n: 12 });
  await check(page, lang, 'level start 360');
  await ev(page, () => window.__blocko.goto('shop'));
  await page.waitForSelector('.screen.is-active [data-product="coins_large"]');
  await check(page, lang, 'shop coins 360');
  await tap(page, 'shop.tab.themes');
  await check(page, lang, 'shop themes 360');
  await tap(page, 'shop.tab.boosters');
  await check(page, lang, 'shop boosters 360');
  for (const screen of ['missions', 'settings', 'legal']) {
    await ev(page, (id) => window.__blocko.goto(id), screen);
    await check(page, lang, `${screen} 360`);
  }
  await ev(page, () => window.__blocko.goto('home'));
  await openModal(page, 'dailyReward', { auto: false });
  await check(page, lang, 'daily reward 360');
  await ev(page, () => window.__blocko.app.modals.closeAll());
}

export default async function i18nAllSpec() {
  await checkTables();
  await checkContent();

  // 'auto' + device language → the tutorial opens in that language
  for (const lang of LANGS) {
    const g = await openGame({ viewport: VIEWPORTS.phoneSmall, locale: LOCALES[lang] });
    try {
      const s = await ev(g.page, () => window.__blocko.state());
      assert(s.lang === lang, `auto language from ${LOCALES[lang]} (${s.lang})`);
      await check(g.page, lang, 'tutorial');
      assertNoErrors(g, `i18n-all auto ${lang}`);
    } finally {
      await g.close();
    }
  }

  const today = todayKey();
  const g = await openGame({
    viewport: VIEWPORTS.phoneSmall,
    save: veteranSave({
      coins: 3250,
      stats: { gamesPlayed: 30, bestScore: 12840 },
      journey: { unlocked: 12, stars: { 1: 3, 2: 2, 3: 1 } },
      challenge: { completed: { [today]: 2 }, streak: 4, lastDay: today },
      boosters: { hammer: 3, shuffle: 1 },
    }),
  });
  try {
    // longest settings / game-over variants: privacy-options row and the soft upsell chip
    await ev(g.page, () => {
      window.__blocko.platform.isPrivacyOptionsRequired = () => true;
      window.__blocko.app.adPolicy.shouldShowUpsell = () => true;
    });
    for (const lang of LANGS) await walk(g.page, lang);
    const warned = g.consoleLog.filter((l) => l.includes('[i18n]'));
    assert(warned.length === 0, `i18n warnings:\n${warned.join('\n')}`);
    assertNoErrors(g, 'i18n-all walk');
  } finally {
    await g.close();
  }

  const g360 = await openGame({
    viewport: VIEWPORTS.phone,
    save: veteranSave({
      coins: 3250,
      stats: { gamesPlayed: 30, bestScore: 12840 },
      journey: { unlocked: 12, stars: { 1: 3, 2: 2, 3: 1 } },
      challenge: { completed: { [today]: 2 }, streak: 4, lastDay: today },
      boosters: { hammer: 3, shuffle: 1 },
    }),
  });
  try {
    await ev(g360.page, () => { window.__blocko.platform.isPrivacyOptionsRequired = () => true; });
    for (const lang of LANGS) await walkMain(g360.page, lang);
    assertNoErrors(g360, 'i18n-all 360 walk');
  } finally {
    await g360.close();
  }
}
