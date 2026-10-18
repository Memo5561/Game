// Inline SVG icon set (one <svg> sprite of <symbol>s, injected once at boot).
//
// Style: chunky, rounded, filled shapes on a 24×24 grid; single-color icons use `currentColor`
// (so they follow the button / text color of the theme), "material" icons (coin, gems, stars,
// crown, boosters) use gradients – the coin and crown take their color from the theme's --coin.
// Vector symbols stay crisp at any device pixel ratio.
//
// Usage:  icon('coin')                → '<svg class="ico ico--coin" …><use href="#i-coin"/></svg>'
//         icon('gem', 'goal__icon', 2) → gem type 2 (star)
// Adding an icon: add an entry to SYMBOLS (inner SVG markup for viewBox 0 0 24 24); gradients go
// into DEFS. Icons are decorative (aria-hidden); buttons carry their own aria-label / text.

const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
/** Dark detail drawn on top of a currentColor shape (reads on light and dark icon colors). */
const CUT = 'rgba(0,0,0,0.32)';

const DEFS = `
<linearGradient id="g-gem1" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#C4F1FF"/><stop offset="0.45" stop-color="#4FB3FF"/><stop offset="1" stop-color="#1A5FE0"/></linearGradient>
<linearGradient id="g-gem2" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#FFF6B8"/><stop offset="0.45" stop-color="#FFC81F"/><stop offset="1" stop-color="#F08A00"/></linearGradient>
<linearGradient id="g-gem3" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#FFB0C4"/><stop offset="0.45" stop-color="#F5386A"/><stop offset="1" stop-color="#B80F3C"/></linearGradient>
<linearGradient id="g-star" x1="0.3" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#FFF3A6"/><stop offset="0.5" stop-color="#FFC62A"/><stop offset="1" stop-color="#F28A00"/></linearGradient>
<linearGradient id="g-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<linearGradient id="g-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2F5FF"/><stop offset="1" stop-color="#8E9BC0"/></linearGradient>
<linearGradient id="g-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F0B26A"/><stop offset="1" stop-color="#A9612A"/></linearGradient>
<linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF7A86"/><stop offset="1" stop-color="#E02A45"/></linearGradient>
<linearGradient id="g-yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE57A"/><stop offset="1" stop-color="#F5A800"/></linearGradient>
<linearGradient id="g-cyan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FE3FF"/><stop offset="1" stop-color="#0F95E0"/></linearGradient>
<linearGradient id="g-purple" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C79BFF"/><stop offset="1" stop-color="#7A2FE6"/></linearGradient>`;

const DIAMOND = 'M2 9.6 6.6 4h10.8L22 9.6 12 21.2z';
const STAR = 'M12 2.4l3.06 6.19 6.83.99-4.94 4.82 1.16 6.81L12 18l-6.11 3.21 1.16-6.81-4.94-4.82 6.83-.99z';
const HEART = 'M12 20.4C9 16.4 1.2 12.8 2 8.4 2.5 3.2 11 2.8 12 8c1-5.2 9.5-4.8 10 .4.8 4.4-7 8-10 12z';
const GEAR = 'M20.1 10.6l2.2.2v2.4l-2.2.2a8.2 8.2 0 0 1-1.4 3.3l1.4 1.7-1.7 1.7-1.7-1.4a8.2 8.2 0 0 1-3.3 1.4l-.2 2.2h-2.4l-.2-2.2a8.2 8.2 0 0 1-3.3-1.4l-1.7 1.4-1.7-1.7 1.4-1.7a8.2 8.2 0 0 1-1.4-3.3l-2.2-.2v-2.4l2.2-.2a8.2 8.2 0 0 1 1.4-3.3L3.9 5.6l1.7-1.7 1.7 1.4a8.2 8.2 0 0 1 3.3-1.4l.2-2.2h2.4l.2 2.2a8.2 8.2 0 0 1 3.3 1.4l1.7-1.4 1.7 1.7-1.4 1.7a8.2 8.2 0 0 1 1.4 3.3zM15.4 12a3.4 3.4 0 1 0-6.8 0 3.4 3.4 0 0 0 6.8 0z';

