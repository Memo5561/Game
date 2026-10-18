// Public audio API of the game (contract: docs/ARCHITECTURE.md §4.13).
//
// All sound is synthesized with WebAudio – no audio files. This module owns the lifecycle of the
// single live AudioContext (lazy creation, unlock on user gesture, app background/foreground,
// tab visibility) and the music lookahead timer; the audio graph itself lives in mixer.js and the
// sound design in sounds.js / music.js.
//
// Robustness rules: nothing here ever throws. Without WebAudio every call is a silent no-op;
// play() before unlock() (or while the app is in the background) is a no-op too.
//
// Usage (UI):
//   Sfx.init();                                   // at boot
//   addEventListener('pointerup', () => Sfx.unlock(), { once: true });  // (also done internally)
//   Sfx.setSoundEnabled(save.settings.sound); Sfx.setMusicEnabled(save.settings.music);
//   Sfx.startMusic();                             // starts as soon as audio is unlocked
//   Sfx.play('clear', { lines: 2, combo: 3 });
//   Platform.on('pause', () => Sfx.suspend()); Platform.on('resume', () => Sfx.resume());

import { Mixer } from './mixer.js';

export { renderToContext, SOUND_NAMES } from './sounds.js';
export { Mixer, MIX, MAX_VOICES } from './mixer.js';
export { MusicPlanner, renderMusicEvent, MUSIC_BPM } from './music.js';
export { nodeStats } from './synth.js';

/** Music is scheduled this far ahead (s) – generous, so timer jitter never causes gaps. */
const LOOKAHEAD = 1.6;
const TICK_MS = 300;
/** Fade-in of the master level when returning from the background (s). */
const RESUME_FADE = 0.35;

const state = {
  ctx: null,
  mixer: null,
  failed: false, // WebAudio unavailable or broken → stay silent forever
  unlocked: false,
  soundOn: true,
  musicOn: true,
  musicWanted: false, // startMusic() called and not stopped
  appPaused: false, // suspend() called (app in background)
  hidden: false, // document hidden (tab / WebView not visible)
  resumePending: false,
  suspendedByUs: false,
  timer: 0,
  listeners: false,
};

function getAudioContextClass() {
  try {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  } catch (e) {
    return null;
  }
}

/** Creates the AudioContext + mixer once. Returns true when audio is available. */
function ensureContext() {
  if (state.ctx) return true;
  if (state.failed) return false;
  const AC = getAudioContextClass();
  if (!AC) {
    state.failed = true;
    return false;
  }
  let ctx = null;
  try {
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      ctx = new AC(); // older WebViews: no options argument
    }
    state.mixer = new Mixer(ctx);
    state.ctx = ctx;
    try { ctx.onstatechange = sync; } catch (e) { /* optional */ }
    return true;
  } catch (e) {
    state.failed = true;
    state.mixer = null;
    state.ctx = null;
    try { if (ctx && ctx.close) ctx.close(); } catch (e2) { /* ignore */ }
    return false;
  }
}

function isActive() {
  return state.unlocked && !state.appPaused && !state.hidden;
}

/** Resumes the context. `fromGesture` retries even if an earlier resume() is still pending. */
function resumeContext(fromGesture) {
  const ctx = state.ctx;
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  if (state.resumePending && !fromGesture) return;
  state.resumePending = true;
  const done = () => {
    state.resumePending = false;
    sync();
  };
  try {
    const p = ctx.resume();
    if (p && typeof p.then === 'function') p.then(done, done);
    else done();
  } catch (e) {
    state.resumePending = false;
  }
}

function suspendContext() {
  const ctx = state.ctx;
  if (!ctx || ctx.state !== 'running') return;
  try {
    state.mixer.stopAllSfx();
    state.suspendedByUs = true;
    const p = ctx.suspend();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* ignore */ }
}

/** Plays a 1-sample silent buffer: older WebViews only unlock audio after a buffer played. */
function playSilentBuffer() {
  try {
    const ctx = state.ctx;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => {
      try { src.disconnect(); } catch (e) { /* ignore */ }
    };
    src.start(0);
  } catch (e) { /* ignore */ }
}

/** Reconciles context state, music session and scheduler timer with the desired state. */
function sync() {
  const ctx = state.ctx;
  const mixer = state.mixer;
  if (!ctx || !mixer) return;
  try {
    const active = isActive();
    if (active) {
      if (ctx.state !== 'running') resumeContext(false);
      if (state.suspendedByUs) {
        state.suspendedByUs = false;
        mixer.fadeMaster(1, RESUME_FADE, undefined, 0);
      }
    } else if (state.unlocked) {
      suspendContext();
    }
    const musicDesired = state.musicOn && state.musicWanted;
    const playMusic = active && musicDesired;
    if (playMusic && !mixer.musicPlaying) mixer.startMusic();
    else if (!musicDesired && mixer.musicPlaying) mixer.stopMusic();
    // When merely paused/hidden the session is kept: the frozen context resumes it seamlessly.
    setTimer(playMusic);
  } catch (e) { /* never throw */ }
}

