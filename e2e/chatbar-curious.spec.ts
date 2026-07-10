import { test, expect, ElectronApplication, Page, Locator } from '@playwright/test';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { launchApp, findWindow } from './helpers';

// CLA-27 diagnostic + regression: opening the chatbar (Cmd+Shift+Space) must
// drive the pet idle → curious and hold it while the bar is open. Because
// bubbles are suppressed while chat is open (CLA-13), the sprite is the ONLY
// visible cue — so this test verifies BOTH that the mood flips to curious AND
// that the rendered sprite actually changes substantially. A flag flip with an
// unchanged-looking sprite is a false pass, so we compare the actual pixels.
//
// The rendered mood lives on .lobster-container as a `state-*` class
// (moodToState: idle → state-idle, curious → state-snip). We wait on that class
// rather than a fixed sleep: in the dev server the chatbar's first paint (which
// gates Electron's ready-to-show → show → pet-ui-visibility) can take a few
// seconds, whereas the packaged app paints fast.
//
// Gotcha: if a *foreign* Vite is already on :5173 (another clawster checkout),
// Playwright reuses it and this app loads that checkout's sprite instead — the
// pixel-diff assertion below will (correctly) fail against the wrong renderer.
// Run this checkout's own renderer, e.g. `VITE_DEV_PORT=5273 npm run test:e2e`
// with a matching `vite --port 5273`.

const EVIDENCE_DIR = path.join(__dirname, '..', 'test-results', 'chatbar-curious');
const STATE_TIMEOUT = 15000;
// The curious pose (lean + big eyes + raised claws + "oh" mouth) repaints a
// large share of the sprite. Idle self-animation (breathe/bob) moves only a few
// percent, so a threshold well above that cleanly separates a real pose change
// from a false pass where both frames still look like idle.
const MIN_DIFF_FRACTION = 0.1;

let app: ElectronApplication;
let pet: Page;

async function readPetState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.lobster-container');
    return el ? el.className : '(no .lobster-container)';
  });
}

function moodFromState(className: string): string {
  if (/\bstate-snip\b/.test(className)) return 'curious';
  if (/\bstate-idle\b/.test(className)) return 'idle';
  return `other(${className})`;
}

// Fraction of pixels that differ between two same-size PNG buffers.
function diffFraction(aBuf: Buffer, bBuf: Buffer): number {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const changed = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.15 });
  return changed / (width * height);
}

test.beforeAll(async () => {
  app = await launchApp();
  pet = await findWindow(app, 'pet.html');
  await pet.waitForSelector('.lobster-container.state-idle', { timeout: STATE_TIMEOUT });
});

test.afterAll(async () => {
  await app.close();
});

test.describe('chatbar → curious mood (CLA-27)', () => {
  test('opening the chatbar visibly and substantially changes the sprite', async () => {
    const lobster: Locator = pet.locator('.lobster-container');

    // Baseline: pet is idle. Screenshot the lobster element itself.
    expect(moodFromState(await readPetState(pet))).toBe('idle');
    const beforeBuf = await lobster.screenshot({ path: path.join(EVIDENCE_DIR, 'before-idle.png') });

    // Fire the exact IPC path Cmd+Shift+Space triggers: toggle-chatbar →
    // toggleChatbarWindow() → chatbar 'show' → main broadcasts pet-ui-visibility.
    await pet.evaluate(() => (window as any).clawster.toggleChatbar());

    // The pet must actually render curious (state-snip), not just receive an event.
    await pet.waitForSelector('.lobster-container.state-snip', { timeout: STATE_TIMEOUT });
    // Let the held pose settle (transforms applied) before capturing.
    await pet.waitForTimeout(400);

    // (1) Assert the mood is curious at the exact moment we capture the after shot.
    expect(moodFromState(await readPetState(pet))).toBe('curious');
    const afterBuf = await lobster.screenshot({ path: path.join(EVIDENCE_DIR, 'after-chatbar-open.png') });

    // (2) Confirm the sprite pixels actually differ substantially — not just a
    // flag. A subtle pose that looks like idle would fail here.
    const frac = diffFraction(beforeBuf, afterBuf);
    console.log(`[curious-diagnostic] idle→curious sprite pixel-diff fraction: ${(frac * 100).toFixed(1)}%`);
    expect(frac).toBeGreaterThan(MIN_DIFF_FRACTION);
  });

  test('curious holds while the chatbar stays open', async () => {
    await pet.waitForTimeout(2500);
    expect(moodFromState(await readPetState(pet))).toBe('curious');
  });

  test('pet returns to idle when the chatbar closes', async () => {
    await pet.evaluate(() => (window as any).clawster.closeChatbar());
    await pet.waitForSelector('.lobster-container.state-idle', { timeout: STATE_TIMEOUT });
    expect(moodFromState(await readPetState(pet))).toBe('idle');
  });
});
