import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, findWindow } from './helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// CLA-33: separate chat sessions. Launches the real app against an isolated
// data dir seeded with a legacy flat `chatHistory`, then walks the session
// switcher UI: migration, new session, no context bleed on switch, delete,
// and persisted store state.

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '';

function shot(page: Page, name: string) {
  if (!EVIDENCE_DIR) return Promise.resolve(Buffer.from(''));
  return page.screenshot({ path: path.join(EVIDENCE_DIR, name) });
}

const LEGACY_MESSAGES = [
  { id: 'l1', role: 'user', content: 'What should I name my pet lobster?', timestamp: 1751500000000 },
  { id: 'l2', role: 'assistant', content: 'Ooh ooh name him Sir Pinchalot!! 🦞', timestamp: 1751500001000 },
  { id: 'l3', role: 'user', content: 'haha ok, and what do lobsters eat?', timestamp: 1751500002000 },
  { id: 'l4', role: 'assistant', content: 'Mostly fish, clams and seaweed snacks~', timestamp: 1751500003000 },
];

let app: ElectronApplication;
let assistant: Page;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-sessions-e2e-'));
  // Seed a pre-CLA-33 store: flat chatHistory, no sessions, onboarding done.
  fs.writeFileSync(
    path.join(dataDir, 'clawster-config.json'),
    JSON.stringify({
      onboarding: { completed: true, skipped: false },
      tutorial: { version: 1, completedAt: 1751500000000, wasInterrupted: false, lastStep: 99 },
      chatHistory: LEGACY_MESSAGES,
    }),
  );

  app = await launchApp({ dataDir });
  const first = await app.firstWindow();
  await first.waitForLoadState('domcontentloaded');
  await first.waitForTimeout(4000);
  await first.evaluate(() => (window as any).clawster.openAssistant());
  assistant = await findWindow(app, 'assistant');
  await assistant.waitForTimeout(2500);
});

test.afterAll(async () => {
  await app?.close();
});

// The chat transcript container — scopes message assertions so they can't
// collide with the session-switcher title (which shows the same text).
const chatLog = (p: Page) => p.locator('.space-y-5');

test('legacy flat history is migrated into one session and shown in the active chat', async () => {
  await expect(chatLog(assistant).getByText('What should I name my pet lobster?')).toBeVisible();
  await expect(chatLog(assistant).getByText('Mostly fish, clams and seaweed snacks~')).toBeVisible();

  // Switcher title is derived from the first user message (40-char cap).
  await expect(
    assistant.getByTitle('Switch chat').locator('span').first(),
  ).toHaveText('What should I name my pet lobster?');

  await shot(assistant, '01-migrated-legacy-chat.png');
});

test('new session starts empty; old messages stay in the old session', async () => {
  await assistant.getByTitle('Start a new chat').click();
  await assistant.waitForTimeout(500);

  await expect(chatLog(assistant).getByText('What should I name my pet lobster?')).toHaveCount(0);
  await expect(
    assistant.getByTitle('Switch chat').locator('span').first(),
  ).toHaveText('New chat');
  await shot(assistant, '02-new-session-empty.png');

  // Simulate a conversation landing in the new (active) session via the real IPC
  // the renderer uses, then verify it shows up after a round-trip switch.
  const saved = await assistant.evaluate(() =>
    (window as any).clawster.appendChatMessages([
      { id: 'n1', role: 'user', content: 'Tell me a fun fact about space', timestamp: Date.now() },
      { id: 'n2', role: 'assistant', content: 'Saturn would float in a bathtub!! 🛁', timestamp: Date.now() },
    ]),
  );
  expect(saved).toBe(true);
});

test('dropdown lists both sessions with counts and switching does not mix histories', async () => {
  // Open the switcher dropdown.
  await assistant.getByTitle('Switch chat').click();
  await assistant.waitForTimeout(500);

  const dropdownRows = assistant.locator('.absolute.z-20 >> text=message');
  await expect(dropdownRows).toHaveCount(2);
  await expect(assistant.locator('.absolute.z-20').getByText('Tell me a fun fact about space')).toBeVisible();
  await expect(
    assistant.locator('.absolute.z-20').getByText('What should I name my pet lobster?'),
  ).toBeVisible();
  await expect(assistant.locator('.absolute.z-20').getByText('4 messages')).toBeVisible();
  await expect(assistant.locator('.absolute.z-20').getByText('2 messages')).toBeVisible();
  await shot(assistant, '03-session-dropdown-two-sessions.png');

  // Switch to the legacy session: only lobster messages, no space fact.
  await assistant.locator('.absolute.z-20').getByText('What should I name my pet lobster?').click();
  await assistant.waitForTimeout(500);
  await expect(chatLog(assistant).getByText('Mostly fish, clams and seaweed snacks~')).toBeVisible();
  await expect(chatLog(assistant).getByText('Saturn would float in a bathtub!! 🛁')).toHaveCount(0);
  await shot(assistant, '04-switched-to-legacy-session.png');

  // Switch back to the new session: only the space chat, no lobster messages.
  await assistant.getByTitle('Switch chat').click();
  await assistant.waitForTimeout(300);
  await assistant.locator('.absolute.z-20').getByText('Tell me a fun fact about space').click();
  await assistant.waitForTimeout(500);
  await expect(chatLog(assistant).getByText('Saturn would float in a bathtub!! 🛁')).toBeVisible();
  await expect(chatLog(assistant).getByText('What should I name my pet lobster?')).toHaveCount(0);
  // Title picked up from the session's first user message.
  await expect(
    assistant.getByTitle('Switch chat').locator('span').first(),
  ).toHaveText('Tell me a fun fact about space');
  await shot(assistant, '05-switched-back-new-session.png');
});

