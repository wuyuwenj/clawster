/**
 * CLA-6 / CLA-7 / CLA-8 — drag realization, drag friction, click irritation.
 *
 * Drives the real pet window in a launched Electron app with real pointer
 * events and real wall-clock timing, so the DragGesture state machine, the
 * `pet-drag` / `pet-drag-take-over` IPC round trips, and the CSS poses in
 * styles.css are all exercised exactly as an end user would trigger them.
 *
 * Every scenario captures PNG frames of the sprite so the poses (carried,
 * resisting, confused-accepts realization, startled, huff, mad+snip) are
 * reviewable as images rather than as class-name assertions.
 *
 * Isolation: throwaway CLAWSTER_DATA_DIR, pre-seeded past onboarding so the
 * pet window is the first thing on screen.
 *
 * Gotcha (same as chatbar-curious.spec.ts): if a foreign Vite already holds
 * :5173, Playwright reuses it and the pet window loads that checkout's Pet.tsx
 * — none of the drag classes exist there and every scenario below fails. Run
 * this checkout's own renderer, e.g. `vite --port 5273` plus
 * `VITE_DEV_PORT=5273 npm run test:e2e`.
 *
 * Set EVIDENCE_DIR to collect the PNG frames somewhere other than test-results/.
 */
import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { launchApp, findWindow } from './helpers';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR
  ? path.join(process.env.EVIDENCE_DIR, 'frames')
  : path.join(__dirname, '..', 'test-results', 'drag-feel');

const STATE_TIMEOUT = 15000;

let dataDir: string;
let app: ElectronApplication;
let pet: Page;

function seedDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-dragfeel-'));
  fs.writeFileSync(
    path.join(dir, 'clawster-config.json'),
    JSON.stringify({ onboarding: { completed: true, skipped: false } })
  );
  return dir;
}

async function petClass(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.lobster-container')?.className ?? '');
}

async function waitForPetClass(page: Page, cls: string): Promise<void> {
  await page.waitForFunction(
    (c) => document.querySelector('.lobster-container')?.classList.contains(c) ?? false,
    cls,
    { timeout: STATE_TIMEOUT }
  );
}

/** Autonomous wandering would turn a plain drag into a resisted one. */
async function waitUntilStill(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !(document.querySelector('.lobster-container')?.classList.contains('state-walking') ?? true),
    undefined,
    { timeout: STATE_TIMEOUT }
  );
}

/** Screenshot the pet window into the evidence dir. */
async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Capture a burst of frames while an animation plays. */
async function captureFrames(page: Page, prefix: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await shot(page, `${prefix}-${String(i).padStart(2, '0')}`);
  }
}

// Pointer events carry screen coordinates because Pet.tsx reads screenX/screenY
// (the pet window itself moves under the cursor during a drag).
async function mouseDown(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([sx, sy]) => {
    document.querySelector('.lobster-container')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, screenX: sx, screenY: sy, clientX: 60, clientY: 60 })
    );
  }, [x, y]);
}

async function mouseMove(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([sx, sy]) => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, screenX: sx, screenY: sy }));
  }, [x, y]);
}

