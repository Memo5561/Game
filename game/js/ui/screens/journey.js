// Journey map: a vertical, winding path of level nodes (level 1 at the bottom). Completed levels
// show their 1–3 stars, the current level pulses, locked levels are greyed; hard levels carry a
// flame badge and super-hard levels a skull badge. Tapping a node opens the level start sheet
// (modal 'levelStart'); completed levels can be replayed.
//
// Levels are endless, so the map shows up to journeyUnlocked + AHEAD levels and is VIRTUALIZED:
// only the nodes (and the path dots / decorations between them) within about one screen above
// and below the viewport exist in the DOM; scrolling adds/removes them once per animation frame.
// The map is a native overflow scroller (momentum, touch-action: pan-y) – the body stays fixed.
// Geometry is in CSS px of the scroller; on tablets everything scales by --map-scale.

import { levelKind } from '../../core/levels.js';
import { icon } from '../icons.js';
import { fromHtml, esc, setText } from '../dom.js';
import { t } from '../i18n.js';
import { screenHeader, coinPill, starsRow } from '../components.js';

/** Levels shown beyond the highest unlocked one. */
export const AHEAD = 20;
/** Vertical distance between two level centres (px at scale 1). */
const SPACING = 128;
/** Space above the last shown level (the "more to come" cloud) and below level 1. */
const TOP_PAD = 190;
const BOTTOM_PAD = 120;
/** Phase step of the winding path per level (radians). */
const WAVE = 0.78;
/** Path dots between two levels, at these fractions of the way up (kept clear of the stars
 * below the upper node and of the nodes themselves). */
const DOT_STEPS = [0.32, 0.45, 0.58];
/** Rendered margin above/below the viewport, in viewport heights. */
const OVERSCAN = 0.9;
/** Decoration blocks next to the path: every DECO_EVERY-th gap. */
const DECO_EVERY = 2;
/** Max width of the column the path winds in (px at scale 1). */
const COLUMN = 520;

/** @type {null|{ el: HTMLElement, scroller: HTMLElement, track: HTMLElement, jump: HTMLElement,
 *  items: Map<number, HTMLElement[]>, w: number, h: number, maxN: number, unlocked: number,
 *  scale: number, raf: number, signature: string, app: Object, celebrate: number }} */
let view = null;
let lastUnlocked = 0;

export const journeyScreen = {
  id: 'journey',

  build(app) {
    const el = fromHtml(`<section class="screen--journey">
      ${screenHeader('mode.journey', { right: coinPill() })}
      <div class="map" data-ref="scroller">
        <div class="map__track" data-ref="track">
          <div class="map__end" data-ref="end">${icon('lock', 'map__end-icon')}<span data-i18n="journey.more"></span></div>
        </div>
      </div>
      <button type="button" class="map__jump" data-action="journey.jump" data-ref="jump" hidden>
        ${icon('next', 'map__jump-arrow')}<span class="map__jump-label" data-ref="jumpLabel"></span></button>
    </section>`);
    const scroller = el.querySelector('[data-ref="scroller"]');
    view = {
      el,
      scroller,
      track: el.querySelector('[data-ref="track"]'),
      jump: el.querySelector('[data-ref="jump"]'),
      items: new Map(),
      w: 0,
      h: 0,
      maxN: 0,
      unlocked: 0,
      scale: 1,
      raf: 0,
      signature: '',
      app,
      celebrate: 0,
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', () => {
      if (app.router.current === 'journey') layout(app, { keepCenter: true });
    });
    app.action('journey.node.*', (btn, n) => openLevel(app, Number(n)));
    app.action('journey.jump', () => scrollToLevel(view.unlocked, true));
    return el;
  },

  enter(params, app) {
    app.refreshCoins({ instant: true });
    const unlocked = app.progression.journeyUnlocked;
    // a level was just unlocked since the last visit → the new current node pops in
    view.celebrate = lastUnlocked && unlocked > lastUnlocked ? unlocked : 0;
    lastUnlocked = unlocked;
    layout(app, { focus: Number(params.focus) || unlocked, force: true });
  },

  leave() {
    if (view.raf) cancelAnimationFrame(view.raf);
    view.raf = 0;
  },

  refresh(reason, app) {
    if (app.router.current !== 'journey') {
      view.signature = ''; // re-render on the next visit
      return;
    }
    layout(app, { keepCenter: true, force: reason === 'lang' });
  },
};

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** y of a (fractional) level position, measured from the track top. */
function yOf(n) {
  return view.h - (BOTTOM_PAD + (n - 1) * SPACING) * view.scale;
}

