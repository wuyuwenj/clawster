import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, findWindow } from './helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// CLA-58 expansion: Tidepool is a toggleable LIGHT theme; DARK is the default.
// This spec proves the toggle actually re-paints every user-facing surface in
// BOTH directions (not just a flag flip) by driving each window, screenshotting
// it in dark and in light, and asserting the surface's computed background
// actually changes between themes (and matches the expected value where
// deterministic). The theme is flipped LIVE via updateSettings so this also
// verifies the no-restart live-apply path.
//
// Audio-safety: launchApp sets NODE_ENV=test (mutes Animalese) and passes
// Chromium --mute-audio; the mic is never opened (no speech-start call here).
//
//   CAPTURE_EVIDENCE=1 npx playwright test cla58-themes → writes committed proof
//   plain run → writes to gitignored test-results/cla58-themes/.
const EVIDENCE_DIR = path.join(__dirname, '..', '.no-mistakes', 'evidence', 'cla58-themes');
const CAPTURE_EVIDENCE = process.env.CAPTURE_EVIDENCE === '1';
const OUTPUT_DIR = CAPTURE_EVIDENCE
  ? EVIDENCE_DIR
  : path.join(__dirname, '..', 'test-results', 'cla58-themes');

let app: ElectronApplication;
let first: Page;
let dataDir: string;

async function setTheme(theme: 'dark' | 'light') {
  await first.evaluate((t) => (window as any).clawster.updateSettings('appearance.theme', t), theme);
  // Let the broadcast reach the open windows and the CSS repaint settle.
  await first.waitForTimeout(400);
}

async function settle(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(500);
}

function bgOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.beforeAll(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla58-themes-'));
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      permissionDeclines: { hintShown: true },
      appearance: { theme: 'dark' }, // start dark (the default)
    }),
  );
  app = await launchApp({ dataDir });
  first = await app.firstWindow();
  await first.waitForLoadState('domcontentloaded');
  await first.waitForFunction(() => Boolean((window as any).clawster?.showPetChat));
});

test.afterAll(async () => {
  await app?.close();
});

// Capture one surface in both themes and assert the surface repaints.
async function bothThemes(opts: {
  name: string;
  open: () => Promise<void>;
  windowKey: string;
  surfaceSelector: string;
  expectDark?: string;
  expectLight?: string;
}) {
  await setTheme('dark');
  await opts.open();
  const win = await findWindow(app, opts.windowKey);
  await win.locator(opts.surfaceSelector).first().waitFor({ state: 'visible' });
  await settle(win);
  await win.screenshot({ path: path.join(OUTPUT_DIR, `${opts.name}-dark.png`) });
  const darkBg = await bgOf(win, opts.surfaceSelector);

  await setTheme('light');
  await settle(win);
  await win.screenshot({ path: path.join(OUTPUT_DIR, `${opts.name}-light.png`) });
  const lightBg = await bgOf(win, opts.surfaceSelector);

  console.log(`[cla58-themes] ${opts.name}: dark=${darkBg}  light=${lightBg}`);
  expect(darkBg, `${opts.name} must repaint between themes`).not.toBe(lightBg);
  if (opts.expectDark) expect(darkBg).toBe(opts.expectDark);
  if (opts.expectLight) expect(lightBg).toBe(opts.expectLight);
}

test('chatbar repaints dark↔light', async () => {
  await bothThemes({
    name: 'chatbar',
    open: async () => {
      await first.evaluate(() => (window as any).clawster.toggleChatbar());
    },
    windowKey: 'chatbar',
    surfaceSelector: '[data-tidepool="capsule"]',
    expectDark: 'rgb(15, 15, 15)',
    expectLight: 'rgb(255, 249, 242)',
  });
  await first.evaluate(() => (window as any).clawster.closeChatbar());
});

test('pet-chat bubble repaints dark↔light', async () => {
  await bothThemes({
    name: 'petchat',
    open: async () => {
      await first.evaluate(() =>
        (window as any).clawster.showPetChat({
          id: 'cla58-themes-bubble',
          text: 'Found your notes! Want me to open them? 🦞',
          quickReplies: ['Thanks!', 'Tell me more', 'Not now'],
        }),
      );
    },
    windowKey: 'pet-chat',
    surfaceSelector: '[data-tidepool="bubble"]',
    expectDark: 'rgb(15, 15, 15)',
    expectLight: 'rgb(255, 249, 242)',
  });
});

test('assistant / settings repaints dark↔light', async () => {
  await bothThemes({
    name: 'assistant',
    open: async () => {
      await first.evaluate(() => (window as any).clawster.openAssistant());
    },
    windowKey: 'assistant',
    surfaceSelector: '#root > div',
  });
});

test('right-click context menu repaints dark↔light', async () => {
  await bothThemes({
    name: 'context-menu',
    open: async () => {
      await first.evaluate(() => (window as any).clawster.showPetContextMenu(200, 200));
    },
    windowKey: 'pet-context-menu',
    surfaceSelector: '.menu-card',
  });
});

test('screenshot-question repaints dark↔light', async () => {
  await bothThemes({
    name: 'screenshot-question',
    open: async () => {
      await first.evaluate(() => (window as any).clawster.toggleScreenshotQuestion());
    },
    windowKey: 'screenshot-question',
    surfaceSelector: '.screenshot-wrapper',
  });
  await first.evaluate(() => (window as any).clawster.closeScreenshotQuestion());
});

// Onboarding auto-opens only when onboarding isn't complete, so it gets its own
// fresh (un-onboarded) app instance.
test('onboarding repaints dark↔light', async () => {
  const obDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla58-ob-'));
  fs.writeFileSync(
    path.join(obDir, 'clawster-config.json'),
    JSON.stringify({ permissionDeclines: { hintShown: true }, appearance: { theme: 'dark' } }),
  );
  const obApp = await launchApp({ dataDir: obDir });
  try {
    const win = await findWindow(obApp, 'onboarding');
    await win.waitForLoadState('domcontentloaded');
    const surface = win.locator('#root > div').first();
    await surface.waitFor({ state: 'visible' });
    await settle(win);
    await win.screenshot({ path: path.join(OUTPUT_DIR, 'onboarding-dark.png') });
    const darkBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor);

    await win.evaluate(() => (window as any).clawster.updateSettings('appearance.theme', 'light'));
    await win.waitForTimeout(400);
    await settle(win);
    await win.screenshot({ path: path.join(OUTPUT_DIR, 'onboarding-light.png') });
    const lightBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor);

    console.log(`[cla58-themes] onboarding: dark=${darkBg}  light=${lightBg}`);
    expect(darkBg, 'onboarding must repaint between themes').not.toBe(lightBg);
  } finally {
    await obApp.close();
  }
});
