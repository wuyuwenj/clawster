// Separate chat sessions (CLA-33). Each session holds its own message history so
// conversations don't bleed context into each other. This module is pure — it
// operates on plain arrays and takes `now`/`id` as arguments — so the logic is
// unit-testable without Electron or the store. main.ts wires it to the store.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// Lightweight session descriptor for the switcher UI (no message bodies).
export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export const MAX_SESSIONS = 50;
const TITLE_MAX = 40;

/** Title a session from its first user message, else "New chat". */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = firstUser?.content.trim().replace(/\s+/g, ' ') ?? '';
  if (!raw) return 'New chat';
  const chars = Array.from(raw);
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX - 1).join('') + '…' : raw;
}

export function newSession(now: number, id: string): ChatSession {
  return { id, title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
}

export function toMeta(session: ChatSession): ChatSessionMeta {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

/**
 * Migrate a legacy flat chat history into a single session, but only when no
 * sessions exist yet. Returns the (possibly unchanged) session list.
 */
export function migrateFlatHistory(
  sessions: ChatSession[],
  flat: ChatMessage[] | undefined,
  now: number,
  id: string,
): ChatSession[] {
  if (sessions.length > 0) return sessions;
  if (!flat || flat.length === 0) return sessions;
  return [{ id, title: deriveTitle(flat), createdAt: now, updatedAt: now, messages: [...flat] }];
}

/** Resolve a valid active id: keep it if it still exists, else the newest, else null. */
export function resolveActiveId(sessions: ChatSession[], activeId: string | null): string | null {
  if (activeId && sessions.some((s) => s.id === activeId)) return activeId;
  if (sessions.length === 0) return null;
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
}

/** Keep at most `max` sessions, dropping the least-recently-updated ones. */
export function capSessions(sessions: ChatSession[], max = MAX_SESSIONS): ChatSession[] {
  if (sessions.length <= max) return sessions;
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max);
}

/**
 * Structural deep equality. Used to compare messages by their full contents so
 * the redundant-save guard stays correct if `ChatMessage` ever gains a field
 * (attachments, tool-call metadata, …): a save that changes only a new field is
 * no longer seen as "unchanged" and silently dropped. Key order is irrelevant.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function sameMessages(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => deepEqual(m, b[i]));
}

/**
 * Replace a session's messages, refreshing its title (if still default) and
 * updatedAt. A save with content-identical messages (e.g. the redundant save
 * fired on viewing/switching sessions, CLA-46) returns the session unchanged
 * so updatedAt doesn't bump and the session list doesn't reorder.
 */
export function withMessages(
  session: ChatSession,
  messages: ChatMessage[],
  now: number,
): ChatSession {
  if (sameMessages(session.messages, messages)) return session;
  const title =
    session.title === 'New chat' || session.title === ''
      ? deriveTitle(messages)
      : session.title;
  return { ...session, messages: [...messages], title, updatedAt: now };
}
