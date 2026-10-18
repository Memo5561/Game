// All modal definitions (registered with the ModalStack at boot).
// Run modals (part A): pause, confirm, revive, gameover, levelResult, booster.
// Meta modals (part B): dailyReward, levelUp, notifAsk, levelStart, purchasePending, langPicker.

import { pauseModal } from './pause.js';
import { confirmModal } from './confirm.js';
import { reviveModal } from './revive.js';
import { gameoverModal } from './gameover.js';
import { levelResultModal } from './levelresult.js';
import { boosterModal } from './booster.js';
import { dailyRewardModal } from './dailyreward.js';
import { levelUpModal } from './levelup.js';
import { notifAskModal } from './notifask.js';
import { levelStartModal } from './levelstart.js';
import { purchasePendingModal } from './purchasepending.js';
import { langPickerModal } from './langpicker.js';

export const MODALS = [
  pauseModal, confirmModal, reviveModal, gameoverModal, levelResultModal, boosterModal,
  dailyRewardModal, levelUpModal, notifAskModal, levelStartModal, purchasePendingModal, langPickerModal,
];
