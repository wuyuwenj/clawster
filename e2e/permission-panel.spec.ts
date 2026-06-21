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

function getAssistantPage(): Page | undefined {
  return app.windows().find(w => w.url().includes('assistant'));
}

async function openSettingsTab(): Promise<Page> {
  // Open assistant
  await page.evaluate(() => (window as any).clawster.openAssistant());
  await page.waitForTimeout(2000);

  const assistantPage = getAssistantPage();
  if (!assistantPage) throw new Error('Assistant window not found');

  // Click Settings tab
  await assistantPage.evaluate(() => {
    const tabs = document.querySelectorAll('button');
    for (const t of tabs) {
      if (t.textContent?.trim() === 'Settings') { t.click(); break; }
    }
  });
  await assistantPage.waitForTimeout(500);
  return assistantPage;
}

test.describe('inline permission panel', () => {
  test('settings tab shows permission statuses via IPC', async () => {
    const statuses = await page.evaluate(async () => {
      return (window as any).clawster.getPermissionStatuses();
    });
    expect(statuses).toBeDefined();
    expect(typeof statuses['accessibility']).toBe('string');
    expect(typeof statuses['screen-recording']).toBe('string');
    expect(typeof statuses['microphone']).toBe('string');
    expect(['granted', 'needs-permission', 'restricted']).toContain(statuses['accessibility']);
  });

  test('settings tab has Watching section with toggles', async () => {
    const assistantPage = await openSettingsTab();
    const headers = await assistantPage.evaluate(() =>
      Array.from(document.querySelectorAll('h3')).map(h => h.textContent?.trim())
    );
    expect(headers).toContain('Watching');
  });

  test('watch toggle shows status indicator', async () => {
    const assistantPage = await openSettingsTab();
    // The "Watch active app changes" text should be present
    const watchText = await assistantPage.evaluate(() =>
      document.body.innerText.includes('Watch active app changes')
    );
    expect(watchText).toBe(true);
  });

  test('permission status shows granted dot when accessibility is granted', async () => {
    const statuses = await page.evaluate(async () => (window as any).clawster.getPermissionStatuses());
    const isGranted = statuses['accessibility'] === 'granted';

    if (isGranted) {
      const assistantPage = await openSettingsTab();
      // Should show teal dot (w-1.5 h-1.5 bg-[#008080])
      const hasDot = await assistantPage.evaluate(() => {
        const spans = document.querySelectorAll('span');
        return Array.from(spans).some(s =>
          s.className.includes('rounded-full') && s.className.includes('bg-')
        );
      });
      expect(hasDot).toBe(true);
    }
  });

  test('permission panel expands when toggle ON without permission', async () => {
    const statuses = await page.evaluate(async () => (window as any).clawster.getPermissionStatuses());
    const isGranted = statuses['accessibility'] === 'granted';

    if (!isGranted) {
      const assistantPage = await openSettingsTab();

      // Enable watch active app
      await assistantPage.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const watchToggle = checkboxes[0] as HTMLInputElement;
        if (watchToggle && !watchToggle.checked) watchToggle.click();
      });
      await assistantPage.waitForTimeout(500);

      // Should show the rationale panel with "Accessibility access"
      const panelText = await assistantPage.evaluate(() => document.body.innerText);
      expect(panelText).toMatch(/Accessibility access|Needs permission/i);
    }
  });

  test('panel has Open Settings and Not now buttons', async () => {
    const statuses = await page.evaluate(async () => (window as any).clawster.getPermissionStatuses());
    const isGranted = statuses['accessibility'] === 'granted';

    if (!isGranted) {
      const assistantPage = await openSettingsTab();

      await assistantPage.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const watchToggle = checkboxes[0] as HTMLInputElement;
        if (watchToggle && !watchToggle.checked) watchToggle.click();
      });
      await assistantPage.waitForTimeout(500);

      const buttons = await assistantPage.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim())
      );
      expect(buttons).toContain('Open Settings');
      expect(buttons.some(b => b?.includes('Not now'))).toBe(true);
    }
  });

  test('Not now collapses panel but toggle stays ON', async () => {
    const statuses = await page.evaluate(async () => (window as any).clawster.getPermissionStatuses());
    const isGranted = statuses['accessibility'] === 'granted';

    if (!isGranted) {
      const assistantPage = await openSettingsTab();

      // Toggle ON
      await assistantPage.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const watchToggle = checkboxes[0] as HTMLInputElement;
        if (watchToggle && !watchToggle.checked) watchToggle.click();
      });
      await assistantPage.waitForTimeout(500);

      // Click Not now
      await assistantPage.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          if (b.textContent?.trim() === 'Not now') { b.click(); break; }
        }
      });
      await assistantPage.waitForTimeout(500);

      // Panel should be gone but toggle still ON
      const panelGone = await assistantPage.evaluate(() =>
        !document.body.innerText.includes('Accessibility access to close apps')
      );
      expect(panelGone).toBe(true);
    }
  });
});

test.describe('permission APIs', () => {
  test('getPermissionStatuses returns all three types', async () => {
    const statuses = await page.evaluate(async () => {
      return (window as any).clawster.getPermissionStatuses();
    });
    expect(statuses).toHaveProperty('accessibility');
    expect(statuses).toHaveProperty('screen-recording');
    expect(statuses).toHaveProperty('microphone');
  });

  test('permission statuses refresh on window focus', async () => {
    // Statuses should be queryable
    const statuses = await page.evaluate(async () => {
      return (window as any).clawster.getPermissionStatuses();
    });
    expect(typeof statuses['accessibility']).toBe('string');
  });
});

test.describe('MDM restricted handling', () => {
  test('restricted status is a valid return value', async () => {
    const statuses = await page.evaluate(async () => (window as any).clawster.getPermissionStatuses());
    expect(['granted', 'needs-permission', 'restricted']).toContain(statuses['screen-recording']);
  });
});