test('deleting a session removes it and the remaining one stays active', async () => {
  await assistant.getByTitle('Switch chat').click();
  const dropdown = assistant.locator('.absolute.z-20');
  await expect(dropdown.locator('.group')).toHaveCount(2);
  // Opening the switcher kicks off an async reloadSessions() that re-sorts the
  // rows newest-first; wait for that reorder to settle (active space session on
  // top) so the legacy row can't move out from under the delete click.
  await expect(dropdown.locator('.group').first()).toContainText('Tell me a fun fact about space');

  const legacyRow = dropdown
    .locator('.group')
    .filter({ hasText: 'What should I name my pet lobster?' });

  // Deleting is a two-step confirm: the first click only arms the button.
  await legacyRow.hover();
  await legacyRow.getByTitle('Delete chat').click();
  await expect(legacyRow.getByTitle('Confirm delete')).toHaveText('Delete?');
  await expect(dropdown.locator('.group')).toHaveCount(2);
  await shot(assistant, '05b-delete-confirm-armed.png');

  // Closing the dropdown disarms the confirm — nothing was deleted.
  await assistant.locator('.fixed.inset-0.z-10').click();
  await assistant.getByTitle('Switch chat').click();
  await expect(dropdown.locator('.group')).toHaveCount(2);
  await expect(dropdown.locator('.group').first()).toContainText('Tell me a fun fact about space');
  await expect(dropdown.getByTitle('Confirm delete')).toHaveCount(0);

  // Arm again and confirm — this performs the delete.
  await legacyRow.hover();
  await legacyRow.getByTitle('Delete chat').click();
  await legacyRow.getByTitle('Confirm delete').click();

  // The dropdown stays open after a delete; the row disappears in place.
  await expect(dropdown.locator('.group')).toHaveCount(1);
  await expect(dropdown.getByText('What should I name my pet lobster?')).toHaveCount(0);
  await expect(dropdown.getByText('Tell me a fun fact about space')).toBeVisible();
  await shot(assistant, '06-after-delete-one-session-left.png');

  // Close via the backdrop, then reopen to confirm the deletion stuck.
  await assistant.locator('.fixed.inset-0.z-10').click();
  await expect(dropdown).toHaveCount(0);
  await assistant.getByTitle('Switch chat').click();
  await expect(dropdown.locator('.group')).toHaveCount(1);
  await expect(dropdown.getByText('What should I name my pet lobster?')).toHaveCount(0);
  await assistant.locator('.fixed.inset-0.z-10').click();
  await expect(dropdown).toHaveCount(0);
});

test('store persists sessions and empties the legacy chatHistory', async () => {
  const state = await assistant.evaluate(async () => {
    const { sessions, activeId } = await (window as any).clawster.listSessions();
    return { sessions, activeId };
  });
  expect(state.sessions.length).toBe(1);
  expect(state.sessions[0].title).toBe('Tell me a fun fact about space');
  expect(state.activeId).toBe(state.sessions[0].id);

  await app.close();

  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'clawster-config.json'), 'utf8'));
  expect(raw.chatHistory).toEqual([]); // legacy history consumed by migration
  expect(Array.isArray(raw.sessions)).toBe(true);
  expect(raw.sessions.length).toBe(1);
  expect(raw.sessions[0].messages.map((m: any) => m.content)).toEqual([
    'Tell me a fun fact about space',
    'Saturn would float in a bathtub!! 🛁',
  ]);
  expect(raw.activeSessionId).toBe(raw.sessions[0].id);

  if (EVIDENCE_DIR) {
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, '07-persisted-clawster-config.json'),
      JSON.stringify({ chatHistory: raw.chatHistory, activeSessionId: raw.activeSessionId, sessions: raw.sessions }, null, 2),
    );
  }
});
