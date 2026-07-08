// CLA-13: speech-bubble emote system — pure logic for message selection,
// suppression, and rate limiting. CLA-27: chatbar open/close → mood transition.
// Kept free of React/Electron imports so unit tests can exercise it directly.

export type EmoteTrigger =
  | { kind: 'mood'; mood: string }
  | { kind: 'behavior'; behavior: string; source: 'idle' | 'poke' }
  | { kind: 'wake' }
  | { kind: 'drag' }
  | { kind: 'irritation'; level: 'mildly-annoyed' | 'very-annoyed' };

export interface EmoteSuppression {
  /** Lobster is actively talking/responding (Animalese mouth active) */
  talking: boolean;
  /** Pet chat bubble window is visible */
  petChatOpen: boolean;
  /** Assistant panel window is visible */
  assistantOpen: boolean;
  /** Chatbar window is visible */
  chatbarOpen: boolean;
}

/** Minimum gap between bubbles so not every reaction produces one */
export const MIN_BUBBLE_GAP_MS = 6000;
/** Idle behaviors only sometimes show a bubble; poke-sourced ones always do */
export const IDLE_BUBBLE_CHANCE = 0.35;
export const BUBBLE_MIN_DURATION_MS = 1000;
export const BUBBLE_MAX_DURATION_MS = 1500;

const MOOD_MESSAGES: Record<string, string[]> = {
  happy: ['Hi there!'],
  excited: ['Hi there!', 'Wheee!'],
  proud: ['Look at me!'],
  startle: ['!'],
  spin: ['Wheee!'],
  huff: ['Hmph!'],
  mad: ['...'], // crossed arms
  peek: ['Boo!'],
  'side-eye': ['I see you'],
  doze: ['zzz'],
  sleeping: ['zzz', '*snore*'],
};

const BEHAVIOR_MESSAGES: Record<string, string[]> = {
  yawn: ['*yawn*'],
  stretch: ['*stretch*'],
  look_around: ['hmm...'],
  wander: ['hmm...'],
};

const WAKE_MESSAGES = ['!', '*yawn*'];
const DRAG_MESSAGES = ['Wheee!', '!'];
const IRRITATION_MESSAGES: Record<'mildly-annoyed' | 'very-annoyed', string[]> = {
  'mildly-annoyed': ['Hmph!'],
  'very-annoyed': ['Hey!'],
};

export function pickEmoteMessage(
  trigger: EmoteTrigger,
  random: () => number = Math.random
): string | null {
  let pool: string[] | undefined;
  switch (trigger.kind) {
    case 'mood':
      pool = MOOD_MESSAGES[trigger.mood];
      break;
    case 'behavior':
      pool = BEHAVIOR_MESSAGES[trigger.behavior];
      break;
    case 'wake':
      pool = WAKE_MESSAGES;
      break;
    case 'drag':
      pool = DRAG_MESSAGES;
      break;
    case 'irritation':
      pool = IRRITATION_MESSAGES[trigger.level];
      break;
  }
  if (!pool || pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}

export function shouldShowEmoteBubble(options: {
  trigger: EmoteTrigger;
  suppression: EmoteSuppression;
  lastBubbleAt: number | null;
  now: number;
  random?: () => number;
}): boolean {
  const { trigger, suppression, lastBubbleAt, now } = options;
  const random = options.random ?? Math.random;

  // Never bubble over an active conversation or open chat UI
  if (suppression.talking) return false;
  if (suppression.petChatOpen || suppression.assistantOpen || suppression.chatbarOpen) return false;

  if (trigger.kind === 'irritation') return true;

  if (lastBubbleAt !== null && now - lastBubbleAt < MIN_BUBBLE_GAP_MS) return false;

  if (trigger.kind === 'behavior' && trigger.source === 'idle' && random() >= IDLE_BUBBLE_CHANCE) {
    return false;
  }

  return true;
}

export function emoteBubbleDurationMs(random: () => number = Math.random): number {
  return Math.round(
    BUBBLE_MIN_DURATION_MS + random() * (BUBBLE_MAX_DURATION_MS - BUBBLE_MIN_DURATION_MS)
  );
}

// CLA-27: chatbar visibility drives the idle ↔ curious mood. Returns the mood
// to apply, or null when the current mood should be left alone (asleep, or a
// non-chatbar mood is showing when the chatbar closes).
export function chatbarMoodTransition(
  chatbarOpen: boolean,
  currentMood: string,
  sleepLocked: boolean
): string | null {
  if (sleepLocked) return null;
  if (chatbarOpen) return currentMood === 'curious' ? null : 'curious';
  return currentMood === 'curious' ? 'idle' : null;
}

// CLA-27: while the chatbar is open, an awake pet holds curious — any mood
// transition that would land on idle lands on curious instead, regardless of
// which path (timed revert, emotion engine, wake sequence, chat dismiss)
// requested it.
//
// This does NOT disturb sleep. Sleep moods ('sleeping'/'doze') are never idle,
// so they pass through untouched. The one case that reaches here while the pet
// is still sleep-locked is a clawbot 'idle' push — and 'idle' is itself a wake
// transition (it clears the sleep lock in setPetMood). Whether it lands on
// 'idle' or 'curious', the pet wakes exactly the same; only the visible mood
// differs, so honoring the chatbar hold here changes no sleep behavior.
export function applyChatbarCuriousHold(
  nextMood: string,
  chatbarOpen: boolean
): string {
  if (nextMood === 'idle' && chatbarOpen) return 'curious';
  return nextMood;
}
