import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, findWindow } from './helpers';

// CLA-52: the Assistant "Mute Clawster's voice" switch must actually silence the
// Animalese voice engine, which lives in the *pet-chat* renderer — a different
// window from the one holding the switch. This drives the real IPC path an end
// user hits (click → update-settings → store → pet-muted-changed broadcast) and
// counts the oscillators the Web Audio engine really starts.

const EVIDENCE_DIR =
  process.env.MUTE_EVIDENCE_DIR || path.join(__dirname, '..', 'test-results', 'mute-toggle');

const MUTE_LABEL = "Mute Clawster's voice";
const SPEECH_MS_PER_CHAR = 60; // AnimaleseEngine default speed

let app: ElectronApplication;
let pet: Page;
let assistant: Page;
let petChat: Page;
let dataDir: string;

function configPath(): string {
  return path.join(dataDir, 'clawster-config.json');
}

function persistedMuted(): unknown {
  const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  return raw?.pet?.muted;
}

async function showBubble(text: string): Promise<void> {
  await pet.evaluate((t) => {
    (window as any).clawster.showPetChat({ id: `mute-e2e-${Date.now()}`, text: t });
  }, text);
}

/** Count every oscillator the Animalese engine starts from now on. */
async function instrumentAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__oscInstrumented) return;
    w.__oscInstrumented = true;
    w.__oscCount = 0;
    const proto = (window.AudioContext || (window as any).webkitAudioContext).prototype;
    const original = proto.createOscillator;
    proto.createOscillator = function patched(this: AudioContext) {
      w.__oscCount += 1;
      return original.call(this);
    };
  });
}

async function oscCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__oscCount as number);
}

async function resetOscCount(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__oscCount = 0;
  });
}

async function setMuteSwitch(on: boolean): Promise<void> {
  const box = assistant.locator(`label:has-text("${MUTE_LABEL}") input[type=checkbox]`);
  if ((await box.isChecked()) !== on) {
    await assistant.locator(`label:has-text("${MUTE_LABEL}")`).click();
  }
  await expect(box).toBeChecked({ checked: on });
}

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-mute-e2e-'));
  // Seed a settled user so onboarding/tutorial don't suppress the pet-chat bubble.
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: new Date().toISOString(), wasInterrupted: false, lastStep: 0 },
    })
  );

  app = await launchApp({ dataDir });
  pet = await findWindow(app, 'pet.html');
  await pet.waitForSelector('.lobster-container', { timeout: 25000 });

  await pet.evaluate(() => (window as any).clawster.openAssistant());
  assistant = await findWindow(app, 'assistant.html');
  await assistant.getByRole('button', { name: 'Settings' }).click();
  await assistant.locator(`label:has-text("${MUTE_LABEL}")`).waitFor();

  // First bubble creates the pet-chat window; instrument it once it exists.
  await showBubble('Hi');
  petChat = await findWindow(app, 'pet-chat.html');
  await petChat.waitForSelector('text=Hi', { timeout: 15000 });
  await petChat.waitForTimeout(500); // let the first utterance finish
  await instrumentAudio(petChat);
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test.describe("Assistant mute toggle silences Clawster's voice (CLA-52)", () => {
  test('mute defaults to off and Clawster speaks out loud', async () => {
    // Untouched → either absent from disk or persisted as the `false` default.
    expect([undefined, false]).toContain(persistedMuted());
    await expect(
      assistant.locator(`label:has-text("${MUTE_LABEL}") input[type=checkbox]`)
    ).not.toBeChecked();

    await assistant
      .locator(`label:has-text("${MUTE_LABEL}")`)
      .screenshot({ path: path.join(EVIDENCE_DIR, '01-toggle-off.png') });

    await resetOscCount(petChat);
    await showBubble('Hello friend');
    await petChat.waitForTimeout('Hello friend'.length * SPEECH_MS_PER_CHAR + 400);

    const played = await oscCount(petChat);
    console.log(`[mute-e2e] unmuted oscillators started: ${played}`);
    expect(played).toBeGreaterThan(0);
  });

  test('turning the switch on persists pet.muted and silences the voice', async () => {
    await setMuteSwitch(true);
    await assistant.waitForTimeout(400); // let the switch transition settle
    const trackColor = await assistant
      .locator(`label:has-text("${MUTE_LABEL}") div.rounded-full`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[mute-e2e] switch track color when on: ${trackColor}`);
    expect(trackColor).toBe('rgb(255, 140, 105)'); // #FF8C69, the "on" accent

    await assistant
      .locator(`label:has-text("${MUTE_LABEL}")`)
      .screenshot({ path: path.join(EVIDENCE_DIR, '02-toggle-on.png') });
    await assistant.screenshot({ path: path.join(EVIDENCE_DIR, '03-settings-panel-muted.png') });

    await expect.poll(() => persistedMuted(), { timeout: 5000 }).toBe(true);

    await resetOscCount(petChat);
    await showBubble('Hello friend');
    await petChat.waitForSelector('text=Hello friend', { timeout: 10000 });
    await petChat.waitForTimeout('Hello friend'.length * SPEECH_MS_PER_CHAR + 400);

    // Bubble still shows the words; no audio was synthesized for them.
    await petChat.screenshot({ path: path.join(EVIDENCE_DIR, '04-pet-chat-muted-bubble.png') });
    const played = await oscCount(petChat);
    console.log(`[mute-e2e] muted oscillators started: ${played}`);
    expect(played).toBe(0);
  });

  test('muting mid-utterance cuts the voice off immediately', async () => {
    await setMuteSwitch(false);
    await resetOscCount(petChat);

    const long = 'Clawster keeps talking and talking and talking for quite a while now';
    await showBubble(long);
    await petChat.waitForTimeout(400);

    const beforeMute = await oscCount(petChat);
    expect(beforeMute).toBeGreaterThan(0);

    await setMuteSwitch(true);
    await petChat.waitForTimeout(250); // let the broadcast land
    const atMute = await oscCount(petChat);
    // The utterance must still have characters left, otherwise this proves nothing.
    expect(atMute).toBeLessThan(long.replace(/[^a-zA-Z]/g, '').length);

    await petChat.waitForTimeout(1500);
    const afterMute = await oscCount(petChat);
    console.log(`[mute-e2e] oscillators: ${beforeMute} at speak → ${atMute} at mute → ${afterMute} after`);
    expect(afterMute).toBe(atMute);
  });

  // `send_notification` reads `pet.muted` straight off the live store to decide
  // Notification({ silent }), so the toggle must land in the running main-process
  // store — not just on disk. (The silent flag itself is asserted in
  // test/mute-toggle.test.ts, where Notification can be stubbed.)
  test('the switch drives the live main-process store the notification gate reads', async () => {
    await setMuteSwitch(true);
    await expect
      .poll(() => pet.evaluate(async () => {
        const s = (await (window as any).clawster.getSettings()) as any;
        return s.pet.muted;
      }), { timeout: 5000 })
      .toBe(true);
    expect(persistedMuted()).toBe(true);

    await setMuteSwitch(false);
    await expect
      .poll(() => pet.evaluate(async () => {
        const s = (await (window as any).clawster.getSettings()) as any;
        return s.pet.muted;
      }), { timeout: 5000 })
      .toBe(false);
    expect(persistedMuted()).toBe(false);
  });
});