/** Width of the centred column the path winds in (the full width on phones). */
function columnWidth() {
  return Math.min(view.w, COLUMN * view.scale);
}

/** Horizontal amplitude of the path. */
function amplitude() {
  return Math.min(columnWidth() * 0.27, 150 * view.scale);
}

/** x of a (fractional) level position. */
function xOf(n) {
  return view.w / 2 + amplitude() * Math.sin((n - 1) * WAVE + 0.4);
}

/** Fractional level at track position y. */
function levelAt(y) {
  return 1 + ((view.h - y) / view.scale - BOTTOM_PAD) / SPACING;
}

/**
 * (Re)computes the track size and renders the visible window.
 * @param {Object} app
 * @param {{ focus?: number, keepCenter?: boolean, force?: boolean }} [o]
 */
function layout(app, { focus = 0, keepCenter = false, force = false } = {}) {
  const sc = view.scroller;
  const w = sc.clientWidth;
  if (!w) return;
  const centre = keepCenter && view.h ? levelAt(sc.scrollTop + sc.clientHeight / 2) : 0;
  const unlocked = app.progression.journeyUnlocked;
  const scale = parseFloat(getComputedStyle(view.el).getPropertyValue('--map-scale')) || 1;
  const signature = `${w}|${scale}|${unlocked}|${JSON.stringify(app.save.journey.stars)}|${app.themeId}`;
  const changed = force || signature !== view.signature;
  if (changed) {
    view.signature = signature;
    view.w = w;
    view.scale = scale;
    view.unlocked = unlocked;
    view.maxN = unlocked + AHEAD;
    view.h = Math.round((TOP_PAD + BOTTOM_PAD + (view.maxN - 1) * SPACING) * scale);
    view.track.style.height = `${view.h}px`;
    clearItems();
  }
  if (focus) scrollToLevel(focus, false);
  // keep the level in the middle of the screen where it was (geometry changed) – never touch
  // the scroll position otherwise (a refresh must not stop a fling)
  else if (changed && centre) sc.scrollTop = Math.max(0, yOf(centre) - sc.clientHeight / 2);
  update();
}

function scrollToLevel(n, smooth) {
  const sc = view.scroller;
  const top = Math.max(0, Math.min(view.h - sc.clientHeight, yOf(n) - sc.clientHeight * 0.55));
  if (smooth && typeof sc.scrollTo === 'function') sc.scrollTo({ top, behavior: 'smooth' });
  else sc.scrollTop = top;
  if (!smooth) update();
}

function schedule() {
  if (view.raf) return;
  view.raf = requestAnimationFrame(() => {
    view.raf = 0;
    update();
  });
}

// ---------------------------------------------------------------------------------------------
// Virtualized rendering
// ---------------------------------------------------------------------------------------------

/** Renders exactly the levels around the viewport (and drops the rest). */
function update() {
  if (!view.h) return;
  const sc = view.scroller;
  const top = sc.scrollTop;
  const vh = sc.clientHeight || 1;
  const lo = Math.max(1, Math.floor(levelAt(top + vh * (1 + OVERSCAN))));
  const hi = Math.min(view.maxN, Math.ceil(levelAt(top - vh * OVERSCAN)));
  for (const [n, els] of view.items) {
    if (n < lo || n > hi) {
      for (const e of els) e.remove();
      view.items.delete(n);
    }
  }
  const frag = document.createDocumentFragment();
  for (let n = lo; n <= hi; n++) {
    if (view.items.has(n)) continue;
    const els = buildLevel(n);
    view.items.set(n, els);
    for (const e of els) frag.appendChild(e);
  }
  if (frag.childNodes.length) view.track.appendChild(frag);
  updateJump(top, vh);
}

function clearItems() {
  for (const els of view.items.values()) for (const e of els) e.remove();
  view.items.clear();
}

