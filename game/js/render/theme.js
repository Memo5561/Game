// Block skins / color themes (docs/ARCHITECTURE.md §4.12).
//
// A theme is pure data: palette, board and background colors, the drawing `style` the sprite
// painter uses for blocks, and the matching DOM colors (`ui`) that `themeCssVars()` exposes as CSS
// custom properties. Prices and unlock levels live in CONFIG.ECONOMY.THEMES – never here.
//
// Palette rules: 8 colors with clearly different hues AND brightness steps so the board stays
// readable for the common color-vision deficiencies (yellow/cyan light, blue/purple/red darker).

import { paintBoardPreview } from './sprites.js';

/**
 * @typedef {Object} Theme
 * @property {string} id
 * @property {string} nameKey             i18n key 'theme.<id>'
 * @property {'jewel'|'neon'|'candy'|'wood'|'pixel'|'gold'} style  block painter
 * @property {string[]} palette           8 base colors (palette index 0..7)
 * @property {Array<[string, string]>} [shades] optional explicit [top, bottom] gradient per color
 * @property {[string, string]} bg        background gradient [top, bottom]
 * @property {string} bgGlow              soft radial glow behind the board
 * @property {number} bgGlowAlpha
 * @property {string} bgPattern           'sparkle'|'grid'|'dots'|'planks'|'stars'|'deco'
 * @property {string} board               board panel fill
 * @property {string} boardEdge           board panel rim
 * @property {string} cellEmpty           empty cell fill
 * @property {string} cellEmptyEdge       empty cell highlight edge
 * @property {string} accent              primary accent (buttons, highlights)
 * @property {string} accent2             secondary accent
 * @property {string} text                main text color
 * @property {string} textDim
 * @property {string} textStroke          outline of canvas texts (praise, points…)
 * @property {string} greyTint            tint of greyed-out blocks (game over / dimmed pieces)
 * @property {number} ghostAlpha          opacity of the drop preview
 * @property {boolean} dark               dark UI (light text) or light UI
 * @property {number} fxGlow              strength of additive glow effects (lower on light themes)
 * @property {Object<string, string>} ui  DOM colors, see themeCssVars()
 */

const F = Object.freeze;

/** Ordered theme ids (shop order). */
export const THEME_IDS = F(['jewel', 'neon', 'candy', 'wood', 'pixel', 'gold']);

/** Default theme id. */
export const DEFAULT_THEME = 'jewel';

