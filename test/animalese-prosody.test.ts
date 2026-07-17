import { describe, expect, it } from 'vitest';
import {
  planUtterance,
  moodToVoice,
  inferVoiceMood,
  type VoiceStep,
} from '../src/renderer/utils/animalese-prosody';

// Zero out the pitch jitter so prosody is deterministic and assertable.
const flat = { rng: () => 0.5, baseSpeedMs: 100, basePitch: 1.2 };

const voiced = (steps: VoiceStep[]) => steps.filter((s) => s.voiced);

describe('planUtterance — coverage and skip rules', () => {
  it('renders a step for every character of any input', () => {
    const steps = planUtterance('Hi 5! 😀 café 中', 'neutral', flat);
    // One step per (trailing-trimmed) character — nothing silently dropped.
    expect(steps.length).toBe(Array.from('Hi 5! 😀 café 中').length);
  });

  it('voices Latin letters and skips numbers, emoji, and non-Latin letters', () => {
    const steps = planUtterance('a1é😀中b', 'neutral', flat);
    const byChar = Object.fromEntries(steps.map((s) => [s.char, s.voiced]));
    expect(byChar['a']).toBe(true);
    expect(byChar['b']).toBe(true);
    expect(byChar['1']).toBe(false);
    expect(byChar['é']).toBe(false);
    expect(byChar['😀']).toBe(false);
    expect(byChar['中']).toBe(false);
    // Skipped characters still close the mouth rather than vanish.
    for (const s of steps) if (!s.voiced) expect(s.viseme).toBe('closed');
  });

  it('trims trailing whitespace and returns nothing for blank input', () => {
    expect(planUtterance('   ', 'neutral', flat)).toEqual([]);
    expect(planUtterance('', 'neutral', flat)).toEqual([]);
    const steps = planUtterance('hi   ', 'neutral', flat);
    expect(steps[steps.length - 1].char).toBe('i');
  });

  it('preserves the v1 viseme mapping for mouth sync', () => {
    const steps = planUtterance('ab', 'neutral', flat);
    expect(steps.map((s) => s.viseme)).toEqual(['happy', 'mad']);
  });
});

describe('planUtterance — mood affects pitch and speed', () => {
  const rateOf = (text: string, mood: Parameters<typeof planUtterance>[1]) =>
    voiced(planUtterance(text, mood, flat))[0].playbackRate;
  const delayOf = (text: string, mood: Parameters<typeof planUtterance>[1]) =>
    voiced(planUtterance(text, mood, flat))[0].delayMs;

  it('raises pitch for excited/happy and lowers it for sad/sleepy', () => {
    const neutral = rateOf('mom', 'neutral');
    expect(rateOf('mom', 'excited')).toBeGreaterThan(neutral);
    expect(rateOf('mom', 'happy')).toBeGreaterThan(neutral);
    expect(rateOf('mom', 'sad')).toBeLessThan(neutral);
    expect(rateOf('mom', 'sleepy')).toBeLessThan(neutral);
  });

  it('speaks faster when excited and slower when sleepy', () => {
    const neutral = delayOf('mom', 'neutral');
    expect(delayOf('mom', 'excited')).toBeLessThan(neutral);
    expect(delayOf('mom', 'sleepy')).toBeGreaterThan(neutral);
  });
});

describe('planUtterance — sentence pitch contour', () => {
  it('rises toward a question mark', () => {
    const v = voiced(planUtterance('are you okay?', 'neutral', flat));
    expect(v[v.length - 1].playbackRate).toBeGreaterThan(v[0].playbackRate);
  });

  it('settles downward across a statement (natural declination)', () => {
    const v = voiced(planUtterance('this is fine.', 'neutral', flat));
    expect(v[v.length - 1].playbackRate).toBeLessThan(v[0].playbackRate);
  });
});

describe('planUtterance — trail-off ("knows when to stop")', () => {
  it('fades the gain of the final sentence toward silence', () => {
    const v = voiced(planUtterance('okay then', 'neutral', flat));
    const last = v[v.length - 1].gain;
    const secondLast = v[v.length - 2].gain;
    const earlier = v[0].gain;
    expect(last).toBeLessThan(secondLast);
    expect(secondLast).toBeLessThan(earlier);
  });

  it('fades an ellipsis ending even softer', () => {
    const normal = voiced(planUtterance('goodbye now', 'neutral', flat));
    const ellipsis = voiced(planUtterance('goodbye now...', 'neutral', flat));
    expect(ellipsis[ellipsis.length - 1].gain).toBeLessThan(
      normal[normal.length - 1].gain,
    );
  });

  it('keeps 1-2 letter final sentences at full volume', () => {
    for (const text of ['Hi', 'ok', 'a!', 'no...']) {
      for (const step of voiced(planUtterance(text, 'neutral', flat))) {
        expect(step.gain).toBe(1);
      }
    }
  });

  it('shrinks the fade window for shortish final sentences', () => {
    // 3 voiced letters → only the last char softens, and only gently.
    const v = voiced(planUtterance('yay!', 'neutral', flat));
    expect(v.map((s) => s.gain)).toEqual([1, 1, 0.85]);
  });
});

describe('planUtterance — punctuation prosody', () => {
  const delayForChar = (text: string, ch: string): number => {
    const step = planUtterance(text, 'neutral', flat).find((s) => s.char === ch);
    if (!step) throw new Error(`no step for ${ch}`);
    return step.delayMs;
  };

  it('pauses longer at a comma than at a space', () => {
    const steps = planUtterance('a, b', 'neutral', flat);
    const comma = steps.find((s) => s.char === ',')!;
    const space = steps.find((s) => s.char === ' ')!;
    expect(comma.delayMs).toBeGreaterThan(space.delayMs);
  });

  it('settles longest at a sentence terminator, and an ellipsis lingers most', () => {
    const period = delayForChar('done.', '.');
    const comma = planUtterance('a, b', 'neutral', flat).find((s) => s.char === ',')!.delayMs;
    expect(period).toBeGreaterThan(comma);

    const ellipsisSteps = planUtterance('wait...', 'neutral', flat);
    const lastDot = ellipsisSteps[ellipsisSteps.length - 1];
    expect(lastDot.delayMs).toBeGreaterThan(period);
  });
});

describe('moodToVoice mapping', () => {
  it('maps app moods onto voice moods and defaults to neutral', () => {
    expect(moodToVoice('excited')).toBe('excited');
    expect(moodToVoice('proud')).toBe('happy');
    expect(moodToVoice('curious')).toBe('curious');
    expect(moodToVoice('worried')).toBe('sad');
    expect(moodToVoice('sleeping')).toBe('sleepy');
    expect(moodToVoice('idle')).toBe('neutral');
    expect(moodToVoice('huff')).toBe('mad');
    expect(moodToVoice('something-unknown')).toBe('neutral');
    expect(moodToVoice(null)).toBe('neutral');
  });
});

describe('inferVoiceMood from text', () => {
  it('infers mood from punctuation and casing', () => {
    expect(inferVoiceMood('let me think...')).toBe('sleepy');
    expect(inferVoiceMood('is that you?')).toBe('curious');
    expect(inferVoiceMood('WOW that is amazing!')).toBe('excited');
    expect(inferVoiceMood('yay!')).toBe('happy');
    expect(inferVoiceMood('okay sure')).toBe('neutral');
    expect(inferVoiceMood('   ')).toBe('neutral');
  });
});
