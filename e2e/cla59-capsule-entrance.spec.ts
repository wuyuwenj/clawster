import { test, expect, ElectronApplication, Page, CDPSession } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { launchApp, findWindow } from './helpers';

// CLA-59: the chatbar BrowserWindow is reused across summons — toggle hides it
// and a re-summon just calls .show() — so the React root mounts once and the
// springy `capsuleIn` CSS entrance only ever played on the FIRST summon of an
// app session. This spec summons the chatbar THREE times in one session and
// requires the Light (Tidepool) entrance to replay on every one, counted via
// real `animationstart` events on the capsule. Dark keeps its existing
// behavior: the mount-time animation only, no replay on re-summon.
//
// Evidence: screenshots land in OUTPUT_DIR, and every repaint of the chatbar
// window is captured through a CDP Page.startScreencast session (Playwright's
// recordVideo hangs electron.launch, so it can't be used here). The frames are
// kept as PNGs (frames/) and assembled into a real-time-paced webm clip with
// ffmpeg when available. CAPTURE_EVIDENCE=1 redirects everything to the
// committed .no-mistakes/evidence dir.

const OUTPUT_DIR = process.env.CAPTURE_EVIDENCE === '1'
  ? path.join(__dirname, '..', '.no-mistakes', 'evidence', 'cla59')
  : path.join(__dirname, '..', 'test-results', 'cla59');
const FRAMES_DIR = path.join(OUTPUT_DIR, 'frames');

let app: ElectronApplication;
let driver: Page; // any window with the clawster bridge; used to fire IPC
let chatbar: Page;
let cdp: CDPSession;
let dataDir: string;

// One entry per captured repaint; ts is the CDP wall-clock (seconds).
const frames: { file: string; ts: number }[] = [];

async function toggleChatbar() {
  await driver.evaluate(() => (window as any).clawster.toggleChatbar());
}

async function chatbarVisible(): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w =>
      w.webContents.getURL().includes('chatbar.html'));
    return Boolean(win && win.isVisible());
  });
}

async function waitForChatbarVisible(expected: boolean) {
  await expect
    .poll(() => chatbarVisible(), { timeout: 10000 })
    .toBe(expected);
}

function capsuleInCount(): Promise<number> {
  return chatbar.evaluate(() => (window as any).__capsuleInCount ?? 0);
}

// Assemble the captured frames into a clip paced by their real timestamps, so
// the springy 300ms entrances play back at true speed. Skipped (frames remain
// as evidence) if ffmpeg is unavailable.
function assembleClip() {
  if (frames.length < 2) return;
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${frames[i].file}'`);
    const dur = i + 1 < frames.length
      ? Math.min(1, Math.max(0.02, frames[i + 1].ts - frames[i].ts))
      : 0.5;
    lines.push(`duration ${dur.toFixed(3)}`);
  }
  const listPath = path.join(FRAMES_DIR, 'concat.txt');
  fs.writeFileSync(listPath, lines.join('\n'));
  const outFile = path.join(OUTPUT_DIR, 'cla59-entrance-replay.webm');
  try {
    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', outFile,
    ], { stdio: 'ignore' });
    console.log(`[cla59] clip: ${outFile} (${frames.length} frames)`);
  } catch {
    console.log(`[cla59] ffmpeg unavailable — frames kept in ${FRAMES_DIR}`);
  }
}

test.beforeAll(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla59-'));
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      permissionDeclines: { hintShown: true },
      appearance: { theme: 'light' }, // the Tidepool entrance is Light-only
    }),
  );
  app = await launchApp({ dataDir });
  driver = await app.firstWindow();
  await driver.waitForLoadState('domcontentloaded');
  await driver.waitForFunction(() => Boolean((window as any).clawster?.toggleChatbar));
});

test.afterAll(async () => {
  await cdp?.send('Page.stopScreencast').catch(() => {});
  await app?.close();
  assembleClip();
});

// The summons build on one shared app session (that's the whole point: the
// bug only exists because the session reuses the window), so run serially and
// skip the rest on a failure instead of restarting the worker without state.
test.describe.configure({ mode: 'serial' });

