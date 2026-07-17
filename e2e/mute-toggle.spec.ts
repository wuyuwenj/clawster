import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchApp, findWindow, isProd } from './helpers';

// CLA-52: the Assistant "Mute Clawster's voice" switch must actually silence the
// Animalese voice engine, which lives in the *pet-chat* renderer — a different
// window from the one holding the switch. This drives the real IPC path an end
// user hits (click → update-settings → store → pet-muted-changed broadcast) and
// counts the sampled-clip playbacks the v2 engine really attempts (one
// AudioBufferSourceNode.start() per voiced character, see CLA-53).

const EVIDENCE_DIR =
  process.env.MUTE_EVIDENCE_DIR || path.join(__dirname, '..', 'test-results', 'mute-toggle');

const MUTE_LABEL = "Mute Clawster's voice";
const SPEECH_MS_PER_CHAR = 60; // AnimaleseEngine default speed

// The window.__clawsterVoice hook this suite depends on is dev-only (gated on
// import.meta.env.DEV in animalese.ts), so the packaged app never exposes it.
// File-level so beforeAll (which seeds the voice bank through the hook) is
// skipped too; mute coverage in prod mode stays with test/mute-toggle.test.ts.
test.skip(isProd(), 'Animalese e2e hook (window.__clawsterVoice) is dev-only');

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

/**
 * Count every sampled-clip playback the Animalese engine attempts from now on.
 * Installed as an init script so the patch is in place before any renderer code
 * runs, and the real start() is swallowed so this suite never makes a sound —
 * even on a private checkout that bundles the real voice clips.
 */
async function instrumentAudio(application: ElectronApplication): Promise<void> {
  await application.context().addInitScript(() => {
    const w = window as any;
    w.__voiceStarts = 0;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const original = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function patched(this: AudioContext) {
      const source = original.call(this);
      source.start = () => {
        w.__voiceStarts += 1;
      };
      return source;
    };
  });
}

/**
 * A public checkout bundles no voice clips (private, gitignored assets), so the
 * engine degrades to silence and playback attempts would be unobservable. Seed
 * the live engine with a one-sample silent buffer per letter and mark the bank
 * loaded, so unmuted playback is observable — and inaudible — on any checkout.
 */
async function injectSilentVoiceBank(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = (window as any).__clawsterVoice;
    if (!engine) throw new Error('Animalese e2e hook (window.__clawsterVoice) missing');
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const silent = new Ctx().createBuffer(1, 1, 8000);
    const bank = new Map<string, AudioBuffer>();
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') bank.set(ch, silent);
    engine.voiceBank = bank;
    engine.bankLoaded = true; // never fetch/decode the real clips
  });
}

async function voiceStarts(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__voiceStarts as number);
}

async function resetVoiceStarts(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__voiceStarts = 0;
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
  // Registered before the pet-chat window exists, so its renderer is patched
  // from the first script it runs.
  await instrumentAudio(app);
  pet = await findWindow(app, 'pet.html');
  await pet.waitForSelector('.lobster-container', { timeout: 25000 });

  await pet.evaluate(() => (window as any).clawster.openAssistant());
  assistant = await findWindow(app, 'assistant.html');
  await assistant.getByRole('button', { name: 'Settings' }).click();
  await assistant.locator(`label:has-text("${MUTE_LABEL}")`).waitFor();

  // First bubble creates the pet-chat window; seed its voice bank once it exists.
  await showBubble('Hi');
  petChat = await findWindow(app, 'pet-chat.html');
  await petChat.waitForSelector('text=Hi', { timeout: 15000 });
  await petChat.waitForTimeout(500); // let the first utterance finish
  await injectSilentVoiceBank(petChat);
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

    await resetVoiceStarts(petChat);
    await showBubble('Hello friend');
    await petChat.waitForTimeout('Hello friend'.length * SPEECH_MS_PER_CHAR + 400);

    const played = await voiceStarts(petChat);
    console.log(`[mute-e2e] unmuted playback attempts: ${played}`);
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

    await resetVoiceStarts(petChat);
    await showBubble('Hello friend');
    await petChat.waitForSelector('text=Hello friend', { timeout: 10000 });
    await petChat.waitForTimeout('Hello friend'.length * SPEECH_MS_PER_CHAR + 400);

    // Bubble still shows the words; no clip playback was attempted for them.
    await petChat.screenshot({ path: path.join(EVIDENCE_DIR, '04-pet-chat-muted-bubble.png') });
    const played = await voiceStarts(petChat);
    console.log(`[mute-e2e] muted playback attempts: ${played}`);
    expect(played).toBe(0);
  });

  test('muting mid-utterance cuts the voice off immediately', async () => {
    await setMuteSwitch(false);
    await resetVoiceStarts(petChat);

    const long = 'Clawster keeps talking and talking and talking for quite a while now';
    await showBubble(long);
    await petChat.waitForTimeout(400);

    const beforeMute = await voiceStarts(petChat);
    expect(beforeMute).toBeGreaterThan(0);

    await setMuteSwitch(true);
    await petChat.waitForTimeout(250); // let the broadcast land
    const atMute = await voiceStarts(petChat);
    // The utterance must still have characters left, otherwise this proves nothing.
    expect(atMute).toBeLessThan(long.replace(/[^a-zA-Z]/g, '').length);

    await petChat.waitForTimeout(1500);
    const afterMute = await voiceStarts(petChat);
    console.log(`[mute-e2e] playback attempts: ${beforeMute} at speak → ${atMute} at mute → ${afterMute} after`);
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