/** @type {Readonly<Record<string, Readonly<Theme>>>} */
export const THEMES = F({
  // Glossy gems on deep indigo – matches the app icon and store graphics.
  jewel: F({
    id: 'jewel',
    nameKey: 'theme.jewel',
    style: 'jewel',
    palette: F(['#F0405A', '#FF8A2A', '#FFC72C', '#2FCB72', '#2FB6F0', '#5470FF', '#9D5BF0', '#FF5CC0']),
    shades: F([
      F(['#FF7A86', '#E02A45']), F(['#FFB877', '#F2710F']), F(['#FFE57A', '#F5A800']), F(['#7DF0A8', '#1DB863']),
      F(['#7FE3FF', '#0F95E0']), F(['#8FA2FF', '#3A55F0']), F(['#C79BFF', '#7A2FE6']), F(['#FF9EE0', '#E8329F']),
    ]),
    bg: F(['#3B2A9E', '#1B1446']),
    bgGlow: '#7B5CFF',
    bgGlowAlpha: 0.45,
    bgPattern: 'sparkle',
    board: '#140F3A',
    boardEdge: '#2C2373',
    cellEmpty: '#1E1750',
    cellEmptyEdge: '#2A2168',
    accent: '#FFD23F',
    accent2: '#7B5CFF',
    text: '#FFFFFF',
    textDim: '#B8B0EC',
    textStroke: '#1A0F4A',
    greyTint: '#6F69A8',
    ghostAlpha: 0.42,
    fxGlow: 1,
    dark: true,
    ui: F({
      panel: '#2A1F7A', panelEdge: '#4A3BB8', overlay: 'rgba(12,8,40,0.72)',
      btn: '#2FCB72', btnText: '#FFFFFF', btnShadow: '#178A4A',
      btn2: '#5470FF', btn2Text: '#FFFFFF', btn2Shadow: '#2B3BB0',
      good: '#2FCB72', danger: '#F0405A', coin: '#FFC72C',
    }),
  }),

  // Dark synthwave grid, hollow glowing tubes.
  neon: F({
    id: 'neon',
    nameKey: 'theme.neon',
    style: 'neon',
    palette: F(['#FF3864', '#FF8C1A', '#FFE53B', '#3DFF6E', '#19E6FF', '#3D7BFF', '#B347FF', '#FF3DD8']),
    bg: F(['#14082E', '#05030C']),
    bgGlow: '#FF2BD6',
    bgGlowAlpha: 0.22,
    bgPattern: 'grid',
    board: '#07051A',
    boardEdge: '#19E6FF',
    cellEmpty: '#0D0A26',
    cellEmptyEdge: '#1B1648',
    accent: '#19E6FF',
    accent2: '#FF3DD8',
    text: '#F2F6FF',
    textDim: '#9AA3D8',
    textStroke: '#120530',
    greyTint: '#5A5F8A',
    ghostAlpha: 0.5,
    fxGlow: 1,
    dark: true,
    ui: F({
      panel: '#120A30', panelEdge: '#19E6FF', overlay: 'rgba(4,2,14,0.78)',
      btn: '#FF3DD8', btnText: '#FFFFFF', btnShadow: '#8A1475',
      btn2: '#19E6FF', btn2Text: '#05121A', btn2Shadow: '#0B7C8C',
      good: '#3DFF6E', danger: '#FF3864', coin: '#FFE53B',
    }),
  }),

  // Pastel sweets on a light pink-lavender sky.
  candy: F({
    id: 'candy',
    nameKey: 'theme.candy',
    style: 'candy',
    palette: F(['#FF6B8B', '#FFA25C', '#FFD95C', '#5FD99A', '#5CC8FF', '#7F8CFF', '#B97CFF', '#FF85D5']),
    bg: F(['#FFD9EE', '#C3B5FF']),
    bgGlow: '#FFFFFF',
    bgGlowAlpha: 0.55,
    bgPattern: 'dots',
    board: '#F7EEFF',
    boardEdge: '#FFFFFF',
    cellEmpty: '#E9DDF7',
    cellEmptyEdge: '#FFFFFF',
    accent: '#FF5FA2',
    accent2: '#7C5CFF',
    text: '#4B2C6B',
    textDim: '#8A6FA6',
    textStroke: '#6E2A68',
    greyTint: '#B9A9D6',
    ghostAlpha: 0.45,
    fxGlow: 0.45,
    dark: false,
    ui: F({
      panel: '#FFFFFF', panelEdge: '#F1D8FF', overlay: 'rgba(80,40,110,0.45)',
      btn: '#FF5FA2', btnText: '#FFFFFF', btnShadow: '#C93A79',
      btn2: '#7C5CFF', btn2Text: '#FFFFFF', btn2Shadow: '#5236C9',
      good: '#3CC487', danger: '#F0466B', coin: '#FFB300',
    }),
  }),

  // Stained wooden blocks on a maple board in a walnut frame.
  wood: F({
    id: 'wood',
    nameKey: 'theme.wood',
    style: 'wood',
    palette: F(['#D2452F', '#EA8A2E', '#F4C64E', '#7BAE3E', '#2FA39C', '#4677C4', '#9459B0', '#F1DDB0']),
    bg: F(['#6B4528', '#2A170B']),
    bgGlow: '#FFB45C',
    bgGlowAlpha: 0.22,
    bgPattern: 'planks',
    board: '#3A2112',
    boardEdge: '#7A4B26',
    cellEmpty: '#4E3220',
    cellEmptyEdge: '#6A4630',
    accent: '#FFC857',
    accent2: '#E07A3F',
    text: '#FFF4E0',
    textDim: '#E0C3A0',
    textStroke: '#3A1E0C',
    greyTint: '#8A7560',
    ghostAlpha: 0.5,
    fxGlow: 0.75,
    dark: true,
    ui: F({
      panel: '#5A3820', panelEdge: '#8C5A30', overlay: 'rgba(30,15,5,0.7)',
      btn: '#6E9B3A', btnText: '#FFFFFF', btnShadow: '#3F5E1C',
      btn2: '#DE7F2C', btn2Text: '#FFFFFF', btn2Shadow: '#94501A',
      good: '#7DBA45', danger: '#D9473A', coin: '#FFC857',
    }),
  }),

  // Retro 8-bit bevels (pixel art, nearest-neighbour scaled).
  pixel: F({
    id: 'pixel',
    nameKey: 'theme.pixel',
    style: 'pixel',
    palette: F(['#E43B44', '#F77622', '#FEE761', '#63C74D', '#2CE8F5', '#3B6FE0', '#9A4FD0', '#F6757A']),
    bg: F(['#29366F', '#141626']),
    bgGlow: '#41A6F6',
    bgGlowAlpha: 0.18,
    bgPattern: 'stars',
    board: '#10111E',
    boardEdge: '#566C86',
    cellEmpty: '#1E2236',
    cellEmptyEdge: '#2C3250',
    accent: '#FEE761',
    accent2: '#41A6F6',
    text: '#F4F4F4',
    textDim: '#94B0C2',
    textStroke: '#10111E',
    greyTint: '#566C86',
    ghostAlpha: 0.5,
    fxGlow: 0.9,
    dark: true,
    ui: F({
      panel: '#29366F', panelEdge: '#566C86', overlay: 'rgba(16,17,30,0.78)',
      btn: '#63C74D', btnText: '#10111E', btnShadow: '#2E7A3C',
      btn2: '#41A6F6', btn2Text: '#10111E', btn2Shadow: '#285CC4',
      good: '#63C74D', danger: '#E43B44', coin: '#FEE761',
    }),
  }),

  // Cut gemstones in gold bezels on black lacquer.
  gold: F({
    id: 'gold',
    nameKey: 'theme.gold',
    style: 'gold',
    palette: F(['#E0115F', '#FF8F1F', '#FFD447', '#12B76A', '#22C3D6', '#2563EB', '#9B5DE5', '#F472B6']),
    bg: F(['#2A2214', '#050504']),
    bgGlow: '#E9C46A',
    bgGlowAlpha: 0.16,
    bgPattern: 'deco',
    board: '#0A0907',
    boardEdge: '#C9A227',
    cellEmpty: '#15120C',
    cellEmptyEdge: '#2A2416',
    accent: '#F5C84C',
    accent2: '#B8862B',
    text: '#FFF4D6',
    textDim: '#CDB98A',
    textStroke: '#241A04',
    greyTint: '#7A6E55',
    ghostAlpha: 0.45,
    fxGlow: 1,
    dark: true,
    ui: F({
      panel: '#17130C', panelEdge: '#C9A227', overlay: 'rgba(0,0,0,0.75)',
      btn: '#F5C84C', btnText: '#241A04', btnShadow: '#9C7414',
      btn2: '#2A2416', btn2Text: '#F5C84C', btn2Shadow: '#0A0907',
      good: '#12B76A', danger: '#E0115F', coin: '#F5C84C',
    }),
  }),
});

