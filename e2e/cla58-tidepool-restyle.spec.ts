import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, findWindow } from './helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// CLA-58: restyle the summon chatbar + pet-chat speech bubble to the Tidepool
// direction (warm shell-cream surfaces, 2px ink outline, real coral/teal,
// sticker shadows, springy motion — fully opaque).
//
// A prior UI task falsely passed by asserting a flag while the pixels never
// changed, so this spec is built around committed screenshot evidence:
//
//   CAPTURE_BASELINE=1 npx playwright test cla58  → saves before-*.png of the
//     OLD design into .no-mistakes/evidence/cla58/ (run once, pre-restyle,
//     and commit the result).
//   CAPTURE_EVIDENCE=1 npx playwright test cla58  → refreshes the committed
//     after-*.png / diff-*.png proof in that same tracked directory.
//   npx playwright test cla58                     → saves after-*.png of the
//     NEW design and pixel-diffs each pair. If the restyle is not actually
//     visible (diff fraction below MIN_DIFF_FRACTION), it FAILS.
//
// Only the two capture modes write to the tracked evidence directory. A plain
// run — including `npm run test:e2e`, which sweeps all of e2e/ — writes its
// output to the gitignored test-results/ tree instead, so a routine or CI run
// can never dirty the worktree or silently replace the committed proof.
//
// Both surfaces are driven the same way the app drives them: the chatbar via
// the toggle-chatbar IPC, the bubble via the chat-message IPC (showPetChat),
// so the shots show the real windows, not a storybook.
const EVIDENCE_DIR = path.join(__dirname, '..', '.no-mistakes', 'evidence', 'cla58');
const BASELINE_MODE = process.env.CAPTURE_BASELINE === '1';
const CAPTURE_EVIDENCE = process.env.CAPTURE_EVIDENCE === '1';
const OUTPUT_DIR =
  BASELINE_MODE || CAPTURE_EVIDENCE
    ? EVIDENCE_DIR
    : path.join(__dirname, '..', 'test-results', 'cla58');
// The Tidepool restyle flips near-black slabs to cream — most of both windows
// repaints. Idle rendering noise (caret hidden, no animations at capture time)
// is well under 1%, so 10% cleanly separates a real restyle from a no-op.
const MIN_DIFF_FRACTION = 0.1;

const POPUP_ID = 'cla58-popup';
const BUBBLE_TEXT = 'Found your notes! Want me to open them? 🦞';

let app: ElectronApplication;
let first: Page;
let dataDir: string;

// Pads a PNG onto a white canvas so before/after shots of a content-sized
// window (the bubble resizes to its content) stay comparable — a size change
// counts as a visible diff instead of crashing pixelmatch.
function padTo(src: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, src.width, src.height, 0, 0);
  return out;
}

function diffFraction(beforePath: string, afterPath: string, diffPath: string): number {
  const a = PNG.sync.read(fs.readFileSync(beforePath));
  const b = PNG.sync.read(fs.readFileSync(afterPath));
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pa = padTo(a, width, height);
  const pb = padTo(b, width, height);
  const diff = new PNG({ width, height });
  const changed = pixelmatch(pa.data, pb.data, diff.data, width, height, { threshold: 0.15 });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return changed / (width * height);
}

// Blur focus and freeze the caret so screenshots are deterministic.
async function settleForShot(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(500); // let entrance springs finish (max 450ms)
}

