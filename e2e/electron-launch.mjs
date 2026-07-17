// Single source of truth for the Electron launch audio-safety flags and the
// window finder, shared by the TypeScript e2e helpers (e2e/helpers.ts) and the
// plain-node marketing capture script (scripts/capture-marketing-screenshots.mjs).
// Keeping one copy means hardening the flags here can never drift out of sync
// with the capture run that executes on the captain's live machine.
// Types for TS consumers live alongside in electron-launch.d.mts.

// Audio-safety flags for every Electron/e2e launch (this runs on the captain's
// live machine): mute all output, and hand Chromium a FAKE media device so a
// launch that reaches getUserMedia never opens the real microphone.
export const AUDIO_SAFE_ARGS = [
  '--mute-audio',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

export async function findWindow(app, substr, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch { /* window mid-navigation */ }
      if (url.includes(substr)) {
        await w.waitForLoadState('domcontentloaded').catch(() => {});
        return w;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Window matching "${substr}" not found within ${timeout}ms`);
}
