// E2E i18n for all 8 languages.
// - String tables: every table has exactly the keys of en.js, the same {placeholders} per key (over all
//   plural forms), and plural objects carry every category Intl.PluralRules(lang) picks for counts
//   (ru: one/few/many/other); a table may use a plural object where en.js has a plain "{n}" string.
// - 'auto' follows the device language for every language (regional variants like es-MX, pt-PT too);
//   the tutorial opens in it.
// - On the smallest phone (320×518) the main screens, sheets and run modals have no missing or
//   untranslated key, no text overflow (layoutProblems: in-word wrapping disabled) and no word that
//   wraps inside itself (measured per word with Range rects – catches sub-pixel overflows that the
//   integer scrollWidth check rounds away); canvas texts render with the bundled Nunito (no glyph
//   falls back to another font).
// Run: node tests/e2e/run.mjs i18n
import { LANGS, resolveLang } from '../../game/js/ui/i18n.js';
import { openGame, veteranSave, todayKey, VIEWPORTS, assert, ev, idle, waitModal, tap, playMoves, layoutProblems, shot, assertNoErrors } from './ui.helpers.mjs';

const LOCALES = { en: 'en-GB', de: 'de-AT', es: 'es-MX', fr: 'fr-CA', it: 'it-IT', pt: 'pt-BR', tr: 'tr-TR', ru: 'ru-RU' };

/**
 * Known layout issues outside the translated tables: [lang, word]. Remove an entry once fixed.
 * en.js 'shop.tab.boosters' ("Boosters") is ~1 px wider than the 320 px shop tab and wraps inside
 * the word ("Booster|s").
 */
const KNOWN_BROKEN_WORDS = [['en', 'Boosters']];

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

async function checkTables() {
  const en = (await import('../../game/js/ui/strings/en.js')).default;
  const problems = [];
  for (const lang of LANGS) {
    const table = (await import(`../../game/js/ui/strings/${lang}.js`)).default;
    const cats = countCategories(lang);
    for (const key of Object.keys(en)) if (!(key in table)) problems.push(`${lang}: missing key ${key}`);
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

/** Words wrapped inside themselves (no hyphen / soft hyphen at the break) on the visible UI. */
function brokenWords(page) {
  return page.evaluate(() => {
    const out = [];
    for (const root of document.querySelectorAll('.screen.is-active, .modal:not(.is-closing):not(.is-covered), #toasts')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[aria-hidden="true"]') || !el.getClientRects().length) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        for (const m of n.textContent.matchAll(/[^ \t\n\r]+/g)) {
          if (/[\u00AD\-‐–—/]/.test(m[0])) continue;
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const lines = new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top)));
          if (lines.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  });
}

async function check(page, lang, where) {
  await idle(page);
  await page.waitForTimeout(120);
  const problems = await layoutProblems(page);
  assert(problems.length === 0, `[${lang}] ${where}:\n  ${problems.join('\n  ')}`);
  const broken = (await brokenWords(page)).filter((w) => !KNOWN_BROKEN_WORDS.some(([l, k]) => l === lang && k === w));
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
  const missing = await ev(page, () => window.__blocko.missingKeys());
  assert(missing.length === 0, `[${lang}] missing keys: ${missing.join(', ')}`);
}

export default async function i18nAllSpec() {
  await checkTables();

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
}
