import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectSecondaryRequest,
  withSecondaryOffer,
  secondaryQuickReplies,
} from '../src/main/chat/multi-tool';

describe('detectSecondaryRequest', () => {
  it('spots the battery ask dropped after play_music (CLA-37 example)', () => {
    const s = detectSecondaryRequest("play kpop and also what's my battery", 'play_music');
    expect(s).not.toBeNull();
    expect(s!.tool).toBe('system_control');
    expect(s!.offer).toBe('check your battery');
    expect(s!.reply).toBe('Check my battery');
  });

  it('spots the timer ask dropped after get_weather (CLA-37 example)', () => {
    const s = detectSecondaryRequest('check weather and set timer', 'get_weather');
    expect(s).not.toBeNull();
    expect(s!.tool).toBe('set_timer');
    expect(s!.offer).toBe('set that timer');
  });

  it('works symmetrically when the model picks the OTHER tool', () => {
    // Same message, but the classifier ran set_timer instead of get_weather.
    const s = detectSecondaryRequest('check weather and set timer', 'set_timer');
    expect(s).not.toBeNull();
    expect(s!.tool).toBe('get_weather');
  });

  it('handles comma-separated requests', () => {
    const s = detectSecondaryRequest('play some jazz, then check the weather', 'play_music');
    expect(s!.tool).toBe('get_weather');
  });

  it('returns null for a single-tool request', () => {
    expect(detectSecondaryRequest('play some kpop', 'play_music')).toBeNull();
    expect(detectSecondaryRequest('set a 5 minute timer', 'set_timer')).toBeNull();
    expect(detectSecondaryRequest("what's the weather", 'get_weather')).toBeNull();
  });

  it('does NOT misread a single request that names two topics in one clause', () => {
    // "check the weather" is the reminder's content, not a second request.
    expect(
      detectSecondaryRequest('remind me to check the weather', 'create_reminder')
    ).toBeNull();
  });

  it('does not offer when a conjunction splits off a non-request clause', () => {
    // Reminder + weather share a clause; the other clause has no tool intent.
    expect(
      detectSecondaryRequest('remind me to check the weather and water the plants', 'create_reminder')
    ).toBeNull();
  });

  it('returns null when no tool actually ran', () => {
    expect(detectSecondaryRequest('play kpop and check battery', null)).toBeNull();
  });

  it('returns null when the handled tool is not visible in the text', () => {
    // We only offer when we can see the request that ran, so we know a real
    // second request was dropped.
    expect(
      detectSecondaryRequest('play kpop and check battery', 'remember_preference')
    ).toBeNull();
  });

  it('does not offer a second intent that maps to the same tool as ran', () => {
    // Both volume and battery are system_control; if system_control ran we
    // cannot tell which one, so we stay quiet rather than offer a duplicate.
    expect(
      detectSecondaryRequest('turn up the volume and check the battery', 'system_control')
    ).toBeNull();
  });
});

describe('withSecondaryOffer', () => {
  const secondary = { tool: 'system_control', offer: 'check your battery', reply: 'Check my battery' };

  it('appends the offer to the tool reply', () => {
    const out = withSecondaryOffer('Now playing kpop! 🎵', secondary);
    expect(out).toContain('Now playing kpop! 🎵');
    expect(out).toContain('want me to also check your battery?');
  });

  it('returns the text unchanged when there is no secondary request', () => {
    expect(withSecondaryOffer('Now playing kpop!', null)).toBe('Now playing kpop!');
  });

  it('handles empty tool text', () => {
    expect(withSecondaryOffer('', secondary)).toBe('Oh — want me to also check your battery? *perks up*');
  });
});

describe('secondaryQuickReplies', () => {
  it('offers a one-tap command plus a decline', () => {
    expect(
      secondaryQuickReplies({ tool: 'set_timer', offer: 'set that timer', reply: 'Set the timer' })
    ).toEqual(['Set the timer', 'No thanks']);
  });
});

// --- Router integration: the offer reaches the ChatResponse. tool-executor is
// mocked so no real tools (incl. audio) run. ---
vi.mock('../src/main/chat/tool-executor', () => ({
  executeTool: vi.fn(async (tool: string) => ({
    handled: true,
    response: tool === 'play_music' ? 'Now playing kpop! 🎵' : 'Weather: sunny, 72°F.',
  })),
}));

import { ChatRouter } from '../src/main/chat/chat-router';
import type { LocalToolProvider } from '../src/main/chat/local-tool-provider';

function toolModelReturning(toolCall: Record<string, unknown>) {
  return {
    getModelName: () => 'test-model',
    classify: async () => toolCall,
    destroy() {},
  } as unknown as LocalToolProvider;
}

describe('ChatRouter multi-tool acknowledgement (CLA-37)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends the dropped request as a follow-up offer', async () => {
    const router = new ChatRouter(
      toolModelReturning({ tool: 'play_music', args: { query: 'kpop' }, mood: 'happy' })
    );
    const res = await router.chat("play kpop and also what's my battery");

    expect(res.text).toContain('Now playing kpop!');
    expect(res.text).toContain('want me to also check your battery?');
    expect(res.quickReplies).toEqual(['Check my battery', 'No thanks']);
  });

  it('does not add an offer for a single-tool request', async () => {
    const router = new ChatRouter(
      toolModelReturning({ tool: 'play_music', args: { query: 'kpop' }, mood: 'happy' })
    );
    const res = await router.chat('play some kpop');

    expect(res.text).toBe('Now playing kpop! 🎵');
    expect(res.text).not.toContain('want me to also');
  });

  it('streams the offer text through onDelta', async () => {
    const router = new ChatRouter(
      toolModelReturning({ tool: 'get_weather', args: {}, mood: 'curious' })
    );
    let streamed = '';
    const res = await router.chatStream('check weather and set timer', [], {
      onDelta: (_d, full) => { streamed = full; },
    });

    expect(streamed).toContain('want me to also set that timer?');
    expect(res.quickReplies).toEqual(['Set the timer', 'No thanks']);
  });
});
