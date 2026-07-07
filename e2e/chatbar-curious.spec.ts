import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import { launchApp, findWindow } from './helpers';

// CLA-27 diagnostic + regression: opening the chatbar (Cmd+Shift+Space) must
// drive the pet idle → curious and hold it while the bar is open. Because
// bubbles are suppressed while chat is open (CLA-13), the sprite is the ONLY
// visible cue — so we read the pet's actual rendered state and screenshot it.
//
// The rendered mood lives on .lobster-container as a `state-*` class
// (moodToState: idle → state-idle, curious → state-snip). We wait on that class
// rather than a fixed sleep: in the dev server the chatbar's first paint (which
// gates Electron's ready-to-show → show → pet-ui-visibility) can take a few
// seconds, whereas the packaged app paints fast.

const EVIDENCE_DIR = path.join(__dirname, '..', 'test-results', 'chatbar-curious');
const STATE_TIMEOUT = 15000;

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

test.beforeAll(async () => {
  app = await launchApp();
  pet = await findWindow(app, 'pet.html');
  await pet.waitForSelector('.lobster-container.state-idle', { timeout: STATE_TIMEOUT });
});

test.afterAll(async () => {
  await app.close();
});

test.describe('chatbar → curious mood (CLA-27)', () => {
  test('pet visibly becomes curious when the chatbar opens', async () => {
    // Baseline: pet is idle before the chatbar opens.
    const beforeMood = moodFromState(await readPetState(pet));
    await pet.screenshot({ path: path.join(EVIDENCE_DIR, 'before-idle.png') });
    expect(beforeMood).toBe('idle');

    // Fire the exact IPC path Cmd+Shift+Space triggers: toggle-chatbar →
    // toggleChatbarWindow() → chatbar 'show' → main broadcasts pet-ui-visibility.
    await pet.evaluate(() => (window as any).clawster.toggleChatbar());

    // The pet must actually render curious (state-snip), not just receive an event.
    await pet.waitForSelector('.lobster-container.state-snip', { timeout: STATE_TIMEOUT });
    await pet.screenshot({ path: path.join(EVIDENCE_DIR, 'after-chatbar-open.png') });
    expect(moodFromState(await readPetState(pet))).toBe('curious');
  });

  test('curious holds while the chatbar stays open', async () => {
    // A beat later the pet must still read curious (not revert to idle).
    await pet.waitForTimeout(2500);
    expect(moodFromState(await readPetState(pet))).toBe('curious');
  });

  test('pet returns to idle when the chatbar closes', async () => {
    await pet.evaluate(() => (window as any).clawster.closeChatbar());
    await pet.waitForSelector('.lobster-container.state-idle', { timeout: STATE_TIMEOUT });
    expect(moodFromState(await readPetState(pet))).toBe('idle');
  });
});
