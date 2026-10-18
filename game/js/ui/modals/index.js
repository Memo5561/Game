// All modal definitions (registered with the ModalStack at boot). Part B adds dailyReward,
// notifAsk and levelUp here.

import { pauseModal } from './pause.js';
import { confirmModal } from './confirm.js';
import { reviveModal } from './revive.js';
import { gameoverModal } from './gameover.js';
import { levelResultModal } from './levelresult.js';
import { boosterModal } from './booster.js';

export const MODALS = [pauseModal, confirmModal, reviveModal, gameoverModal, levelResultModal, boosterModal];