function setTimer(on) {
  if (on && !state.timer) {
    state.timer = setInterval(tick, TICK_MS);
    tick();
  } else if (!on && state.timer) {
    clearInterval(state.timer);
    state.timer = 0;
  }
}

function tick() {
  try {
    const { ctx, mixer } = state;
    if (!ctx || !mixer || !mixer.musicPlaying) {
      setTimer(false);
      return;
    }
    mixer.scheduleMusic(ctx.currentTime + LOOKAHEAD);
    mixer.prune();
  } catch (e) { /* ignore */ }
}

function onGesture() {
  if (!state.unlocked || (state.ctx && state.ctx.state !== 'running')) Sfx.unlock();
}

function onVisibility() {
  try {
    state.hidden = document.visibilityState === 'hidden';
  } catch (e) {
    state.hidden = false;
  }
  sync();
}

function installListeners() {
  if (state.listeners || typeof document === 'undefined' || !document.addEventListener) return;
  state.listeners = true;
  const opts = { capture: true, passive: true };
  // pointerup/touchend/keydown/click are "activation-triggering" events (allowed to start audio);
  // pointerdown is included for mouse input.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
    document.addEventListener(type, onGesture, opts);
  }
  document.addEventListener('visibilitychange', onVisibility);
  state.hidden = document.visibilityState === 'hidden';
}

export const Sfx = {
  /**
   * Prepares audio. The AudioContext is created here if the page already had a user gesture,
   * otherwise lazily on the first unlock() (avoids autoplay-policy warnings). Also installs
   * gesture listeners that unlock audio automatically as a safety net.
   * @returns {boolean} false if WebAudio is unavailable
   */
  init() {
    try {
      installListeners();
      const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
      if (!ua || ua.hasBeenActive) ensureContext();
      return !state.failed;
    } catch (e) {
      return false;
    }
  },

  /** Call from a user gesture handler: creates/resumes the AudioContext. Idempotent and cheap. */
  unlock() {
    try {
      if (!ensureContext()) return;
      state.unlocked = true;
      if (!isActive()) return;
      if (state.ctx.state !== 'running') {
        resumeContext(true);
        playSilentBuffer();
      }
      sync();
    } catch (e) { /* ignore */ }
  },

  /** Enables/disables sound effects (disabling also fades out effects that are playing). */
  setSoundEnabled(on) {
    state.soundOn = !!on;
    try {
      if (!state.soundOn && state.mixer) state.mixer.stopAllSfx();
    } catch (e) { /* ignore */ }
  },

  /** Enables/disables background music (user setting; music plays only after startMusic()). */
  setMusicEnabled(on) {
    state.musicOn = !!on;
    sync();
  },

  /**
   * Plays a sound effect. No-op when sound is disabled, audio is locked or unavailable, or the
   * app is in the background. Names and options: see SOUND_NAMES / sounds.js.
   * @param {string} name
   * @param {object} [opts]  e.g. { lines, combo } for 'clear', { level } for 'praise'
   */
  play(name, opts) {
    try {
      if (!state.soundOn || !state.mixer || !isActive()) return;
      const ctx = state.ctx;
      if (ctx.state !== 'running') {
        if (ctx.state === 'closed') return;
        resumeContext(false);
        if (!state.resumePending) return;
      }
      state.mixer.play(name, opts);
    } catch (e) { /* ignore */ }
  },

  /** Requests background music (fades in once audio is unlocked and music is enabled). */
  startMusic() {
    state.musicWanted = true;
    sync();
  },

  /** Fades the background music out. */
  stopMusic() {
    state.musicWanted = false;
    sync();
  },

  /** App went to the background: silence effects and suspend the context (saves battery). */
  suspend() {
    state.appPaused = true;
    sync();
  },

  /** App is back in the foreground: resume the context; music continues if it was playing. */
  resume() {
    state.appPaused = false;
    sync();
  },
};

/** Diagnostics for tests and the debug API. */
export function audioDebugInfo() {
  const info = {
    supported: !state.failed && !!getAudioContextClass(),
    contextState: state.ctx ? state.ctx.state : 'none',
    unlocked: state.unlocked,
    soundEnabled: state.soundOn,
    musicEnabled: state.musicOn,
    musicWanted: state.musicWanted,
    paused: state.appPaused,
    hidden: state.hidden,
    schedulerRunning: !!state.timer,
    sfxVoices: 0,
    sfxActive: 0,
    musicVoices: 0,
    musicPlaying: false,
    liveNodes: 0,
  };
  if (state.mixer) Object.assign(info, state.mixer.stats());
  return info;
}
