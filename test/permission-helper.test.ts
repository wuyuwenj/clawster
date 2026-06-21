import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => false),
    getMediaAccessStatus: vi.fn(() => 'not-determined'),
    askForMediaAccess: vi.fn(async () => true),
  },
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  })),
  ipcMain: {
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

import { checkPermission, getRequiredPermission, getDegradedMessage } from '../src/main/permission-helper';
import { systemPreferences } from 'electron';

describe('checkPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when accessibility is granted', () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);
    expect(checkPermission('accessibility')).toBe(true);
  });

  it('returns false when accessibility is denied', () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);
    expect(checkPermission('accessibility')).toBe(false);
  });

  it('returns true when screen-recording is granted', () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');
    expect(checkPermission('screen-recording')).toBe(true);
  });

  it('returns false when screen-recording is denied', () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');
    expect(checkPermission('screen-recording')).toBe(false);
  });

  it('returns true when microphone is granted', () => {
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');
    expect(checkPermission('microphone')).toBe(true);
  });

  it('returns true when systemPreferences throws (test environment)', () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockImplementation(() => { throw new Error(); });
    expect(checkPermission('accessibility')).toBe(true);
  });
});

describe('getRequiredPermission', () => {
  it('maps close_app to accessibility', () => {
    expect(getRequiredPermission('close_app')).toBe('accessibility');
  });

  it('maps block_apps to accessibility', () => {
    expect(getRequiredPermission('block_apps')).toBe('accessibility');
  });

  it('maps system_control brightness to accessibility', () => {
    expect(getRequiredPermission('system_control', { action: 'brightness_up' })).toBe('accessibility');
  });

  it('skips permission for system_control battery/volume', () => {
    expect(getRequiredPermission('system_control', { action: 'battery' })).toBeNull();
    expect(getRequiredPermission('system_control', { action: 'volume_up' })).toBeNull();
    expect(getRequiredPermission('system_control', { action: 'mute' })).toBeNull();
  });

  it('maps take_screenshot to screen-recording', () => {
    expect(getRequiredPermission('take_screenshot')).toBe('screen-recording');
  });

  it('returns null for tools that need no permission', () => {
    expect(getRequiredPermission('wave')).toBeNull();
    expect(getRequiredPermission('play_music')).toBeNull();
    expect(getRequiredPermission('get_weather')).toBeNull();
    expect(getRequiredPermission('set_timer')).toBeNull();
    expect(getRequiredPermission('open_app')).toBeNull();
  });
});

describe('getDegradedMessage', () => {
  it('returns a helpful message for accessibility', () => {
    const msg = getDegradedMessage('accessibility');
    expect(msg).toContain('Accessibility');
    expect(msg).toContain('Open Settings');
  });

  it('returns a helpful message for screen-recording', () => {
    const msg = getDegradedMessage('screen-recording');
    expect(msg).toContain('Screen Recording');
    expect(msg).toContain('Open Settings');
  });

  it('returns a helpful message for microphone', () => {
    const msg = getDegradedMessage('microphone');
    expect(msg).toContain('Microphone');
  });
});

describe('cooldown logic', () => {
  it('setPermissionStore loads persisted declines', async () => {
    const { setPermissionStore } = await import('../src/main/permission-helper');
    const mockStore = {
      get: vi.fn(() => ({ accessibility: Date.now() })),
      set: vi.fn(),
    };
    setPermissionStore(mockStore);
    expect(mockStore.get).toHaveBeenCalledWith('permissionDeclines');
  });
});
