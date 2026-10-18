// E2E layout of the meta screens and sheets at all 5 viewports (+ German on the smallest phone):
// no horizontal overflow, no clipped text (checked with in-word wrapping disabled), no untranslated
// keys. Screenshots → tools/out/ui-b/<scene>-<viewport>.png
// Run: node tests/e2e/run.mjs meta-layout
import { openGame, veteranSave, VIEWPORTS, assert, ev, idle, waitModal, waitState, tap, layoutProblems, assertNoErrors } from './ui.helpers.mjs';
import { shotB, todayKey } from './meta.helpers.mjs';

function richSave() {
  const stars = {};
  for (let n = 1; n < 20; n++) stars[n] = (n % 3) + 1;
  const today = todayKey();
  return veteranSave({
    coins: 3250,
    xp: 420,
    stats: { gamesPlayed: 30, bestScore: 12840 },
    journey: { unlocked: 20, stars },
    challenge: { completed: { [today]: 2 }, streak: 4, lastDay: today },
    daily: { lastClaimDay: null, day: 3, streak: 3 },
    flags: { notifDeclines: 2 },
    boosters: { hammer: 3, shuffle: 1 },
  });
}

async function check(page, where) {
  await idle(page);
  await page.waitForTimeout(250);
  const problems = await layoutProblems(page);
  assert(problems.length === 0, `${where}: layout problems:\n  ${problems.join('\n  ')}`);
  const raw = await ev(page, () => [...document.querySelectorAll('.screen.is-active [data-i18n], .modal:not(.is-closing) [data-i18n]')]
    .filter((el) => el.textContent.trim() === el.getAttribute('data-i18n')).map((el) => el.getAttribute('data-i18n')));
  assert(raw.length === 0, `${where}: untranslated ${raw.join(', ')}`);
}

async function scenes(page, tag, lang) {
  const scene = async (name, fn) => {
    await fn();
    await check(page, `${tag} ${name}`);
    await shotB(page, `${name}-${tag}`);
  };
  await ev(page, () => window.__blocko.goto('home'));
  if (lang) await ev(page, (l) => window.__blocko.setLang(l), lang);
  await scene('dailyReward', async () => {
    await ev(page, () => window.__blocko.modal('dailyReward', { auto: false }));
    await waitModal(page, 'dailyReward');
  });
  await scene('home', async () => {
    await ev(page, () => window.__blocko.app.modals.closeAll());
  });
  await scene('journey', async () => {
    await ev(page, () => window.__blocko.goto('journey'));
  });
  await scene('levelStart', async () => {
    await ev(page, () => window.__blocko.app.modals.open('levelStart', { n: 20 }));
    await waitModal(page, 'levelStart');
  });
  await scene('shop-coins', async () => {
    await ev(page, () => window.__blocko.goto('shop'));
    await page.waitForSelector('.screen.is-active [data-product="coins_large"]');
  });
  await scene('shop-themes', async () => tap(page, 'shop.tab.themes'));
  await scene('shop-boosters', async () => tap(page, 'shop.tab.boosters'));
  await scene('missions', async () => {
    await ev(page, () => window.__blocko.goto('missions'));
  });
  await scene('settings', async () => {
    await ev(page, () => window.__blocko.goto('settings'));
  });
  await scene('langPicker', async () => {
    await ev(page, () => window.__blocko.app.modals.open('langPicker'));
    await waitModal(page, 'langPicker');
  });
  await scene('legal', async () => {
    await ev(page, () => window.__blocko.goto('legal'));
  });
  await scene('levelUp', async () => {
    await ev(page, () => window.__blocko.goto('home'));
    await ev(page, () => window.__blocko.app.modals.open('levelUp', { levels: [5], coins: 100, themes: ['neon'] }));
    await waitModal(page, 'levelUp');
    await page.waitForTimeout(500);
  });
  await scene('notifAsk', async () => {
    await ev(page, () => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open('notifAsk', { coins: 100 }); });
    await waitModal(page, 'notifAsk');
  });
  await scene('purchasePending', async () => {
    await ev(page, () => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open('purchasePending', {}); });
    await waitModal(page, 'purchasePending');
  });
  await ev(page, () => window.__blocko.app.modals.closeAll());
}

export default async function metaLayoutSpec() {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const g = await openGame({ viewport, save: richSave() });
    try {
      await waitModal(g.page, 'dailyReward');
      await tap(g.page, 'dailyReward.claim');
      await waitState(g.page, '(st) => st.modals.length === 0');
      await scenes(g.page, name);
      if (name === 'phoneSmall') {
        await scenes(g.page, `${name}-de`, 'de');
        const missing = (await ev(g.page, () => window.__blocko.missingKeys())).filter((k) => /^(en|de):/.test(k));
        assert(missing.length === 0, `missing keys: ${missing}`);
      }
      assertNoErrors(g, `layout ${name}`);
    } finally {
      await g.close();
    }
  }
}
