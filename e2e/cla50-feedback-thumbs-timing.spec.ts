import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, findWindow } from './helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// CLA-50: the 👍/👎 feedback thumbs in the pet-chat bubble must appear ONLY
// after the assistant response has fully loaded — never over the '...' stream
// placeholder while the response is still arriving.
//
// The pet-chat window is driven entirely by the `chat-message` IPC. ChatBar
// opens the popup with `text: '...'` while the response streams, then commits
// the real text at stream end (reusing the same popup id). We drive those two
// IPC states directly via `window.clawster.showPetChat` — deterministic and
// with no Ollama/cloud dependency — and screenshot each phase as PR evidence:
//   01 — '...' placeholder (response still arriving)  → NO thumbs
//   02 — response fully committed                     → thumbs visible
//   03 — 👍 clicked                                   → feedback sent
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '';

function shot(page: Page, name: string) {
  if (!EVIDENCE_DIR) return Promise.resolve(Buffer.from(''));
  return page.screenshot({ path: path.join(EVIDENCE_DIR, name) });
}

const POPUP_ID = 'cla50-popup';
const FINAL_TEXT = 'All done — opened your notes! 🦞✨';

const goodThumb = (p: Page) => p.getByTitle('Good response');
const badThumb = (p: Page) => p.getByTitle('Wrong response');

let app: ElectronApplication;
let first: Page;
let petChat: Page;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla50-e2e-'));
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      // Onboarding + tutorial complete so showPetChat isn't suppressed.
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      // The first-launch permissions hint fires 5s after main starts and pushes
      // its own chat-popup, which would replace the popup under test and reset
      // feedbackSent mid-assertion. Mark it shown so it never fires.
      permissionDeclines: { hintShown: true },
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

// Opens the pet-chat popup in its streaming placeholder state (text '...').
async function openPlaceholder() {
  await first.evaluate((id) => {
    (window as any).clawster.showPetChat({ id, text: '...', quickReplies: [] });
  }, POPUP_ID);
  petChat = await findWindow(app, 'pet-chat');
  await petChat.locator('.animate-popup-in').waitFor({ state: 'visible' });
}

// Commits the final response text to the SAME popup, as ChatBar does at stream end.
async function commitResponse() {
  await first.evaluate(
    ({ id, text }) => {
      (window as any).clawster.showPetChat({ id, text, quickReplies: ['Thanks!', 'Not now'] });
    },
    { id: POPUP_ID, text: FINAL_TEXT },
  );
}

test('feedback thumbs are hidden until the response fully loads (CLA-50)', async () => {
  // Phase 1 — response still arriving ('...' placeholder): NO thumbs.
  await openPlaceholder();
  await expect(petChat.getByText('...', { exact: true })).toBeVisible();
  await expect(goodThumb(petChat)).toHaveCount(0);
  await expect(badThumb(petChat)).toHaveCount(0);
  await petChat.waitForTimeout(300); // let the reveal/resize settle before the shot
  await shot(petChat, 'cla50-01-loading-no-thumbs.png');

  // Phase 2 — response fully committed: thumbs appear.
  await commitResponse();
  await expect(petChat.getByText(FINAL_TEXT)).toBeVisible();
  await expect(goodThumb(petChat)).toBeVisible();
  await expect(badThumb(petChat)).toBeVisible();
  await petChat.waitForTimeout(300);
  await shot(petChat, 'cla50-02-complete-thumbs-visible.png');

  // Phase 3 — feedback still fires: clicking 👍 records the feedback and both
  // thumbs lock in (disabled), proving the button still works once shown.
  await goodThumb(petChat).click();
  await expect(goodThumb(petChat)).toBeDisabled();
  await expect(badThumb(petChat)).toBeDisabled();
  await shot(petChat, 'cla50-03-feedback-sent.png');
});
