// E2E: synthesized audio (game/js/audio/*).
// Renders every sound effect and a music excerpt offline through the real master chain in headless
// Chromium (no clipping, no NaN/DC, click-free edges, loudness windows, polyphony, music variety)
// and exercises the live Sfx API (locked → unlock via a real click → play/spam → music on/off →
// suspend/resume → no node leaks; plus a page without WebAudio). Throws on any failed check.
// Run: node tests/e2e/run.mjs audio      (full report with WAVs: node tools/audio-check.mjs)
import { runAudioCheck, formatReport } from '../../tools/audio-check.mjs';

export default async function audioSpec() {
  const report = await runAudioCheck({ wav: false, musicSeconds: 15, planMinutes: 10, live: true, quick: true });
  if (report.failures.length) {
    throw new Error(
      `${report.failures.length} audio check(s) failed:\n  - ${report.failures.join('\n  - ')}\n\n${formatReport(report)}`,
    );
  }
}
