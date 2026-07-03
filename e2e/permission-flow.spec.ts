import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, sendChat } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
});

test.afterAll(async () => {
  await app.close();
});

// ─── Graceful degradation for each permission-gated tool ─────

test.describe('graceful degradation messages', () => {
  test('close_app shows permission message when accessibility denied', async () => {
    // Accessibility is not granted in test env — should get degraded message
    const hasAccess = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    if (!hasAccess) {
      const r = await sendChat(page, 'close safari');
      expect(r.text).toMatch(/permission|Accessibility|Open Settings/i);
      expect(r.quickReplies).toBeDefined();
      expect(r.quickReplies.some((q: string) => /open settings|maybe/i.test(q))).toBe(true);
    }
  });

  test('block_apps shows permission message when accessibility denied', async () => {
    const hasAccess = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    if (!hasAccess) {
      const r = await sendChat(page, 'help me focus for 10 minutes');
      expect(r.text).toMatch(/permission|Accessibility|Open Settings/i);
    }
  });

  test('take_screenshot shows permission message when screen recording denied', async () => {
    const hasAccess = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.getMediaAccessStatus('screen');
    });

    if (hasAccess !== 'granted') {
      const r = await sendChat(page, 'take a screenshot');
      expect(r.text).toMatch(/permission|Screen Recording|Open Settings/i);
    }
  });

  test('tools without permission needs work freely', async () => {
    const r = await sendChat(page, 'what time is it');
    expect(r.text).toMatch(/\d/);
    expect(r.text).not.toMatch(/permission/i);
  });
});

// ─── Cooldown: "Maybe Later" suppresses re-prompt ────────────

test.describe('24h decline cooldown', () => {
  test('second request within cooldown skips prompt', async () => {
    const hasAccess = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    if (!hasAccess) {
      // First request triggers the permission flow
      const r1 = await sendChat(page, 'close chrome');
      expect(r1.text).toMatch(/permission|Accessibility/i);

      // Simulate decline was stored (it was, via the first request)
      // Second request should also get denied but without showing dialog again
      const r2 = await sendChat(page, 'close firefox');
      expect(r2.text).toMatch(/permission|Accessibility/i);

      // Both should return quickly (no dialog wait)
    }
  });
});

// ─── Permission state checks ─────────────────────────────────

test.describe('permission state queries', () => {
  test('can query accessibility permission state', async () => {
    const result = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });
    expect(typeof result).toBe('boolean');
  });

  test('can query screen recording permission state', async () => {
    const result = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.getMediaAccessStatus('screen');
    });
    expect(['granted', 'denied', 'restricted', 'not-determined']).toContain(result);
  });

  test('can query microphone permission state', async () => {
    const result = await app.evaluate(async ({ systemPreferences }) => {
      return systemPreferences.getMediaAccessStatus('microphone');
    });
    expect(['granted', 'denied', 'restricted', 'not-determined']).toContain(result);
  });
});

// ─── AppleEvents automation error handling ────────────────────

test.describe('osascript automation denied handling', () => {
  test('play_music does not crash on automation denial', async () => {
    const r = await sendChat(page, 'play some jazz');
    expect(r.text).toBeTruthy();
    // Should either play music or give a helpful error — never crash
  });

  test('system_control does not crash on automation denial', async () => {
    const r = await sendChat(page, 'volume up');
    expect(r.text).toBeTruthy();
  });
});

// ─── "Open Settings" quick reply works ───────────────────────

test.describe('Open Settings quick reply', () => {
  test('intercepted before model and opens settings', async () => {
    const r = await sendChat(page, 'Open Settings');
    expect(r.text).toMatch(/System Settings|toggle|try again/i);
  });
});
