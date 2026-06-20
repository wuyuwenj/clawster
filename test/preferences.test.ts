import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

import {
  setPreferencesPath,
  addPreference,
  getPreferences,
  clearPreferences,
  buildPreferencesPrompt,
} from '../src/main/chat/preferences';
import { executeTool } from '../src/main/chat/tool-executor';

const TMP = path.join(os.tmpdir(), `clawster-prefs-test-${process.pid}.json`);

beforeEach(() => {
  setPreferencesPath(TMP);
  clearPreferences();
});

afterAll(() => {
  try { fs.unlinkSync(TMP); } catch { /* ignore */ }
});

describe('preferences module', () => {
  it('starts empty', () => {
    expect(getPreferences()).toEqual([]);
  });

  it('adds and persists a preference', () => {
    addPreference('likes jazz');
    expect(getPreferences()).toEqual(['likes jazz']);
    // persisted to disk
    const onDisk = JSON.parse(fs.readFileSync(TMP, 'utf-8'));
    expect(onDisk.preferences).toEqual(['likes jazz']);
  });

  it('dedupes case-insensitively', () => {
    addPreference('likes jazz');
    addPreference('Likes Jazz');
    expect(getPreferences()).toEqual(['likes jazz']);
  });

  it('ignores empty preferences', () => {
    addPreference('   ');
    expect(getPreferences()).toEqual([]);
  });

  it('builds a system-prompt fragment, empty when none', () => {
    expect(buildPreferencesPrompt()).toBe('');
    addPreference('likes jazz');
    addPreference('is vegetarian');
    const prompt = buildPreferencesPrompt();
    expect(prompt).toContain('likes jazz');
    expect(prompt).toContain('is vegetarian');
    expect(prompt).toMatch(/remember/i);
  });
});

describe('remember_preference / recall_preferences tools', () => {
  it('remember_preference persists and confirms', async () => {
    const res = await executeTool('remember_preference', { preference: 'likes jazz' });
    expect(res.handled).toBe(true);
    expect(res.response).toContain('likes jazz');
    expect(getPreferences()).toContain('likes jazz');
  });

  it('remember_preference with no text asks what to remember', async () => {
    const res = await executeTool('remember_preference', {});
    expect(res.response).toMatch(/what would you like me to remember/i);
    expect(getPreferences()).toEqual([]);
  });

  it('recall_preferences lists stored preferences', async () => {
    addPreference('likes jazz');
    addPreference('prefers dark mode');
    const res = await executeTool('recall_preferences', {});
    expect(res.response).toContain('likes jazz');
    expect(res.response).toContain('prefers dark mode');
  });

  it('recall_preferences handles an empty memory', async () => {
    const res = await executeTool('recall_preferences', {});
    expect(res.response).toMatch(/don't know much about you yet/i);
  });
});
