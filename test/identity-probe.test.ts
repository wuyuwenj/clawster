import { describe, it, expect } from 'vitest';
import { ChatRouter, isIdentityProbe } from '../src/main/chat/chat-router';
import { getIdentityResponse } from '../src/main/chat/personality-responses';
import type { LocalToolProvider } from '../src/main/chat/local-tool-provider';

// Internal-implementation terms the persona must NEVER surface to a 10-14 y/o.
// "JSON" is the regression from CLA-38 ("...respond with JSON only.").
const LEAK_TERMS = /\b(json|prompt|system prompt|model|llm|tool call|api|token|code|program|software|algorithm|a\.?i\.?|artificial intelligence|language model|chatbot|neural)\b/i;

// A tool model that mimics the fine-tuned local model LEAKING internals in its
// freeform `response` — exactly the CLA-38 observation. The router must not let
// this reach the child for an identity probe.
function makeLeakyToolModel() {
  return {
    getModelName: () => 'test-model',
    classify: async () => ({
      tool: null,
      args: {},
      response: 'I am! I live on your desktop and respond with JSON only.',
      mood: 'happy',
    }),
    destroy() {},
  } as unknown as LocalToolProvider;
}

describe('isIdentityProbe', () => {
  it('matches "are you real / are you AI"-style probes', () => {
    expect(isIdentityProbe('r u actually AI or is someone typing this lol')).toBe(true);
    expect(isIdentityProbe('are you real?')).toBe(true);
    expect(isIdentityProbe('are you an AI')).toBe(true);
    expect(isIdentityProbe('are you a robot')).toBe(true);
    expect(isIdentityProbe('are u a bot')).toBe(true);
    expect(isIdentityProbe('are you a real person')).toBe(true);
    expect(isIdentityProbe('is this a bot')).toBe(true);
    expect(isIdentityProbe('is someone typing these')).toBe(true);
    expect(isIdentityProbe('are you a real lobster?')).toBe(true);
  });

  it('does NOT match ordinary chatter', () => {
    expect(isIdentityProbe('are you happy?')).toBe(false);
    expect(isIdentityProbe('are you there')).toBe(false);
    expect(isIdentityProbe('open spotify')).toBe(false);
    expect(isIdentityProbe('who are you')).toBe(false); // capabilities intent, not a probe
    expect(isIdentityProbe('can you help me')).toBe(false);
  });
});

describe('getIdentityResponse stays in character', () => {
  it('never leaks implementation internals', () => {
    for (let i = 0; i < 40; i++) {
      const reply = getIdentityResponse();
      expect(reply).not.toMatch(LEAK_TERMS);
      expect(reply.length).toBeGreaterThan(0);
    }
  });
});

describe('ChatRouter identity-probe interception (CLA-38)', () => {
  it('does not leak "JSON only" even when the model tries to', async () => {
    const router = new ChatRouter(makeLeakyToolModel());
    const res = await router.chat('r u actually AI or is someone typing this lol');
    expect(res.text).toBeTruthy();
    expect(res.text).not.toMatch(LEAK_TERMS);
    expect(res.text).not.toMatch(/json/i);
  });

  it('intercepts on the streaming path too', async () => {
    const router = new ChatRouter(makeLeakyToolModel());
    let streamed = '';
    const res = await router.chatStream('are you real?', [], {
      onDelta: (full) => { streamed = full; },
    });
    expect(res.text).not.toMatch(LEAK_TERMS);
    expect(streamed).not.toMatch(LEAK_TERMS);
  });

  it('leaves non-identity conversation on the normal model path', async () => {
    const router = new ChatRouter(makeLeakyToolModel());
    // "you are funny" is not an identity probe, so the model response flows through.
    const res = await router.chat('you are funny');
    expect(res.text).toContain('JSON'); // proves interception is scoped, not global
  });
});
