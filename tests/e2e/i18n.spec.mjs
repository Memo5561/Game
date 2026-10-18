// E2E i18n: 'auto' follows the device language (de-DE → de); in German and English every screen,
// HUD variant and modal on the smallest phone (320×518) has no missing key (t() warns in debug
// mode → missingKeys()) and no text overflow (checked with in-word wrapping disabled).
// Run: node tests/e2e/run.mjs i18n
import { openGame, veteranSave, VIEWPORTS, assert, ev, state, idle, waitModal, tap, playMoves, layoutProblems, shot, assertNoErrors } from './ui.helpers.mjs';

async function check(page, lang, where) {
  await idle(page);
  await page.waitForTimeout(120);
  const problems = await layoutProblems(page);
  assert(problems.length === 0, `[${lang}] ${where}:\n  ${problems.join('\n  ')}`);
  const raw = await ev(page, () => [...document.querySelectorAll('.screen.is-active [data-i18n], .modal:not(.is-closing) [data-i18n]')]
    .filter((el) => el.textContent.trim() === el.getAttribute('data-i18n')).map((el) => el.getAttribute('data-i18n')));
  assert(raw.length === 0, `[${lang}] ${where}: untranslated ${raw.join(', ')}`);
}

async function walk(page, lang) {
  await ev(page, (l) => window.__blocko.setLang(l), lang);
  await ev(page, () => window.__blocko.goto('home'));
  await check(page, lang, 'home');
  for (const screen of ['settings', 'shop', 'missions', 'journey', 'legal']) {
    await ev(page, (id) => window.__blocko.goto(id), screen);
    await page.waitForTimeout(150);
    await check(page, lang, screen);
  }
  // classic HUD (combo + nudge visible), pause, confirm, revive, gameover
  await ev(page, () => window.__blocko.startGame('classic', { seed: 9, score: 1400, best: 1500 }));
  await ev(page, () => { const s = window.__blocko.app.game.session; s.combo = 4; window.__blocko.app.game.hud.sync({ instant: true }); });
  await check(page, lang, 'classic HUD');
  await tap(page, 'game.pause');
  await waitModal(page, 'pause');
  await check(page, lang, 'pause');
  await tap(page, 'pause.restart');
  await waitModal(page, 'confirm');
  await check(page, lang, 'confirm');
  await tap(page, 'confirm.cancel');
  await tap(page, 'pause.resume');
  await playMoves(page, 2);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await check(page, lang, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
  await page.waitForTimeout(1600);
  await check(page, lang, 'gameover');
  await shot(page, `i18n-gameover-${lang}`);
  // journey HUD (hard level with tag), stuck panel, booster offer, failed result
  await ev(page, () => window.__blocko.startGame('journey', { level: 10 }));
  await check(page, lang, 'journey HUD');
  await ev(page, () => window.__blocko.save({ boosters: { hammer: 0 } }));
  await ev(page, () => window.__blocko.startGame('journey', { level: 10 }));
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
  await shot(page, `i18n-daily-${lang}`);
  await ev(page, () => window.__blocko.modal('levelResult'));
  await waitModal(page, 'levelResult');
  await page.waitForTimeout(1500);
  await check(page, lang, 'level complete');
  await shot(page, `i18n-levelResult-${lang}`);
  const missing = await ev(page, () => window.__blocko.missingKeys());
  assert(missing.length === 0, `[${lang}] missing keys: ${missing.join(', ')}`);
}

export default async function i18nSpec() {
  // device language de-DE + setting 'auto' → German from the first frame (tutorial)
  let g = await openGame({ viewport: VIEWPORTS.phoneSmall, locale: 'de-DE' });
  try {
    const s = await state(g.page);
    assert(s.lang === 'de', `auto language from the device (${s.lang})`);
    await check(g.page, 'de', 'tutorial');
    const coach = await ev(g.page, () => document.querySelector('.coach__text').textContent);
    assert(/Reihe/.test(coach), `German tutorial text (${coach})`);
    await shot(g.page, 'i18n-tutorial-de');
    assertNoErrors(g, 'i18n auto');
  } finally {
    await g.close();
  }

  g = await openGame({ viewport: VIEWPORTS.phoneSmall, save: veteranSave({ journey: { unlocked: 12 }, stats: { gamesPlayed: 12 } }) });
  try {
    await walk(g.page, 'de');
    await shot(g.page, 'i18n-home-de');
    await walk(g.page, 'en');
    const warned = g.consoleLog.filter((l) => l.includes('[i18n]'));
    assert(warned.length === 0, `i18n warnings:\n${warned.join('\n')}`);
    assertNoErrors(g, 'i18n walk');
  } finally {
    await g.close();
  }
}
