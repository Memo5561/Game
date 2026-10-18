// Renders Google Play store graphics from the icon master (game/assets/icon.svg):
//   store/icon-512.png             – Play Store app icon (512x512, full-bleed, Play applies the mask)
//   store/feature-graphic.png      – Play Store feature graphic (1024x500)
// Usage: node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer(0, ROOT);
  const browser = await chromium.launch();
  try {
    // App icon 512x512
    const svg = fs.readFileSync(path.join(ROOT, 'game/assets/icon.svg'), 'utf8')
      .replace('width="1024" height="1024"', 'width="512" height="512"');
    const iconPage = await browser.newPage({ viewport: { width: 512, height: 512 } });
    await iconPage.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await iconPage.screenshot({ path: path.join(OUT, 'icon-512.png'), omitBackground: false });
    await iconPage.close();

    // Feature graphic 1024x500
    const fg = await browser.newPage({ viewport: { width: 1024, height: 500 } });
    await fg.goto(`${server.url}tools/templates/feature-graphic.html`, { waitUntil: 'load' });
    await fg.evaluate(() => document.fonts.ready);
    await fg.screenshot({ path: path.join(OUT, 'feature-graphic.png') });
    await fg.close();

    console.log(`Wrote ${path.relative(ROOT, path.join(OUT, 'icon-512.png'))} and ${path.relative(ROOT, path.join(OUT, 'feature-graphic.png'))}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
