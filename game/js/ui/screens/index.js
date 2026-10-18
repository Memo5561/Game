// All screens of the app (registered with the Router at boot). Part B replaces the placeholder
// definitions of journey / shop / missions / settings / legal with the full screens.

import { homeScreen } from './home.js';
import { gameScreen } from './game.js';
import { journeyScreen } from './journey.js';
import { shopScreen } from './shop.js';
import { missionsScreen } from './missions.js';
import { settingsScreen } from './settings.js';
import { legalScreen } from './legal.js';

export const SCREENS = [homeScreen, gameScreen, journeyScreen, shopScreen, missionsScreen, settingsScreen, legalScreen];
