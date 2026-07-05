import { describe, it, expect } from 'vitest';

import {
  pickEmoteMessage,
  shouldShowEmoteBubble,
  emoteBubbleDurationMs,
  chatbarMoodTransition,
  applyChatbarCuriousHold,
  MIN_BUBBLE_GAP_MS,
  BUBBLE_MIN_DURATION_MS,
  BUBBLE_MAX_DURATION_MS,
  EmoteSuppression,
} from '../src/renderer/pet/emote-bubbles';

const noSuppression: EmoteSuppression = {
  talking: false,
  petChatOpen: false,
  assistantOpen: false,
  chatbarOpen: false,
};

const NOW = 1_000_000;

// CLA-13: speech-bubble emote system
describe('pickEmoteMessage (CLA-13)', () => {
  it('returns the spec message for each emote mood', () => {
    const first = () => 0;
    expect(pickEmoteMessage({ kind: 'mood', mood: 'happy' }, first)).toBe('Hi there!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'proud' }, first)).toBe('Look at me!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'startle' }, first)).toBe('!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'spin' }, first)).toBe('Wheee!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'huff' }, first)).toBe('Hmph!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'mad' }, first)).toBe('...');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'peek' }, first)).toBe('Boo!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'side-eye' }, first)).toBe('I see you');
  });

  it('returns idle/sleep phrases for behaviors and sleep moods', () => {
    const first = () => 0;
    expect(pickEmoteMessage({ kind: 'behavior', behavior: 'yawn', source: 'idle' }, first)).toBe('*yawn*');
    expect(pickEmoteMessage({ kind: 'behavior', behavior: 'stretch', source: 'idle' }, first)).toBe('*stretch*');
    expect(pickEmoteMessage({ kind: 'behavior', behavior: 'look_around', source: 'idle' }, first)).toBe('hmm...');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'doze' }, first)).toBe('zzz');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'sleeping' }, () => 0.99)).toBe('*snore*');
  });

  it('randomizes within a mood message set', () => {
    expect(pickEmoteMessage({ kind: 'mood', mood: 'excited' }, () => 0)).toBe('Hi there!');
    expect(pickEmoteMessage({ kind: 'mood', mood: 'excited' }, () => 0.99)).toBe('Wheee!');
  });

  it('returns null for moods and behaviors with no phrases', () => {
    expect(pickEmoteMessage({ kind: 'mood', mood: 'thinking' }, () => 0)).toBeNull();
    expect(pickEmoteMessage({ kind: 'mood', mood: 'idle' }, () => 0)).toBeNull();
    expect(pickEmoteMessage({ kind: 'behavior', behavior: 'blink', source: 'idle' }, () => 0)).toBeNull();
  });
});

describe('shouldShowEmoteBubble suppression (CLA-13)', () => {
  const moodTrigger = { kind: 'mood', mood: 'happy' } as const;

  it('shows for a mood trigger when nothing suppresses it', () => {
    expect(
      shouldShowEmoteBubble({ trigger: moodTrigger, suppression: noSuppression, lastBubbleAt: null, now: NOW })
    ).toBe(true);
  });

  it('never shows while the lobster is actively talking', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: { ...noSuppression, talking: true },
        lastBubbleAt: null,
        now: NOW,
      })
    ).toBe(false);
  });

  it('never shows while the pet chat bubble is open', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: { ...noSuppression, petChatOpen: true },
        lastBubbleAt: null,
        now: NOW,
      })
    ).toBe(false);
  });

  it('never shows while the assistant panel is open', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: { ...noSuppression, assistantOpen: true },
        lastBubbleAt: null,
        now: NOW,
      })
    ).toBe(false);
  });

  it('never shows while the chatbar is open — the CLA-27 curious trigger stays silent', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: { kind: 'mood', mood: 'curious' },
        suppression: { ...noSuppression, chatbarOpen: true },
        lastBubbleAt: null,
        now: NOW,
      })
    ).toBe(false);
  });
});