async function mouseUp(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

/** A press/release/click with no movement — how a real poke arrives. */
async function poke(page: Page, x = 500, y = 500): Promise<void> {
  await mouseDown(page, x, y);
  await mouseUp(page);
  await page.evaluate(() => {
    document.querySelector('.lobster-container')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function petPosition(page: Page): Promise<[number, number]> {
  return page.evaluate(() => window.clawster.getPetPosition());
}

test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  dataDir = seedDataDir();
  app = await launchApp({ dataDir });
  pet = await findWindow(app, 'pet.html');
  await waitForPetClass(pet, 'lobster-container');
  // Let the sprite settle into its idle loop before the first frame.
  await pet.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('baseline: idle pet before any interaction', async () => {
  await shot(pet, '00-idle-baseline');
  const cls = await petClass(pet);
  expect(cls).not.toContain('state-dragging');
  expect(cls).not.toContain('drag-reaction');
});

test('CLA-6: a slow drag carries the pet and plays the confused-accepts realization', async () => {
  await waitUntilStill(pet);
  const start: [number, number] = [500, 500];
  const before = await petPosition(pet);

  await mouseDown(pet, ...start);
  // Slow drag: ~30px over ~200ms => 0.15 px/ms, well under the 0.8 px/ms
  // fast-drag threshold, so the pet reads it as "confused, then accepts".
  for (let i = 1; i <= 6; i++) {
    await mouseMove(pet, start[0] + i * 5, start[1]);
    await pet.waitForTimeout(35);
  }

  await waitForPetClass(pet, 'state-dragging');
  await shot(pet, '01-carried-pose');

  await waitForPetClass(pet, 'drag-reaction-confused-accepts');
  await captureFrames(pet, '02-confused-accepts', 8);

  const cls = await petClass(pet);
  expect(cls).toContain('state-dragging');
  expect(cls).not.toContain('state-drag-resisting');
  expect(cls).not.toContain('drag-reaction-startled');

  await mouseUp(pet);

  // A non-resisted drag moves the window 1:1 with the pointer.
  const after = await petPosition(pet);
  console.log(`[CLA-6] unresisted drag: pointer moved 30px -> pet window moved ${after[0] - before[0]}px (1.00x)`);
  expect(after[0] - before[0]).toBe(30);
  expect(after[1] - before[1]).toBe(0);

  // The realization plays out after release, then clears.
  await pet.waitForTimeout(800);
  expect(await petClass(pet)).not.toContain('drag-reaction');
});

test('CLA-7: dragging a walking pet meets resistance, and the walk is cancelled', async () => {
  await waitUntilStill(pet);
  const before = await petPosition(pet);

  // Start an autonomous walk, and hold onto its promise: the drag take-over
  // must resolve it as cancelled, not completed.
  await pet.evaluate(([x, y]) => {
    (window as unknown as { __move: Promise<{ completed: boolean }> }).__move =
      window.clawster.movePetTo(x - 350, y, 6000);
  }, before);

  await waitForPetClass(pet, 'state-walking');

  const start: [number, number] = [900, 400];
  await mouseDown(pet, ...start);
  // The first move is what cancels main's eased walk, so sample the window
  // position only after it lands — otherwise the walk's own 16ms writes
  // pollute the measurement of how far the *drag* moved the pet.
  await mouseMove(pet, start[0] + 10, start[1]);
  await pet.waitForTimeout(40);
  const resistFrom = await petPosition(pet);

  // Stay inside the resistance window: under 50px of pointer travel from the
  // press point, and under 500ms.
  for (let i = 2; i <= 4; i++) {
    await mouseMove(pet, start[0] + i * 10, start[1]);
    await pet.waitForTimeout(20);
  }

  const cls = await petClass(pet);
  expect(cls).toContain('state-dragging');
  expect(cls).toContain('state-drag-resisting');
  await shot(pet, '03-resisting-claws-dug-in');
  await captureFrames(pet, '04-resist-tug', 6);

  // 30px of further pointer travel, resisted at 0.35 => ~10.5px of window travel.
  const resisted = await petPosition(pet);
  const resistedDx = resisted[0] - resistFrom[0];
  console.log(`[CLA-7] resisting: pointer moved 30px -> pet window moved ${resistedDx}px (${(resistedDx / 30).toFixed(2)}x)`);
  expect(resistedDx).toBeGreaterThanOrEqual(9);
  expect(resistedDx).toBeLessThanOrEqual(12);

  // Push past the 50px win threshold: the pet gives up and follows 1:1.
  await mouseMove(pet, start[0] + 80, start[1]);
  await pet.waitForTimeout(50);
  expect(await petClass(pet)).not.toContain('state-drag-resisting');
  await shot(pet, '05-resistance-given-up');

  const wonFrom = await petPosition(pet);
  await mouseMove(pet, start[0] + 130, start[1]);
  await pet.waitForTimeout(30);
  const wonTo = await petPosition(pet);
  const wonDx = wonTo[0] - wonFrom[0];
  console.log(`[CLA-7] resistance won: pointer moved 50px -> pet window moved ${wonDx}px (${(wonDx / 50).toFixed(2)}x)`);
  // 1:1 now, give or take the sub-pixel remainder carried out of the resisted phase.
  expect(Math.abs(wonDx - 50)).toBeLessThanOrEqual(1);

  await mouseUp(pet);

  // The autonomous move was cancelled by the drag, not completed.
  const outcome = await pet.evaluate(
    () => (window as unknown as { __move: Promise<{ completed: boolean }> }).__move
  );
  console.log(`[CLA-7] interrupted movePetTo() resolved as ${JSON.stringify(outcome)} (cancelled, not completed)`);
  expect(outcome).toEqual({ completed: false });

  await pet.waitForTimeout(900);
});

test('CLA-8: rapid clicking escalates Clawster from huff to a full mad tantrum', async () => {
  await pet.waitForTimeout(200);

  // Four clicks inside the 3s window: still calm, still the cheerful pokes.
  for (let i = 0; i < 4; i++) {
    await poke(pet);
    await pet.waitForTimeout(60);
  }
  console.log(`[CLA-8] after 4 rapid clicks: still calm (${await petClass(pet)})`);
  expect(await petClass(pet)).not.toContain('state-huff');

  // The fifth click closes a 5-click burst => mildly annoyed (huff).
  await poke(pet);
  await waitForPetClass(pet, 'state-huff');
  console.log('[CLA-8] click 5 -> mildly-annoyed (state-huff)');
  await shot(pet, '06-irritation-huff');
  await captureFrames(pet, '07-huff', 4);

  // The next burst click escalates to very annoyed: mad mood + snipping claws.
  // The snip only runs for 1000ms, so assert on it before spending time on frames.
  await poke(pet);
  await waitForPetClass(pet, 'state-crossed');
  await waitForPetClass(pet, 'idle-snip_claws');

  const cls = await petClass(pet);
  console.log('[CLA-8] click 6 -> very-annoyed (state-crossed + idle-snip_claws)');
  expect(cls).toContain('state-crossed');
  expect(cls).toContain('idle-snip_claws');

  await shot(pet, '08-irritation-mad-snip');
  await captureFrames(pet, '09-mad-snip', 5);

  // And it decays back to calm on its own.
  await pet.waitForTimeout(2200);
  const settled = await petClass(pet);
  console.log(`[CLA-8] tantrum decays on its own (${settled})`);
  expect(settled).not.toContain('state-crossed');
  expect(settled).not.toContain('state-huff');
  await shot(pet, '10-irritation-settled');
});

test('CLA-6: a fast flick startles the pet (claws flail, eyes wide)', async () => {
  // pickDragReactionVariant rolls Math.random() < 0.25 for the startled
  // variant. DragGesture binds Math.random when Pet mounts, so the stub has to
  // be installed before the reload.
  await pet.addInitScript(() => {
    Math.random = () => 0.05;
  });
  await pet.reload();
  await waitForPetClass(pet, 'lobster-container');
  await pet.waitForTimeout(1200);

  const start: [number, number] = [400, 400];
  await mouseDown(pet, ...start);
  // ~150px in ~70ms => ~2.1 px/ms, over the 0.8 px/ms fast-drag threshold, and
  // past the 60ms speed-sample window so the reading is trusted.
  for (let i = 1; i <= 5; i++) {
    await mouseMove(pet, start[0] + i * 30, start[1] - i * 10);
    await pet.waitForTimeout(14);
  }

  await waitForPetClass(pet, 'drag-reaction-startled');
  await shot(pet, '11-startled');
  await captureFrames(pet, '12-startled', 8);

  expect(await petClass(pet)).toContain('state-dragging');
  await mouseUp(pet);
  await pet.waitForTimeout(800);
});