/** name → inner markup (viewBox 0 0 24 24). */
const SYMBOLS = {
  // --- currency & collectibles ------------------------------------------------------------
  coin: `<circle cx="12" cy="12" r="10.6" style="fill:var(--coin)"/><circle cx="12" cy="12" r="10.6" fill="rgba(90,40,0,0.32)"/>
    <circle cx="12" cy="11.4" r="8.4" style="fill:var(--coin)"/>
    <path d="${STAR}" transform="translate(12 12.3) scale(0.46) translate(-12 -12)" fill="rgba(120,60,0,0.3)"/>
    <path d="${STAR}" transform="translate(12 11.5) scale(0.46) translate(-12 -12)" fill="rgba(255,255,255,0.6)"/>
    <path d="M5.6 9.2a7 7 0 0 1 4.6-4.4" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="1.6" stroke-linecap="round"/>`,
  gem1: `<path d="${DIAMOND}" fill="url(#g-gem1)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M2.6 9.6h18.8M9.6 4 7.6 9.6 12 21M14.4 4l2 5.6L12 21" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="0.9"/>
    <path d="M6.6 4h2.6L7.6 9.6H2.6z" fill="#fff" fill-opacity="0.45"/>`,
  gem2: `<path d="${STAR}" fill="url(#g-gem2)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
    <ellipse cx="9.6" cy="10" rx="2" ry="1.2" transform="rotate(-34 9.6 10)" fill="#fff" fill-opacity="0.6"/>`,
  gem3: `<path d="${HEART}" fill="url(#g-gem3)" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
    <ellipse cx="8" cy="8.6" rx="2.2" ry="1.3" transform="rotate(-34 8 8.6)" fill="#fff" fill-opacity="0.6"/>`,
  star: `<path d="${STAR}" fill="url(#g-star)" stroke="#B85E00" stroke-opacity="0.55" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M12 4.6l2.2 4.5 4.3.6-3 2.9" fill="none" stroke="#fff" stroke-opacity="0.65" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'star-empty': `<path d="${STAR}" fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.22)" stroke-width="1.2" stroke-linejoin="round"/>`,
  crown: `<path d="M3 8.6l4.6 3.6L12 5.2l4.4 7L21 8.6l-1.6 9.6H4.6z" style="fill:var(--coin)" stroke="rgba(90,40,0,0.35)" stroke-width="1" stroke-linejoin="round"/>
    <path d="M4.6 18.2h14.8l-.4 2.4H5z" style="fill:var(--coin)"/><path d="M4.6 18.2h14.8l-.4 2.4H5z" fill="rgba(90,40,0,0.3)"/>
    <circle cx="3" cy="8" r="1.7" style="fill:var(--coin)"/><circle cx="12" cy="4.4" r="1.9" style="fill:var(--coin)"/><circle cx="21" cy="8" r="1.7" style="fill:var(--coin)"/>
    <path d="M6.4 14.6 7.6 12.2" stroke="#fff" stroke-opacity="0.7" stroke-width="1.4" stroke-linecap="round"/>`,
  trophy: `<path d="M7 3.5h10v6.2a5 5 0 0 1-10 0z" style="fill:var(--coin)"/>
    <path d="M7 5.6H4.4v1.6a3.6 3.6 0 0 0 3.3 3.8M17 5.6h2.6v1.6a3.6 3.6 0 0 1-3.3 3.8" fill="none" style="stroke:var(--coin)" stroke-width="2" stroke-linecap="round"/>
    <path d="M10.6 14.4h2.8V17h-2.8z" style="fill:var(--coin)"/><rect x="7.4" y="17" width="9.2" height="3.6" rx="1.2" style="fill:var(--coin)"/>
    <path d="M10.6 14.4h2.8V17h-2.8zM7.4 19.2h9.2v1.4H7.4z" fill="rgba(90,40,0,0.3)"/>
    <path d="M9.4 5.6v3.6" stroke="#fff" stroke-opacity="0.7" stroke-width="1.6" stroke-linecap="round"/>`,
  // --- boosters ------------------------------------------------------------------------------
  hammer: `<g transform="rotate(-42 12 12)"><rect x="10.5" y="9.6" width="3" height="13" rx="1.5" fill="url(#g-wood)"/>
    <rect x="4.6" y="2.6" width="14.8" height="7.6" rx="2.2" fill="url(#g-steel)" stroke="#5A648A" stroke-width="1"/>
    <rect x="6.2" y="3.8" width="11.6" height="2" rx="1" fill="#fff" fill-opacity="0.7"/></g>`,
  shuffle: `<path d="M3 7h3.4c2 0 3.2.8 4.4 2.6l2.4 3.6c1.2 1.8 2.4 2.6 4.4 2.6h2.4" ${STROKE} stroke-width="2.6"/>
    <path d="M3 17h3.4c1.3 0 2.3-.4 3.2-1.2M14.4 8.2c.9-.8 1.9-1.2 3.2-1.2h2.4" ${STROKE} stroke-width="2.6"/>
    <path d="M17.6 3.8 20.8 7l-3.2 3.2M17.6 12.6l3.2 3.2-3.2 3.2" ${STROKE} stroke-width="2.6"/>`,
  // --- navigation / actions -----------------------------------------------------------------
  pause: '<rect x="6" y="4.5" width="4.4" height="15" rx="1.8" fill="currentColor"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.8" fill="currentColor"/>',
  play: '<path d="M8 5.3v13.4c0 1 1.1 1.6 1.9 1l9.4-6.7c.7-.5.7-1.5 0-2L9.9 4.3C9.1 3.7 8 4.3 8 5.3z" fill="currentColor"/>',
  home: '<path d="M12 3.2 2.7 11a1 1 0 0 0 .6 1.8H5V20a1 1 0 0 0 1 1h4.2v-5.6h3.6V21H18a1 1 0 0 0 1-1v-7.2h1.7a1 1 0 0 0 .6-1.8z" fill="currentColor"/>',
  settings: `<path d="${GEAR}" fill="currentColor" fill-rule="evenodd"/>`,
  shop: `<path d="M4.6 8.2h14.8l-1 12a1.6 1.6 0 0 1-1.6 1.5H7.2a1.6 1.6 0 0 1-1.6-1.5z" fill="currentColor"/>
    <path d="M8.6 9.2V7.2a3.4 3.4 0 0 1 6.8 0v2" ${STROKE} stroke-width="2.2"/>
    <circle cx="8.6" cy="11" r="1.1" fill="${CUT}"/><circle cx="15.4" cy="11" r="1.1" fill="${CUT}"/>`,
  cart: `<path d="M2.5 3.8h2.6l2.4 10.6a1.8 1.8 0 0 0 1.8 1.4h8.4a1.8 1.8 0 0 0 1.7-1.3L21.2 7.4H6" ${STROKE} stroke-width="2.4"/>
    <path d="M6.4 8.4h13.8l-1.5 5.4a1.4 1.4 0 0 1-1.4 1H9.1a1.4 1.4 0 0 1-1.4-1.1z" fill="currentColor"/>
    <circle cx="9.6" cy="19.6" r="1.9" fill="currentColor"/><circle cx="17.4" cy="19.6" r="1.9" fill="currentColor"/>`,
  missions: `<rect x="4.4" y="4" width="15.2" height="18" rx="3" fill="currentColor"/>
    <rect x="8.4" y="2.2" width="7.2" height="4.2" rx="1.6" fill="currentColor"/><rect x="8.4" y="2.2" width="7.2" height="4.2" rx="1.6" fill="${CUT}"/>
    <path d="M8.2 13.4l2.6 2.6 5-5.2" fill="none" stroke="${CUT}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  map: `<path d="M3 6.4 8.6 4l6.8 2.6L21 4.2v13.6L15.4 20l-6.8-2.6L3 19.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M8.6 4v13.4M15.4 6.6V20" stroke="${CUT}" stroke-width="1.6"/>
    <circle cx="12" cy="10.4" r="1.6" fill="${CUT}"/>`,
  retry: `<path d="M19.2 12.4A7.2 7.2 0 1 1 17 6.9" ${STROKE} stroke-width="2.8"/>
    <path d="M20.2 3.6v5.2H15z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  ad: `<rect x="2.6" y="5" width="18.8" height="14" rx="3.6" ${STROKE} stroke-width="2.2"/>
    <path d="M10 9.1v5.8c0 .5.5.8.9.5l4.6-2.9c.4-.3.4-.8 0-1.1l-4.6-2.9c-.4-.2-.9.1-.9.6z" fill="currentColor"/>`,
  noads: `<rect x="2.6" y="5" width="18.8" height="14" rx="3.6" ${STROKE} stroke-width="2.2"/>
    <path d="M10 9.1v5.8c0 .5.5.8.9.5l4.6-2.9c.4-.3.4-.8 0-1.1l-4.6-2.9c-.4-.2-.9.1-.9.6z" fill="currentColor"/>
    <path d="M3.4 3.6l17.2 16.8" ${STROKE} stroke-width="2.4"/>`,
  sound: `<path d="M4 9.2h3.2L12 5v14l-4.8-4.2H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1z" fill="currentColor"/>
    <path d="M15.4 9a4.2 4.2 0 0 1 0 6M18 6.4a7.8 7.8 0 0 1 0 11.2" ${STROKE} stroke-width="2.2"/>`,
  'sound-off': `<path d="M4 9.2h3.2L12 5v14l-4.8-4.2H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1z" fill="currentColor"/>
    <path d="M15.6 9.4l5 5.2M20.6 9.4l-5 5.2" ${STROKE} stroke-width="2.4"/>`,
  music: `<path d="M9 17.4V6.2l10.2-2.4v11" ${STROKE} stroke-width="2.4"/>
    <ellipse cx="6.4" cy="17.6" rx="3.1" ry="2.6" fill="currentColor"/><ellipse cx="16.6" cy="15.2" rx="3.1" ry="2.6" fill="currentColor"/>`,
  'music-off': `<path d="M9 17.4V6.2l10.2-2.4v11" ${STROKE} stroke-width="2.4"/>
    <ellipse cx="6.4" cy="17.6" rx="3.1" ry="2.6" fill="currentColor"/><ellipse cx="16.6" cy="15.2" rx="3.1" ry="2.6" fill="currentColor"/>
    <path d="M3 3.4l18 17.2" ${STROKE} stroke-width="2.4"/>`,
  vibration: `<rect x="7.8" y="3.4" width="8.4" height="17.2" rx="2.2" fill="currentColor"/>
    <rect x="10.4" y="17.2" width="3.2" height="1.6" rx="0.8" fill="${CUT}"/>
    <path d="M4.4 8.6v6.8M19.6 8.6v6.8M1.8 10.6v2.8M22.2 10.6v2.8" ${STROKE} stroke-width="2"/>`,
  check: `<path d="M5 12.6l4.6 4.6L19.2 7.4" ${STROKE} stroke-width="3.2"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18" ${STROKE} stroke-width="3.2"/>`,
  back: `<path d="M15 4.6 7.6 12l7.4 7.4" ${STROKE} stroke-width="3.2"/>`,
  next: `<path d="M9 4.6 16.4 12 9 19.4" ${STROKE} stroke-width="3.2"/>`,
  plus: `<path d="M12 5.2v13.6M5.2 12h13.6" ${STROKE} stroke-width="3.4"/>`,
  lock: `<path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" ${STROKE} stroke-width="2.6"/>
    <rect x="5" y="10" width="14" height="11.2" rx="3" fill="currentColor"/>
    <path d="M12 14.2v2.8" stroke="${CUT}" stroke-width="2.4" stroke-linecap="round"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="3.4" fill="currentColor"/>
    <path d="M3 9.4h18V8.4A3.4 3.4 0 0 0 17.6 5H6.4A3.4 3.4 0 0 0 3 8.4z" fill="${CUT}"/>
    <rect x="7" y="2.6" width="2.4" height="5" rx="1.2" fill="currentColor"/><rect x="14.6" y="2.6" width="2.4" height="5" rx="1.2" fill="currentColor"/>
    <path d="M7.4 13.2h2M11 13.2h2M14.6 13.2h2M7.4 16.8h2M11 16.8h2" stroke="${CUT}" stroke-width="1.8" stroke-linecap="round"/>`,
  share: `<path d="M8.4 10.8l7.2-3.9M8.4 13.2l7.2 3.9" ${STROKE} stroke-width="2.2"/>
    <circle cx="17.8" cy="5.6" r="3.1" fill="currentColor"/><circle cx="6" cy="12" r="3.1" fill="currentColor"/><circle cx="17.8" cy="18.4" r="3.1" fill="currentColor"/>`,
  info: `<circle cx="12" cy="12" r="9.2" ${STROKE} stroke-width="2.4"/>
    <rect x="10.8" y="10.2" width="2.4" height="7.2" rx="1.2" fill="currentColor"/><circle cx="12" cy="7.1" r="1.5" fill="currentColor"/>`,
  gift: `<rect x="3.4" y="8.6" width="17.2" height="4.6" rx="1.3" fill="currentColor"/>
    <path d="M5 13.2h14v6.6a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 19.8z" fill="currentColor"/>
    <path d="M12 8.6v12.8" stroke="${CUT}" stroke-width="2.4"/>
    <path d="M12 8.6C10.4 4.8 6.4 4.2 6.4 6.6c0 1.6 2.6 2 5.6 2zm0 0c1.6-3.8 5.6-4.4 5.6-2 0 1.6-2.6 2-5.6 2z" ${STROKE} stroke-width="2"/>`,
  globe: `<circle cx="12" cy="12" r="9" ${STROKE} stroke-width="2.2"/>
    <path d="M3.4 12h17.2M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" ${STROKE} stroke-width="2"/>`,
  shield: `<path d="M12 2.8 4.6 5.6v6c0 4.6 3.1 8.2 7.4 9.6 4.3-1.4 7.4-5 7.4-9.6v-6z" fill="currentColor"/>
    <path d="M8.6 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="${CUT}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  doc: `<path d="M6.4 2.8h7.4l4.8 4.8v12a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8v-15a1.8 1.8 0 0 1 1.8-1.8z" fill="currentColor"/>
    <path d="M13.8 2.8v4.8h4.8" fill="${CUT}"/><path d="M8 12h8M8 15.4h8M8 18.6h5" stroke="${CUT}" stroke-width="1.8" stroke-linecap="round"/>`,
  bell: `<path d="M12 3a6 6 0 0 0-6 6v3.6l-1.7 3.2a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6z" fill="currentColor"/>
    <path d="M9.4 19.2a2.7 2.7 0 0 0 5.2 0z" fill="currentColor"/>`,
  trash: `<path d="M4 6.6h16M9.6 6.2V4.4h4.8v1.8" ${STROKE} stroke-width="2.2"/>
    <path d="M6 8.4h12l-.9 11.2a1.8 1.8 0 0 1-1.8 1.6H8.7a1.8 1.8 0 0 1-1.8-1.6z" fill="currentColor"/>
    <path d="M10 11.6v6M14 11.6v6" stroke="${CUT}" stroke-width="1.8" stroke-linecap="round"/>`,
  flame: `<path d="M12 2.6c.6 3-1.6 4.6-3 6.4C7.5 10.9 6 12.8 6 15.4a6 6 0 0 0 12 0c0-2.8-1.5-4.6-2.6-5.6.1 1.6-.5 2.8-1.6 3.4.4-3.9-.4-7.6-1.8-10.6z" fill="currentColor"/>
    <path d="M12 21.4a3.2 3.2 0 0 1-3.2-3.2c0-1.8 1.3-2.8 2.2-4 .2 1.4 1.4 1.8 2 1.4.4 1.2 2.2 1.6 2.2 2.8a3.2 3.2 0 0 1-3.2 3z" fill="#fff" fill-opacity="0.55"/>`,
  // --- brand ---------------------------------------------------------------------------------
  logo: `<rect x="1.5" y="1.5" width="10" height="10" rx="2.4" fill="url(#g-red)"/><rect x="12.5" y="1.5" width="10" height="10" rx="2.4" fill="url(#g-yellow)"/>
    <rect x="1.5" y="12.5" width="10" height="10" rx="2.4" fill="url(#g-cyan)"/><rect x="12.5" y="12.5" width="10" height="10" rx="2.4" fill="url(#g-purple)"/>
    <rect x="2.6" y="2.3" width="7.8" height="3.8" rx="1.6" fill="url(#g-shine)"/><rect x="13.6" y="2.3" width="7.8" height="3.8" rx="1.6" fill="url(#g-shine)"/>
    <rect x="2.6" y="13.3" width="7.8" height="3.8" rx="1.6" fill="url(#g-shine)"/><rect x="13.6" y="13.3" width="7.8" height="3.8" rx="1.6" fill="url(#g-shine)"/>`,
};

/** Every icon name (for tests / part-B pickers). */
export const ICON_NAMES = Object.freeze(Object.keys(SYMBOLS));

/**
 * Inserts the sprite once (call at boot, before any icon is shown). The sprite is kept in the
 * render tree (zero-size, not display:none) so gradient references resolve everywhere.
 * @param {Document} [doc]
 */
export function installIcons(doc = document) {
  if (doc.getElementById('icon-sprite')) return;
  const symbols = Object.keys(SYMBOLS)
    .map((name) => `<symbol id="i-${name}" viewBox="0 0 24 24">${SYMBOLS[name]}</symbol>`)
    .join('');
  const wrap = doc.createElement('div');
  wrap.innerHTML = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${DEFS}</defs>${symbols}</svg>`;
  doc.body.insertBefore(wrap.firstChild, doc.body.firstChild);
}

/**
 * Markup of one icon.
 * @param {string} name icon name, or 'gem' together with `gemType`
 * @param {string} [cls] extra classes
 * @param {1|2|3} [gemType] for name 'gem'
 * @returns {string}
 */
export function icon(name, cls = '', gemType = 0) {
  const id = name === 'gem' ? `gem${gemType}` : name;
  return `<svg class="ico ico--${id}${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`;
}
