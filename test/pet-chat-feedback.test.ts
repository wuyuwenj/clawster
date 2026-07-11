import { describe, it, expect } from 'vitest';
import { isResponseComplete } from '../src/renderer/pet-chat/response-state';
import { buildFeedbackPayload } from '../src/renderer/pet-chat/feedback-payload';

// CLA-50: the 👍/👎 feedback thumbs in the pet-chat bubble must appear ONLY
// after the assistant response has fully loaded — never while the loading dots
// show and never while the streamed response is still arriving.
//
// The pet-chat window is driven by the `chat-message` IPC: ChatBar opens the
// popup with text '...' while the response streams (isLoading stays false),
// then commits the real text at stream end. `isResponseComplete` is the gate
// that decides whether the thumbs (and quick replies) render.
describe('isResponseComplete — thumbs visibility gate (CLA-50)', () => {
  it('hides thumbs while the loading dots show (isLoading=true)', () => {
    // "Tell me more" path: isLoading true, no committed text yet.
    expect(isResponseComplete({ isLoading: true, text: '...' })).toBe(false);
    expect(isResponseComplete({ isLoading: true, text: '' })).toBe(false);
    // Even if stale text lingers, an active load must hide the thumbs.
    expect(isResponseComplete({ isLoading: true, text: 'stale answer' })).toBe(false);
  });

  it('hides thumbs while the response is still streaming/arriving (\'...\' placeholder)', () => {
    // ChatBar opens the popup with '...' and isLoading is false during the
    // whole stream — this is the exact window where thumbs used to flash.
    expect(isResponseComplete({ isLoading: false, text: '...' })).toBe(false);
  });

  it('hides thumbs when there is no text yet', () => {
    expect(isResponseComplete({ isLoading: false, text: '' })).toBe(false);
    expect(isResponseComplete({ isLoading: false, text: null })).toBe(false);
    expect(isResponseComplete({ isLoading: false, text: undefined })).toBe(false);
  });

  it('shows thumbs only once the response is fully committed', () => {
    expect(isResponseComplete({ isLoading: false, text: 'Here you go! 🦞' })).toBe(true);
    // A one-word or emoji answer still counts as complete.
    expect(isResponseComplete({ isLoading: false, text: 'Yep!' })).toBe(true);
    // A committed error message is also a completed response (thumbs shown).
    expect(isResponseComplete({ isLoading: false, text: 'Error: no response' })).toBe(true);
  });
});

// The gate change must not alter what gets sent when the thumbs ARE clicked —
// feedback still fires with the same payload shape as before.
describe('buildFeedbackPayload — feedback still fires unchanged (CLA-50)', () => {
  const message = {
    text: 'Opening your notes now!',
    userInput: 'open my notes',
    toolCall: { tool: 'open_app', args: { name: 'Notes' } },
  };

  it('builds the positive (👍) payload', () => {
    const payload = JSON.parse(buildFeedbackPayload('positive', message));
    expect(payload).toEqual({
      __feedback: true,
      type: 'positive',
      userInput: 'open my notes',
      modelOutput: 'Opening your notes now!',
      toolCall: { tool: 'open_app', args: { name: 'Notes' } },
    });
  });

  it('builds the negative (👎) payload with category + note', () => {
    const payload = JSON.parse(
      buildFeedbackPayload('negative', message, { category: 'wrong_tool', note: 'should have searched' }),
    );
    expect(payload).toEqual({
      __feedback: true,
      type: 'negative',
      category: 'wrong_tool',
      note: 'should have searched',
      userInput: 'open my notes',
      modelOutput: 'Opening your notes now!',
      toolCall: { tool: 'open_app', args: { name: 'Notes' } },
    });
  });

  it('produces valid JSON even when optional message fields are absent', () => {
    const payload = JSON.parse(buildFeedbackPayload('positive', { text: 'hi' }));
    expect(payload.__feedback).toBe(true);
    expect(payload.type).toBe('positive');
    expect(payload.modelOutput).toBe('hi');
  });
});