test.describe('chatbar capsule entrance replays on every summon (CLA-59)', () => {
  test('summon 1: capsule mounts with the entrance animation', async () => {
    await toggleChatbar();
    chatbar = await findWindow(app, 'chatbar.html');
    await chatbar.locator('[data-tidepool="capsule"]').waitFor({ state: 'visible' });
    await waitForChatbarVisible(true);

    // Record every repaint of the chatbar window from here on — this is the
    // motion evidence for summons 2 and 3.
    cdp = await chatbar.context().newCDPSession(chatbar);
    cdp.on('Page.screencastFrame', (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = path.join(FRAMES_DIR, `frame-${String(frames.length).padStart(4, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
      frames.push({ file, ts: frame.metadata.timestamp ?? 0 });
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1300, maxHeight: 600 });

    // Count every capsuleIn start from here on. The mount-time run may already
    // have finished before this listener attaches, so summon 1 is asserted via
    // the animation being defined on the element (mount behavior is not the
    // bug); summons 2 and 3 are asserted via live animationstart events.
    await chatbar.evaluate(() => {
      (window as any).__capsuleInCount = 0;
      (window as any).__chatbarShownEvents = 0;
      (window as any).clawster.onChatbarShown?.(() => {
        (window as any).__chatbarShownEvents += 1;
      });
      document.addEventListener(
        'animationstart',
        (e) => {
          if ((e as AnimationEvent).animationName === 'capsuleIn') {
            (window as any).__capsuleInCount += 1;
          }
        },
        true,
      );
    });

    const animationName = await chatbar
      .locator('[data-tidepool="capsule"]')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toContain('capsuleIn');
    await chatbar.screenshot({ path: path.join(OUTPUT_DIR, 'summon-1.png') });
  });

  for (const summon of [2, 3]) {
    test(`summon ${summon}: entrance replays after hide + re-show`, async () => {
      const before = await capsuleInCount();

      await toggleChatbar(); // hide
      await waitForChatbarVisible(false);
      await toggleChatbar(); // re-summon: reused window, .show() only
      await waitForChatbarVisible(true);

      // The bug: the window is reused, nothing remounts, capsuleIn never
      // restarts — this poll times out on the unfixed parent (count stays 0).
      try {
        await expect
          .poll(() => capsuleInCount(), {
            timeout: 5000,
            message: `capsuleIn must restart on summon ${summon} (reused-window bug: it only played on mount)`,
          })
          .toBeGreaterThan(before);
      } catch (err) {
        const diag = await chatbar.evaluate(() => ({
          shownEvents: (window as any).__chatbarShownEvents,
          theme: document.documentElement.dataset.theme,
          styleAttr: document.querySelector('[data-tidepool="capsule"]')?.getAttribute('style'),
          hasBridge: Boolean((window as any).clawster?.onChatbarShown),
        }));
        console.log(`[cla59] summon ${summon} FAILURE diagnostics:`, JSON.stringify(diag));
        throw err;
      }

      // Grab the springy state while the 300ms run is still fresh, and log the
      // live animation clock as corroborating evidence.
      const anim = await chatbar.evaluate(() => {
        const a = document
          .getAnimations()
          .find((x) => (x as CSSAnimation).animationName === 'capsuleIn');
        return a ? { currentTime: a.currentTime, playState: a.playState } : null;
      });
      console.log(`[cla59] summon ${summon} animation:`, JSON.stringify(anim));
      await chatbar.screenshot({ path: path.join(OUTPUT_DIR, `summon-${summon}.png`) });
    });
  }

  test('dark theme keeps its existing behavior: no replay on re-summon', async () => {
    await chatbar.evaluate(() => (window as any).clawster.updateSettings('appearance.theme', 'dark'));
    await expect
      .poll(() => chatbar.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');

    const before = await capsuleInCount();
    await toggleChatbar(); // hide
    await waitForChatbarVisible(false);
    await toggleChatbar(); // re-summon in dark
    await waitForChatbarVisible(true);

    // Give a wrongly-triggered replay ample time to fire before sampling.
    await chatbar.waitForTimeout(800);
    expect(await capsuleInCount()).toBe(before);
    await chatbar.screenshot({ path: path.join(OUTPUT_DIR, 'dark-resummon.png') });
  });
});