test.beforeAll(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla58-e2e-'));
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      // Onboarding + tutorial complete so showPetChat isn't suppressed.
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      // The first-launch permissions hint fires 5s after main starts and pushes
      // its own chat-popup, which would replace the bubble being screenshotted.
      permissionDeclines: { hintShown: true },
      // Tidepool is now the opt-in Light theme (dark is the default), so this
      // spec — which asserts the cream Tidepool surfaces — runs in Light.
      appearance: { theme: 'light' },
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

test('chatbar wears the Tidepool look and visibly differs from the old slab', async () => {
  await first.evaluate(() => (window as any).clawster.toggleChatbar());
  const chatbar = await findWindow(app, 'chatbar');
  await chatbar.locator('form input[type="text"]').waitFor({ state: 'visible' });
  await settleForShot(chatbar);

  const shotName = BASELINE_MODE ? 'before-chatbar.png' : 'after-chatbar.png';
  await chatbar.screenshot({ path: path.join(OUTPUT_DIR, shotName) });

  if (BASELINE_MODE) return;

  // Programmatic Tidepool checks (supplement, never substitute, the pixels):
  // the capsule surface is shell cream and FULLY OPAQUE, and the input reads
  // at 17px in warm ink.
  const capsule = chatbar.locator('[data-tidepool="capsule"]');
  await expect(capsule).toBeVisible();
  const surface = await capsule.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(surface).toBe('rgb(255, 249, 242)'); // --tp-shell, no alpha channel
  const input = chatbar.locator('form input[type="text"]');
  const inputStyle = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, color: s.color };
  });
  expect(inputStyle.fontSize).toBe('17px');
  expect(inputStyle.color).toBe('rgb(74, 43, 38)'); // --tp-text-ink

  const frac = diffFraction(
    path.join(EVIDENCE_DIR, 'before-chatbar.png'),
    path.join(OUTPUT_DIR, 'after-chatbar.png'),
    path.join(OUTPUT_DIR, 'diff-chatbar.png'),
  );
  console.log(`[cla58] chatbar before→after pixel-diff fraction: ${(frac * 100).toFixed(1)}%`);
  expect(frac).toBeGreaterThan(MIN_DIFF_FRACTION);

  // Extra evidence: the 17px warm-ink input text in the rounded face.
  await input.fill('can you find my science notes?');
  await settleForShot(chatbar);
  await chatbar.screenshot({ path: path.join(OUTPUT_DIR, 'after-chatbar-typed.png') });
  await input.fill('');

  await first.evaluate(() => (window as any).clawster.closeChatbar());
});

test('pet-chat bubble wears the Tidepool look and visibly differs from the old panel', async () => {
  await first.evaluate(
    ({ id, text }) => {
      (window as any).clawster.showPetChat({
        id,
        text,
        quickReplies: ['Thanks!', 'Tell me more', 'Not now'],
      });
    },
    { id: POPUP_ID, text: BUBBLE_TEXT },
  );
  const petChat = await findWindow(app, 'pet-chat');
  await petChat.getByText(BUBBLE_TEXT).waitFor({ state: 'visible' });
  await settleForShot(petChat);

  const shotName = BASELINE_MODE ? 'before-petchat.png' : 'after-petchat.png';
  await petChat.screenshot({ path: path.join(OUTPUT_DIR, shotName) });

  if (BASELINE_MODE) return;

  // Hierarchy fix: quick replies must lead; the feedback thumbs shrink to a
  // corner BELOW them. Compare vertical positions of a reply chip and the 👍
  // button.
  const replyChip = petChat.getByRole('button', { name: 'Thanks!' });
  const goodThumb = petChat.getByTitle('Good response');
  await expect(replyChip).toBeVisible();
  await expect(goodThumb).toBeVisible();
  const chipBox = await replyChip.boundingBox();
  const thumbBox = await goodThumb.boundingBox();
  expect(chipBox && thumbBox && chipBox.y < thumbBox.y).toBe(true);

  // The bubble surface is solid cream (opaque comic bubble, not a dark panel).
  const bubble = petChat.locator('[data-tidepool="bubble"]');
  const surface = await bubble.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(surface).toBe('rgb(255, 249, 242)');

  const frac = diffFraction(
    path.join(EVIDENCE_DIR, 'before-petchat.png'),
    path.join(OUTPUT_DIR, 'after-petchat.png'),
    path.join(OUTPUT_DIR, 'diff-petchat.png'),
  );
  console.log(`[cla58] pet-chat before→after pixel-diff fraction: ${(frac * 100).toFixed(1)}%`);
  expect(frac).toBeGreaterThan(MIN_DIFF_FRACTION);
});
