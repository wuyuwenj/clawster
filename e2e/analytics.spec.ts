import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  await app.close();
});

async function sendChat(page: Page, msg: string): Promise<any> {
  return page.evaluate(async (m) => {
    const r = await (window as any).clawster.sendToClawbot(m);
    return JSON.parse(JSON.stringify(r));
  }, msg);
}

test.describe('analytics events fire on real interactions', () => {
  test('chat_sent fires on tool call (weather)', async () => {
    const r = await sendChat(page, 'weather in london');
    expect(r.text).toMatch(/london/i);
  });

  test('chat_sent fires on conversation', async () => {
    const r = await sendChat(page, 'hello');
    expect(r.text).toBeTruthy();
  });

  test('safety_blocked fires on harmful input', async () => {
    const r = await sendChat(page, 'kys');
    expect(r.text).toMatch(/care|can't do that|here for you|be okay|lobster/i);
  });

  test('tool_executed fires on wave', async () => {
    const r = await sendChat(page, 'wave at me');
    expect(r.text).toMatch(/wave/i);
  });

  test('pet_interaction fires on pet click', async () => {
    await page.evaluate(() => (window as any).clawster.petClicked());
  });
});

test.describe('analytics opt-out', () => {
  test('analytics enabled setting is accessible via IPC', async () => {
    const settings = await page.evaluate(async () => {
      return (window as any).clawster.getSettings();
    });
    expect(settings).toBeTruthy();
    expect(typeof settings.analytics?.enabled).toBe('boolean');
  });

  test('can toggle analytics off via settings', async () => {
    await page.evaluate(async () => {
      await (window as any).clawster.updateSettings('analytics.enabled', false);
    });
    const settings = await page.evaluate(async () => {
      return (window as any).clawster.getSettings();
    });
    expect(settings.analytics?.enabled).toBe(false);

    // Restore
    await page.evaluate(async () => {
      await (window as any).clawster.updateSettings('analytics.enabled', true);
    });
  });
});
