import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

// CLA-43: mock the exec boundary so play_music never runs real osascript
// against Music.app — the real call can stall under parallel test load.
// Must be top-level vi.mock (hoisted); never vi.doMock — Vitest bug #4166
// leaves exports undefined.
vi.mock('child_process', () => {
  const fake = (...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as (err: null, out: { stdout: string; stderr: string }) => void;
    cb(null, { stdout: '', stderr: '' });
  };
  const mocked = { exec: vi.fn(fake), execFile: vi.fn(fake) };
  return { ...mocked, default: mocked };
});

import { getQuickReplies } from '../src/main/chat/quick-replies';
import { ChatRouter } from '../src/main/chat/chat-router';
import type { LocalToolProvider } from '../src/main/chat/local-tool-provider';

describe('getQuickReplies', () => {
  it('returns tool-specific replies for a tool', () => {
    expect(getQuickReplies('play_music')).toEqual(['Next song', 'Pause']);
    expect(getQuickReplies('block_apps')).toContain('How much time left?');
    expect(getQuickReplies('remember_preference')).toContain('What else do you know?');
  });

  it('falls back to mood-based replies when no tool', () => {
    expect(getQuickReplies(null, 'curious')).toEqual(['Tell me more', 'Cool!']);
    expect(getQuickReplies(null, 'worried')).toContain("I'm okay");
  });

  it('returns sensible defaults when neither matches', () => {
    expect(getQuickReplies(null)).toEqual(['Thanks!', 'Not now']);
    expect(getQuickReplies('unknown_tool', 'no_such_mood')).toEqual(['Thanks!', 'Not now']);
  });

  it('always returns at least 2 options', () => {
    for (const t of ['play_music', 'close_app', 'what_time', null]) {
      expect(getQuickReplies(t as any).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('ChatRouter includes contextual quick replies', () => {
  function routerReturning(toolCall: Record<string, unknown>) {
    const fake = { classify: async () => toolCall, getModelName: () => 'test-model', destroy() {} } as unknown as LocalToolProvider;
    return new ChatRouter(fake);
  }

  it('attaches tool-based quick replies to a handled tool response', async () => {
    const router = routerReturning({ tool: 'play_music', args: { action: 'play' }, mood: 'happy' });
    const res = await router.chat('play some jazz');
    expect(res.quickReplies).toEqual(['Next song', 'Pause']);
  });

  it('attaches mood-based quick replies to a plain conversation', async () => {
    const router = routerReturning({ tool: null, args: {}, response: 'Hi there!', mood: 'curious' });
    const res = await router.chat('tell me a fact');
    expect(res.quickReplies).toEqual(['Tell me more', 'Cool!']);
  });
});
