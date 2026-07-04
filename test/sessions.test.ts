import { describe, it, expect } from 'vitest';
import {
  deriveTitle,
  newSession,
  toMeta,
  migrateFlatHistory,
  resolveActiveId,
  capSessions,
  withMessages,
  MAX_SESSIONS,
  type ChatMessage,
  type ChatSession,
} from '../src/main/chat/sessions';

const msg = (role: ChatMessage['role'], content: string, timestamp = 0): ChatMessage => ({
  id: `${role}-${content}-${timestamp}`,
  role,
  content,
  timestamp,
});

const session = (id: string, updatedAt: number, messages: ChatMessage[] = []): ChatSession => ({
  id,
  title: 'New chat',
  createdAt: updatedAt,
  updatedAt,
  messages,
});

describe('deriveTitle', () => {
  it('uses the first user message, collapsed', () => {
    expect(deriveTitle([msg('assistant', 'hi'), msg('user', '  what   is the weather ')])).toBe(
      'what is the weather',
    );
  });
  it('truncates long titles with an ellipsis', () => {
    const long = 'a'.repeat(80);
    const t = deriveTitle([msg('user', long)]);
    expect(t.length).toBe(40);
    expect(t.endsWith('…')).toBe(true);
  });
  it('truncates on code points without splitting surrogate pairs', () => {
    const emoji = '🦞'.repeat(45);
    const t = deriveTitle([msg('user', emoji)]);
    expect(Array.from(t)).toHaveLength(40);
    expect(t.endsWith('…')).toBe(true);
    expect(t.includes('�')).toBe(false);
    expect(Array.from(t).slice(0, -1).every((c) => c === '🦞')).toBe(true);
  });
  it('falls back to "New chat" with no user message', () => {
    expect(deriveTitle([msg('assistant', 'hello')])).toBe('New chat');
    expect(deriveTitle([])).toBe('New chat');
  });
});

describe('migrateFlatHistory', () => {
  it('wraps a legacy flat history into one session when none exist', () => {
    const flat = [msg('user', 'remember pizza'), msg('assistant', 'ok')];
    const out = migrateFlatHistory([], flat, 1000, 'sess-1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('sess-1');
    expect(out[0].title).toBe('remember pizza');
    expect(out[0].messages).toHaveLength(2);
  });
  it('does nothing when sessions already exist', () => {
    const existing = [session('a', 5)];
    expect(migrateFlatHistory(existing, [msg('user', 'x')], 1, 'new')).toBe(existing);
  });
  it('does nothing with an empty/absent flat history', () => {
    expect(migrateFlatHistory([], [], 1, 'new')).toHaveLength(0);
    expect(migrateFlatHistory([], undefined, 1, 'new')).toHaveLength(0);
  });
});

describe('resolveActiveId', () => {
  it('keeps a still-valid active id', () => {
    const s = [session('a', 1), session('b', 2)];
    expect(resolveActiveId(s, 'a')).toBe('a');
  });
  it('falls back to the newest session when active id is gone', () => {
    const s = [session('a', 1), session('b', 5), session('c', 3)];
    expect(resolveActiveId(s, 'deleted')).toBe('b');
  });
  it('returns null when there are no sessions', () => {
    expect(resolveActiveId([], 'x')).toBeNull();
    expect(resolveActiveId([], null)).toBeNull();
  });
});

describe('capSessions', () => {
  it('drops the least-recently-updated beyond the cap', () => {
    const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => session(`s${i}`, i));
    const capped = capSessions(many);
    expect(capped).toHaveLength(MAX_SESSIONS);
    // newest (highest updatedAt) kept, oldest dropped
    expect(capped.some((s) => s.id === `s${MAX_SESSIONS + 4}`)).toBe(true);
    expect(capped.some((s) => s.id === 's0')).toBe(false);
  });
  it('is a no-op under the cap', () => {
    const s = [session('a', 1), session('b', 2)];
    expect(capSessions(s)).toHaveLength(2);
  });
});

describe('withMessages', () => {
  it('sets a title from messages when still default, and bumps updatedAt', () => {
    const s = session('a', 100);
    const out = withMessages(s, [msg('user', 'hello there')], 200);
    expect(out.title).toBe('hello there');
    expect(out.updatedAt).toBe(200);
    expect(out.messages).toHaveLength(1);
  });
  it('preserves a user-set (non-default) title', () => {
    const s: ChatSession = { ...session('a', 100), title: 'My Renamed Chat' };
    const out = withMessages(s, [msg('user', 'hi')], 200);
    expect(out.title).toBe('My Renamed Chat');
  });
});

// CLA-46: viewing/switching to a session fires a redundant save with identical
// messages; that must not bump updatedAt or reorder the session list.
describe('withMessages on unchanged messages (CLA-46)', () => {
  const listOrder = (sessions: ChatSession[]) =>
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => s.id);

  it('does not bump updatedAt when messages are content-identical', () => {
    const messages = [msg('user', 'hello'), msg('assistant', 'hi', 1)];
    const s: ChatSession = { ...session('a', 100), title: 'hello', messages };
    // clone the messages so equality is by content, not reference
    const out = withMessages(s, messages.map((m) => ({ ...m })), 999);
    expect(out).toBe(s);
    expect(out.updatedAt).toBe(100);
  });

  it('keeps session order stable across switch/re-view saves, while a new message still reorders', () => {
    const a: ChatSession = { ...session('a', 100), title: 'in a', messages: [msg('user', 'in a')] };
    const b: ChatSession = { ...session('b', 200), title: 'in b', messages: [msg('user', 'in b')] };
    let sessions = [a, b];
    expect(listOrder(sessions)).toEqual(['b', 'a']);

    // switching to "a" then re-viewing it re-saves the same messages
    sessions = sessions.map((s) => (s.id === 'a' ? withMessages(s, a.messages, 300) : s));
    sessions = sessions.map((s) => (s.id === 'a' ? withMessages(s, a.messages, 400) : s));
    expect(listOrder(sessions)).toEqual(['b', 'a']);
    expect(sessions.find((s) => s.id === 'a')!.updatedAt).toBe(100);

    // appending an actual message bumps updatedAt and moves "a" to the top
    sessions = sessions.map((s) =>
      s.id === 'a' ? withMessages(s, [...a.messages, msg('assistant', 'reply', 2)], 500) : s,
    );
    expect(listOrder(sessions)).toEqual(['a', 'b']);
    expect(sessions.find((s) => s.id === 'a')!.updatedAt).toBe(500);
  });

  it('still bumps when a message is edited in place (same ids, different content)', () => {
    const messages = [msg('user', 'hello')];
    const s: ChatSession = { ...session('a', 100), title: 'hello', messages };
    const edited = [{ ...messages[0], content: 'hello edited' }];
    const out = withMessages(s, edited, 200);
    expect(out.updatedAt).toBe(200);
    expect(out.messages[0].content).toBe('hello edited');
  });
});

describe('toMeta / newSession', () => {
  it('newSession starts empty with a default title', () => {
    const s = newSession(42, 'id1');
    expect(s).toMatchObject({ id: 'id1', title: 'New chat', createdAt: 42, updatedAt: 42 });
    expect(s.messages).toHaveLength(0);
  });
  it('toMeta strips message bodies and reports count', () => {
    const s = session('a', 7, [msg('user', 'x'), msg('assistant', 'y')]);
    const meta = toMeta(s);
    expect(meta).toEqual({ id: 'a', title: 'New chat', createdAt: 7, updatedAt: 7, messageCount: 2 });
    expect((meta as unknown as { messages?: unknown }).messages).toBeUndefined();
  });
});