/** Node of level n + the path dots (and decorations) towards level n + 1. */
function buildLevel(n) {
  const app = view.app;
  const unlocked = view.unlocked;
  const kind = levelKind(n);
  const stars = Number(app.save.journey.stars[n]) || 0;
  const state = n < unlocked ? 'done' : n === unlocked ? 'current' : 'locked';
  const els = [];

  if (n < view.maxN) {
    for (const step of DOT_STEPS) {
      const f = n + step;
      const d = document.createElement('i');
      d.className = `map__dot${n < unlocked ? ' is-done' : ''}`;
      d.style.transform = `translate(${xOf(f).toFixed(1)}px, ${yOf(f).toFixed(1)}px)`;
      els.push(d);
    }
    if (n % DECO_EVERY === 0 && n % 10 !== 0) els.push(decoration(n));
    if (n % 10 === 0) els.push(chapterSign(n));
  }

  const node = document.createElement('button');
  node.type = 'button';
  node.className = `node node--${state}${kind !== 'normal' ? ` node--${kind}` : ''}${n === view.celebrate ? ' is-new' : ''}`;
  node.setAttribute('data-action', `journey.node.${n}`);
  node.setAttribute('data-n', String(n));
  const label = [t('hud.level', { n })];
  if (kind !== 'normal') label.push(t(`tag.${kind}`));
  if (state === 'done') label.push(t('journey.starsAria', { n: stars }));
  if (state === 'locked') label.push(t('common.locked'));
  node.setAttribute('aria-label', label.join(', '));
  node.style.transform = `translate(${xOf(n).toFixed(1)}px, ${yOf(n).toFixed(1)}px)`;
  node.innerHTML = `<span class="node__disc"><span class="node__num">${n}</span></span>
    ${state === 'done' ? starsRow(stars, 3, 'node__stars') : ''}
    ${kind !== 'normal' ? `<span class="node__tag">${icon(kind === 'superhard' ? 'skull' : 'flame')}</span>` : ''}
    ${state === 'locked' ? `<span class="node__lock">${icon('lock')}</span>` : ''}
    ${state === 'current' ? `<span class="node__pin">${icon('play')}</span>` : ''}`;
  els.push(node);
  return els;
}

/** Small drifting block beside the path (deterministic per level). */
function decoration(n) {
  const f = n + 0.5;
  const side = Math.sin((f - 1) * WAVE + 0.4) > 0 ? -1 : 1;
  const x = view.w / 2 + side * (amplitude() * 0.9 + ((n * 37) % 23));
  const size = (12 + ((n * 7) % 14)) * view.scale;
  const d = document.createElement('i');
  d.className = 'map__deco';
  d.style.cssText = `--c: var(--color-${(n * 3) % 8}); width:${size}px; height:${size}px; transform: translate(${x.toFixed(1)}px, ${yOf(f).toFixed(1)}px) rotate(${((n * 29) % 50) - 25}deg)`;
  return d;
}

/** "Chapter n" sign between level 10k and 10k + 1, at the column edge away from the path. */
function chapterSign(n) {
  const f = n + 0.5;
  const side = Math.sin((f - 1) * WAVE + 0.4) > 0 ? -1 : 1;
  const edge = (view.w - columnWidth()) / 2 + 14;
  const el = document.createElement('div');
  el.className = 'map__chapter';
  el.style[side < 0 ? 'left' : 'right'] = `${edge.toFixed(1)}px`;
  el.style.top = `${yOf(f).toFixed(1)}px`;
  el.innerHTML = `${icon('star2')}<span>${esc(t('journey.chapter', { n: n / 10 + 1 }))}</span>`;
  return el;
}

/** "Jump to level n" while the current node is off screen (arrow points towards it). */
function updateJump(top, vh) {
  const y = yOf(view.unlocked);
  const above = y < top + 20;
  const below = y > top + vh - 20;
  view.jump.hidden = !(above || below);
  view.jump.classList.toggle('is-up', above);
  setText(view.el.querySelector('[data-ref="jumpLabel"]'), t('hud.level', { n: view.unlocked }));
}

// ---------------------------------------------------------------------------------------------

function openLevel(app, n) {
  const P = app.progression;
  if (!(n >= 1)) return;
  if (n > P.journeyUnlocked) {
    app.toast(t('journey.lockedToast', { n: P.journeyUnlocked }), { icon: 'lock' });
    return;
  }
  if (app.modals.isOpen) return;
  app.modals.open('levelStart', { n });
}
