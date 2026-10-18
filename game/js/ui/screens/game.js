// Game screen: DOM HUD + the board canvas. The GameController (js/app/gamecontroller.js) owns
// everything inside (renderer, drag input, HUD content); this definition only provides the layout.
// Portrait: HUD on top, canvas below (flex: 1). Landscape (body.landscape): HUD as left column.

import { fromHtml } from '../dom.js';

export const gameScreen = {
  id: 'game',

  build() {
    return fromHtml(`<section class="screen--game">
      <header class="hud"></header>
      <div class="stage"><canvas class="board-canvas"></canvas></div>
    </section>`);
  },

  back(app) {
    app.game.back();
    return true;
  },
};