describe('shouldShowEmoteBubble rate limiting (CLA-13)', () => {
  const moodTrigger = { kind: 'mood', mood: 'happy' } as const;

  it('blocks a bubble that fires too soon after the previous one', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: noSuppression,
        lastBubbleAt: NOW - MIN_BUBBLE_GAP_MS + 1,
        now: NOW,
      })
    ).toBe(false);
  });

  it('allows a bubble once the minimum gap has elapsed', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: noSuppression,
        lastBubbleAt: NOW - MIN_BUBBLE_GAP_MS,
        now: NOW,
      })
    ).toBe(true);
  });

  it('only sometimes bubbles idle behaviors (probability gate)', () => {
    const behaviorTrigger = { kind: 'behavior', behavior: 'yawn', source: 'idle' } as const;
    expect(
      shouldShowEmoteBubble({
        trigger: behaviorTrigger,
        suppression: noSuppression,
        lastBubbleAt: null,
        now: NOW,
        random: () => 0,
      })
    ).toBe(true);
    expect(
      shouldShowEmoteBubble({
        trigger: behaviorTrigger,
        suppression: noSuppression,
        lastBubbleAt: null,
        now: NOW,
        random: () => 0.99,
      })
    ).toBe(false);
  });

  it('always bubbles poke-sourced behaviors — a direct click is intentional interaction', () => {
    const pokeTrigger = { kind: 'behavior', behavior: 'yawn', source: 'poke' } as const;
    expect(
      shouldShowEmoteBubble({
        trigger: pokeTrigger,
        suppression: noSuppression,
        lastBubbleAt: null,
        now: NOW,
        random: () => 0.99,
      })
    ).toBe(true);
  });

  it('still rate-limits and suppresses poke-sourced behaviors', () => {
    const pokeTrigger = { kind: 'behavior', behavior: 'yawn', source: 'poke' } as const;
    expect(
      shouldShowEmoteBubble({
        trigger: pokeTrigger,
        suppression: noSuppression,
        lastBubbleAt: NOW - MIN_BUBBLE_GAP_MS + 1,
        now: NOW,
        random: () => 0,
      })
    ).toBe(false);
    expect(
      shouldShowEmoteBubble({
        trigger: pokeTrigger,
        suppression: { ...noSuppression, chatbarOpen: true },
        lastBubbleAt: null,
        now: NOW,
        random: () => 0,
      })
    ).toBe(false);
  });

  it('does not apply the probability gate to mood triggers', () => {
    expect(
      shouldShowEmoteBubble({
        trigger: moodTrigger,
        suppression: noSuppression,
        lastBubbleAt: null,
        now: NOW,
        random: () => 0.99,
      })
    ).toBe(true);
  });
});

describe('emoteBubbleDurationMs (CLA-13)', () => {
  it('stays within the 1000-1500ms spec window', () => {
    expect(emoteBubbleDurationMs(() => 0)).toBe(BUBBLE_MIN_DURATION_MS);
    expect(emoteBubbleDurationMs(() => 0.999999)).toBe(BUBBLE_MAX_DURATION_MS);
    for (const r of [0.1, 0.5, 0.9]) {
      const duration = emoteBubbleDurationMs(() => r);
      expect(duration).toBeGreaterThanOrEqual(BUBBLE_MIN_DURATION_MS);
      expect(duration).toBeLessThanOrEqual(BUBBLE_MAX_DURATION_MS);
    }
  });
});

// CLA-27: chatbar open → curious, close → back to idle
describe('chatbarMoodTransition (CLA-27)', () => {
  it('goes curious when the chatbar opens while idle', () => {
    expect(chatbarMoodTransition(true, 'idle', false)).toBe('curious');
  });

  it('does not re-trigger when already curious', () => {
    expect(chatbarMoodTransition(true, 'curious', false)).toBeNull();
  });

  it('returns to idle when the chatbar closes while curious', () => {
    expect(chatbarMoodTransition(false, 'curious', false)).toBe('idle');
  });

  it('leaves other moods alone when the chatbar closes', () => {
    expect(chatbarMoodTransition(false, 'happy', false)).toBeNull();
    expect(chatbarMoodTransition(false, 'idle', false)).toBeNull();
  });

  it('never disturbs a sleeping lobster', () => {
    expect(chatbarMoodTransition(true, 'sleeping', true)).toBeNull();
    expect(chatbarMoodTransition(false, 'sleeping', true)).toBeNull();
  });
});

// CLA-27: any idle-landing mood transition holds curious while the chatbar
// is open — covers emotion-engine pushes, the wake sequence's delayed idle,
// and chat dismiss, not just the renderer's timed reverts.
describe('applyChatbarCuriousHold (CLA-27)', () => {
  it('maps idle to curious while the chatbar is open and the pet is awake', () => {
    expect(applyChatbarCuriousHold('idle', true, false)).toBe('curious');
  });

  it('lands on idle as usual when the chatbar is closed', () => {
    expect(applyChatbarCuriousHold('idle', false, false)).toBe('idle');
  });

  it('leaves non-idle moods untouched even while the chatbar is open', () => {
    expect(applyChatbarCuriousHold('happy', true, false)).toBe('happy');
    expect(applyChatbarCuriousHold('startle', true, false)).toBe('startle');
    expect(applyChatbarCuriousHold('curious', true, false)).toBe('curious');
  });

  it('never rewrites sleep moods', () => {
    expect(applyChatbarCuriousHold('sleeping', true, false)).toBe('sleeping');
    expect(applyChatbarCuriousHold('doze', true, false)).toBe('doze');
  });

  it('does not hold curious for a sleep-locked pet', () => {
    expect(applyChatbarCuriousHold('idle', true, true)).toBe('idle');
  });
});
