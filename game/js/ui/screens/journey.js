// Journey screen – PLACEHOLDER of part A (minimal, functional): a list of the levels around the
// player's position with stars and Play buttons. Part B replaces this file with the level map.

import { levelKind } from '../../core/levels.js';
import { icon } from '../icons.js';
import { fromHtml, esc } from '../dom.js';
import { t } from '../i18n.js';
import { screenHeader, coinPill, starsRow } from '../components.js';
import { startJourney } from './home.js';

const BEFORE = 6;
const AFTER = 3;

let list = null;

export const journeyScreen = {
  id: 'journey',

  build(app) {
    const el = fromHtml(`<section class="screen--journey">
      ${screenHeader('mode.journey', { right: coinPill() })}
      <div class="screen-body"><ol class="level-list" data-ref="list"></ol></div>
    </section>`);
    list = el.querySelector('[data-ref="list"]');
    app.action('journey.play.*', (btn, n) => startJourney(app, Number(n)));
    return el;
  },

  enter(params, app) {
    render(app);
    app.refreshCoins({ instant: true });
  },

  refresh(reason, app) {
    render(app);
  },
};

function render(app) {
  const unlocked = app.progression.journeyUnlocked;
  const stars = app.save.journey.stars;
  let html = '';
  for (let n = unlocked + AFTER; n >= Math.max(1, unlocked - BEFORE); n--) {
    const tag = levelKind(n);
    const open = n <= unlocked;
    const got = Number(stars[n]) || 0;
    html += `<li class="level-row${open ? '' : ' is-locked'}${n === unlocked ? ' is-current' : ''}">
        <span class="level-row__n">${n}</span>
        <span class="level-row__text">
          <span class="level-row__title">${esc(t('hud.level', { n }))}${tag !== 'normal' ? ` <span class="badge badge--${tag}">${esc(t(`tag.${tag}`))}</span>` : ''}</span>
          ${got ? starsRow(got, 3, 'level-row__stars') : ''}
        </span>
        ${open
    ? `<button type="button" class="level-row__play" data-action="journey.play.${n}" aria-label="${esc(t('common.play'))}">${icon('play')}</button>`
    : icon('lock', 'level-row__lock')}
      </li>`;
  }
  list.innerHTML = html;
}
