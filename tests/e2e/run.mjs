// Minimal e2e runner: executes every tests/e2e/*.spec.mjs (default export = async test function).
// Usage: node tests/e2e/run.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.spec.mjs') && f.includes(filter))
  .sort();

let failed = 0;
for (const f of files) {
  const started = Date.now();
  try {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    await mod.default();
    console.log(`✔ ${f} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.error(`✘ ${f}\n${e && e.stack ? e.stack : e}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} e2e specs passed`);
process.exit(failed ? 1 : 0);
