// Entry point: boots the App (see js/app/app.js for the boot order). No top-level await
// (WebView 90 baseline).

import { App } from './app/app.js';

const app = new App();
app.boot().catch((e) => {
  console.error('[main] boot failed', e);
  window.__blockoBooted = true;
});