/**
 * @param {string} id
 * @returns {Readonly<Theme>} the theme, or the default theme for unknown ids
 */
export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}

/**
 * CSS custom properties for the DOM UI so menus match the selected block skin.
 * Apply with `for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)`.
 *
 * Provided: --bg-top, --bg-bottom, --accent, --accent-2, --text, --text-dim, --text-stroke,
 * --panel, --panel-edge, --overlay, --btn, --btn-text, --btn-shadow, --btn-2, --btn-2-text,
 * --btn-2-shadow, --good, --danger, --coin, --board, --cell-empty, --glow, --color-0 … --color-7,
 * --scheme ('dark' | 'light', usable as `color-scheme: var(--scheme)`).
 * @param {Theme} theme
 * @returns {Object<string, string>}
 */
export function themeCssVars(theme) {
  const th = theme || THEMES[DEFAULT_THEME];
  const u = th.ui;
  const vars = {
    '--bg-top': th.bg[0],
    '--bg-bottom': th.bg[1],
    '--accent': th.accent,
    '--accent-2': th.accent2,
    '--text': th.text,
    '--text-dim': th.textDim,
    '--text-stroke': th.textStroke,
    '--panel': u.panel,
    '--panel-edge': u.panelEdge,
    '--overlay': u.overlay,
    '--btn': u.btn,
    '--btn-text': u.btnText,
    '--btn-shadow': u.btnShadow,
    '--btn-2': u.btn2,
    '--btn-2-text': u.btn2Text,
    '--btn-2-shadow': u.btn2Shadow,
    '--good': u.good,
    '--danger': u.danger,
    '--coin': u.coin,
    '--board': th.board,
    '--cell-empty': th.cellEmpty,
    '--glow': th.accent,
    '--scheme': th.dark ? 'dark' : 'light',
  };
  th.palette.forEach((c, i) => { vars[`--color-${i}`] = c; });
  return vars;
}

/**
 * Draws a small 4x4 sample board of the theme (shop tile). Uses the canvas' CSS size × device
 * pixel ratio when it has a layout box, otherwise its current pixel size. Synchronous.
 * @param {HTMLCanvasElement} canvas
 * @param {Theme} theme
 */
export function renderThemePreview(canvas, theme) {
  const th = theme || THEMES[DEFAULT_THEME];
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW > 0 && cssH > 0) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintBoardPreview(ctx, canvas.width, canvas.height, th);
}
