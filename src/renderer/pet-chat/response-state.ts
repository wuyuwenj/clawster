// Pure logic — no React, no Electron, so it is unit testable in the
// node-environment Vitest suite.

// The pet-chat window is driven by the `chat-message` IPC. While a response is
// still loading or streaming, the bubble holds the '...' placeholder that
// ChatBar opens the popup with (see ChatBar submit flow), and the real text is
// only committed at stream end. During that window `isLoading` is false, so the
// feedback thumbs must not gate on `!isLoading` alone or they flash over the
// placeholder. A response is "complete" only once loading has ended AND the
// final message text has been committed (matches the animalese guard that skips
// speaking the '...' placeholder).
export const STREAM_PLACEHOLDER = '...';

export function isResponseComplete(state: { isLoading: boolean; text?: string | null }): boolean {
  return !state.isLoading && !!state.text && state.text !== STREAM_PLACEHOLDER;
}
