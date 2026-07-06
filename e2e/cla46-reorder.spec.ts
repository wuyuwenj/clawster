import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, findWindow } from './helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// CLA-46: viewing/switching a session must not reorder the session list.
// Launches the real app against a data dir seeded with two sessions, switches
// between them via the switcher UI, and verifies the list order and persisted
// updatedAt stay stable on pure view/switch, while a real new message still
// moves a session to the top.

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '';

function shot(page: Page, name: string) {
  if (!EVIDENCE_DIR) return Promise.resolve(Buffer.from(''));
  return page.screenshot({ path: path.join(EVIDENCE_DIR, name) });
}

const A_UPDATED = 1751500000000;
const B_UPDATED = 1751600000000;

const SESSION_A = {
  id: 'sess-a',
  title: 'How do I care for a hermit crab?',
  createdAt: A_UPDATED - 1000,
  updatedAt: A_UPDATED,
  messages: [
    { id: 'a1', role: 'user', content: 'How do I care for a hermit crab?', timestamp: A_UPDATED - 1000 },
    { id: 'a2', role: 'assistant', content: 'Keep his tank humid and cozy!! 🦀', timestamp: A_UPDATED },
  ],
};

const SESSION_B = {
  id: 'sess-b',
  title: 'Tell me a joke about lobsters',
  createdAt: B_UPDATED - 1000,
  updatedAt: B_UPDATED,
  messages: [
    { id: 'b1', role: 'user', content: 'Tell me a joke about lobsters', timestamp: B_UPDATED - 1000 },
    { id: 'b2', role: 'assistant', content: 'Why don’t lobsters share? They’re shellfish!! 🦞', timestamp: B_UPDATED },
  ],
};

let app: ElectronApplication;
let assistant: Page;
let dataDir: string;

const configPath = () => path.join(dataDir, 'clawster-config.json');
const readSessions = () => {
  const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  return (cfg.sessions || []) as Array<{ id: string; updatedAt: number; messages: unknown[] }>;
};

const dropdown = (p: Page) => p.locator('.absolute.z-20');
const rowTitles = (p: Page) => dropdown(p).locator('.text-neutral-200.truncate');

async function openSwitcher(p: Page) {
  await p.getByTitle('Switch chat').click();
  await expect(dropdown(p)).toBeVisible();
  // The dropdown first renders from stale state, then reloadSessions() re-sorts
  // it async; wait until two consecutive reads of the rows agree.
  let prev = '';
  await expect
    .poll(async () => {
      const cur = JSON.stringify(await rowTitles(p).allTextContents());
      const stable = cur !== '[]' && cur === prev;
      prev = cur;
      return stable;
    })
    .toBe(true);
}

async function closeSwitcher(p: Page) {
  const overlay = p.locator('.fixed.inset-0.z-10');
  await overlay.click({ position: { x: 5, y: 400 } });
  await overlay.waitFor({ state: 'detached' });
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-cla46-e2e-'));
  fs.writeFileSync(
    configPath(),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: A_UPDATED, wasInterrupted: false, lastStep: 99 },
      sessions: [SESSION_A, SESSION_B],
      activeSessionId: SESSION_B.id,
    }),
  );

  app = await launchApp({ dataDir });
  const first = await app.firstWindow();
  await first.waitForLoadState('domcontentloaded');
  await first.waitForFunction(() => Boolean((window as any).clawster?.openAssistant));
  await first.evaluate(() => (window as any).clawster.openAssistant());
  assistant = await findWindow(app, 'assistant');
  await assistant.getByTitle('Switch chat').waitFor({ state: 'visible' });
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('opening the app does not bump the active session (initial redundant save)', async () => {
  // Assistant loads session B's history and fires the redundant save on mount.
  await expect(assistant.getByTitle('Switch chat').locator('span').first()).toHaveText(
    'Tell me a joke about lobsters',
  );
  // History rendered means the mount-time save effect has already fired.
  await expect(assistant.getByText('shellfish')).toBeVisible();
  const b = readSessions().find((s) => s.id === 'sess-b')!;
  expect(b.updatedAt).toBe(B_UPDATED);

  await openSwitcher(assistant);
  await expect(rowTitles(assistant)).toHaveText([
    'Tell me a joke about lobsters',
    'How do I care for a hermit crab?',
  ]);
  await shot(assistant, 'cla46-01-initial-order-b-on-top.png');
});

test('switching to an older session does not reorder the list or bump updatedAt', async () => {
  // Click session A in the open dropdown → switch fires the redundant save.
  await dropdown(assistant).getByText('How do I care for a hermit crab?').click();
  // The switcher closes once the switch completes.
  await assistant.locator('.fixed.inset-0.z-10').waitFor({ state: 'detached' });
  await expect(assistant.getByTitle('Switch chat').locator('span').first()).toHaveText(
    'How do I care for a hermit crab?',
  );
  // Session A's history rendered means the redundant post-switch save has fired.
  await expect(assistant.getByText('tank humid and cozy')).toBeVisible();

  // Re-view it once more for good measure (second redundant save).
  await openSwitcher(assistant);
  await closeSwitcher(assistant);

  await openSwitcher(assistant);
  await expect(rowTitles(assistant)).toHaveText([
    'Tell me a joke about lobsters',
    'How do I care for a hermit crab?',
  ]);
  await shot(assistant, 'cla46-02-after-switch-to-A-order-unchanged.png');
  await closeSwitcher(assistant);

  const a = readSessions().find((s) => s.id === 'sess-a')!;
  expect(a.updatedAt).toBe(A_UPDATED);
});

test('a real new message still moves the session to the top', async () => {
  // Append a real message to session A through the same IPC the renderer uses.
  const ok = await assistant.evaluate(() =>
    (window as any).clawster.appendChatMessages(
      [{ id: 'a3', role: 'user', content: 'Also, can he live with a fish?', timestamp: Date.now() }],
      'sess-a',
    ),
  );
  expect(ok).toBe(true);

  await openSwitcher(assistant);
  await expect(rowTitles(assistant)).toHaveText([
    'How do I care for a hermit crab?',
    'Tell me a joke about lobsters',
  ]);
  await shot(assistant, 'cla46-03-new-message-moves-A-to-top.png');

  const a = readSessions().find((s) => s.id === 'sess-a')!;
  expect(a.updatedAt).toBeGreaterThan(B_UPDATED);
});
