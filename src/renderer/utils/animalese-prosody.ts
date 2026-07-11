/**
 * Pure prosody + mood logic for Clawster's Animalese voice (CLA-53).
 *
 * This module is deliberately free of any Web Audio / React / Electron imports
 * (matching the repo convention for testable renderer logic, e.g.
 * `emote-bubbles.ts`). It turns text + a mood into a per-character plan the
 * playback engine (`animalese.ts`) schedules. Because it is pure, the whole
 * expressive layer — sentence pitch contour, mood → pitch/speed, punctuation
 * prosody, trail-off, and the emoji/number/non-Latin skip rules — can be
 * validated with plain assertions and no audio, which is exactly how the
 * clip-absent build is checked. It is also importable by offline sample-render
 * tooling that runs outside Vite.
 */

const isLetter = (lower: string): boolean => /[a-z]/.test(lower);

/** Mouth shape visemes matching Clawster's SVG mouths */
export type MouthShape = 'neutral' | 'happy' | 'o' | 'worried' | 'mad' | 'closed';

/** Map characters to mouth shapes (unchanged from v1 to preserve mouth sync) */
const CHAR_TO_MOUTH: Record<string, MouthShape> = {
  // Vowels
  a: 'happy', e: 'neutral', i: 'neutral', o: 'o', u: 'worried',
  // Closed-lip consonants
  b: 'mad', f: 'mad', m: 'mad', p: 'mad', v: 'mad', n: 'mad',
  // Open consonants
  c: 'neutral', d: 'neutral', g: 'neutral', k: 'neutral',
  j: 'neutral', l: 'neutral', r: 'neutral', s: 'neutral',
  t: 'neutral', z: 'neutral', y: 'neutral', x: 'neutral',
  // Rounded consonants
  h: 'happy', q: 'worried', w: 'o',
};

/**
 * Voice moods. A small, voice-focused set; the richer app-level `Mood`
 * (src/shared/types.ts) maps onto these via `moodToVoice()`.
 */
export type VoiceMood =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'sad'
  | 'sleepy'
  | 'mad';

interface MoodProfile {
  /** Base playback-rate (pitch) multiplier. */
  pitch: number;
  /** Cadence multiplier — >1 speaks faster (smaller per-char delays). */
  speed: number;
  /** Amount of random pitch jitter per character (0 = flat). */
  variance: number;
}

const MOOD_PROFILES: Record<VoiceMood, MoodProfile> = {
  neutral: { pitch: 1.0, speed: 1.0, variance: 0.05 },
  happy: { pitch: 1.12, speed: 1.06, variance: 0.09 },
  excited: { pitch: 1.22, speed: 1.15, variance: 0.15 },
  curious: { pitch: 1.06, speed: 0.98, variance: 0.08 },
  sad: { pitch: 0.9, speed: 0.85, variance: 0.04 },
  sleepy: { pitch: 0.84, speed: 0.72, variance: 0.03 },
  mad: { pitch: 1.04, speed: 1.12, variance: 0.13 },
};

/**
 * Map the app's rich `Mood` (or any string) onto a voice mood. Kept pure and
 * exported so callers can translate a live pet mood without importing the
 * profile table. Unknown moods fall back to neutral.
 */
export function moodToVoice(mood: string | null | undefined): VoiceMood {
  switch (mood) {
    case 'happy':
    case 'proud':
    case 'thanks':
      return 'happy';
    case 'excited':
    case 'spin':
      return 'excited';
    case 'curious':
    case 'thinking':
    case 'peek':
    case 'side-eye':
    case 'tap':
    case 'scoot':
      return 'curious';
    case 'sad':
    case 'worried':
      return 'sad';
    case 'sleeping':
    case 'doze':
    case 'idle':
      return 'sleepy';
    case 'mad':
    case 'huff':
    case 'startle':
      return 'mad';
    default:
      return 'neutral';
  }
}

/**
 * Lightweight mood inference from the text itself, used when no explicit mood is
 * supplied. Lets the voice carry emotion even before a live pet mood is wired
 * through. Deliberately simple and conservative.
 */
export function inferVoiceMood(text: string): VoiceMood {
  const trimmed = text.trim();
  if (!trimmed) return 'neutral';
  if (/\.\.\.$|…$/.test(trimmed)) return 'sleepy';
  // A shouted (all-caps) word or a double bang reads as excited rather than
  // merely happy.
  const shouty = /\b[A-Z]{2,}\b/.test(trimmed) || /!!/.test(trimmed);
  if (trimmed.includes('!') && shouty) return 'excited';
  if (trimmed.endsWith('!')) return 'happy';
  if (trimmed.endsWith('?')) return 'curious';
  return 'neutral';
}

/** One scheduled step of an utterance. */
export interface VoiceStep {
  /** The source character. */
  char: string;
  /** Lowercased letter key for clip lookup, or '' for non-letters. */
  grapheme: string;
  /** Whether this step should play a voice clip (a Latin letter). */
  voiced: boolean;
  /** Mouth shape to show for this step. */
  viseme: MouthShape;
  /** Delay (ms) to wait after this step before the next one. */
  delayMs: number;
  /** Pitch/speed multiplier applied to the clip via `playbackRate`. */
  playbackRate: number;
  /** Loudness 0..1 for this step (emphasis + trail-off). */
  gain: number;
}

export interface PlanOptions {
  /** Base ms per character (before mood speed). */
  baseSpeedMs?: number;
  /** Base pitch multiplier (Clawster's cute baseline). */
  basePitch?: number;
  /** Deterministic RNG hook for tests; defaults to Math.random. */
  rng?: () => number;
}

const SENTENCE_TERMINATORS = '.!?…';
const SOFT_PAUSE_CHARS = ',;:—–';

interface SentenceMeta {
  type: 'statement' | 'question' | 'exclamation' | 'ellipsis';
  voicedCount: number;
  /** Global index of the last terminator char in this sentence's run. */
  lastTerminatorIdx: number;
  /** True if this is the final sentence of the whole utterance. */
  isFinal: boolean;
}

const clamp = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

/**
 * Classify a run of terminator characters. Precedence: a '?' anywhere makes it a
 * question, then '!' an exclamation, then a '…'/'...' ellipsis, else statement.
 */
function classifyTerminators(run: string): SentenceMeta['type'] {
  if (run.includes('?')) return 'question';
  if (run.includes('!')) return 'exclamation';
  if (run.includes('…') || run.includes('...')) return 'ellipsis';
  return 'statement';
}

/**
 * Pitch contour multiplier for a voiced character at fractional position `p`
 * (0 = sentence start, 1 = sentence end) given the sentence type.
 */
function contourAt(type: SentenceMeta['type'], p: number): number {
  switch (type) {
    case 'question':
      // Gently dip, then rise sharply into the '?'.
      return p > 0.7 ? 1 - 0.03 * 0.7 + 0.2 * ((p - 0.7) / 0.3) : 1 - 0.03 * p;
    case 'exclamation':
      // Energetic arch, peaking mid-sentence.
      return 1.05 + 0.05 * Math.sin(p * Math.PI);
    case 'ellipsis':
      // Trails downward and slows.
      return 1 - 0.14 * p;
    case 'statement':
    default:
      // Natural declination: start slightly up, settle downward.
      return 1 + 0.05 * (0.5 - p);
  }
}

/**
 * Build the full per-character plan for an utterance. Pure and deterministic
 * given `rng`, so prosody can be asserted without any audio.
 */
export function planUtterance(
  text: string,
  mood: VoiceMood = 'neutral',
  options: PlanOptions = {},
): VoiceStep[] {
  const baseSpeedMs = options.baseSpeedMs ?? 60;
  const basePitch = options.basePitch ?? 1.2;
  const rng = options.rng ?? Math.random;
  const profile = MOOD_PROFILES[mood] ?? MOOD_PROFILES.neutral;

  // Trim trailing whitespace so we don't emit dangling silent steps — part of
  // "knowing when to stop".
  const chars = Array.from(text.replace(/\s+$/u, ''));
  if (chars.length === 0) return [];

  // --- Pass 1: segment into sentences and gather per-char sentence metadata. ---
  const sentenceOf: SentenceMeta[] = new Array(chars.length);
  const voicedIndexInSentence: number[] = new Array(chars.length).fill(-1);

  let sentenceStart = 0;
  const sentences: SentenceMeta[] = [];
  const charSentenceId: number[] = new Array(chars.length).fill(0);

  let i = 0;
  while (i < chars.length) {
    if (SENTENCE_TERMINATORS.includes(chars[i])) {
      // Consume the whole run of terminators.
      let j = i;
      let run = '';
      while (j < chars.length && SENTENCE_TERMINATORS.includes(chars[j])) {
        run += chars[j];
        j++;
      }
      const meta: SentenceMeta = {
        type: classifyTerminators(run),
        voicedCount: 0,
        lastTerminatorIdx: j - 1,
        isFinal: false,
      };
      const id = sentences.length;
      for (let k = sentenceStart; k < j; k++) charSentenceId[k] = id;
      sentences.push(meta);
      sentenceStart = j;
      i = j;
    } else {
      i++;
    }
  }
  // Trailing text with no terminator forms a final sentence.
  if (sentenceStart < chars.length) {
    const id = sentences.length;
    for (let k = sentenceStart; k < chars.length; k++) charSentenceId[k] = id;
    sentences.push({
      type: 'statement',
      voicedCount: 0,
      lastTerminatorIdx: -1,
      isFinal: false,
    });
  }
  sentences[sentences.length - 1].isFinal = true;

  // Count voiced chars per sentence and assign each its index within the sentence.
  for (let k = 0; k < chars.length; k++) {
    const meta = sentences[charSentenceId[k]];
    sentenceOf[k] = meta;
    if (isLetter(chars[k].toLowerCase())) {
      voicedIndexInSentence[k] = meta.voicedCount;
      meta.voicedCount++;
    }
  }

  // --- Pass 2: emit steps. ---
  const steps: VoiceStep[] = [];
  const baseDelay = baseSpeedMs / profile.speed;

  for (let k = 0; k < chars.length; k++) {
    const char = chars[k];
    const lower = char.toLowerCase();
    const meta = sentenceOf[k];
    const voiced = isLetter(lower);

    let viseme: MouthShape;
    let delayMs: number;
    let playbackRate = 1;
    let gain = 1;

    if (voiced) {
      viseme = CHAR_TO_MOUTH[lower] ?? 'neutral';
      delayMs = baseDelay;

      // Position within sentence (0..1) drives the contour.
      const denom = Math.max(1, meta.voicedCount - 1);
      const p = meta.voicedCount <= 1 ? 0.5 : voicedIndexInSentence[k] / denom;

      const contour = contourAt(meta.type, p);
      const jitter = 1 + (rng() - 0.5) * profile.variance;
      playbackRate = clamp(basePitch * profile.pitch * contour * jitter, 0.5, 2.0);

      // Trail-off: soften the tail so the voice fades rather than clipping off.
      const fromEnd = meta.voicedCount - 1 - voicedIndexInSentence[k];
      if (meta.isFinal) {
        // The very last sentence fades to near-silence over its final chars.
        const fade = meta.type === 'ellipsis' ? [0.15, 0.3, 0.5] : [0.35, 0.6, 0.85];
        if (fromEnd < fade.length) gain = fade[fromEnd];
      } else if (fromEnd === 0) {
        // Non-final sentences just soften their last voiced char.
        gain = 0.8;
      }
    } else if (char === ' ') {
      viseme = 'closed';
      delayMs = baseDelay * 0.5;
    } else if (SOFT_PAUSE_CHARS.includes(char)) {
      // Comma/semicolon/colon/dash — a short breath.
      viseme = 'closed';
      delayMs = baseDelay * 1.6;
    } else if (SENTENCE_TERMINATORS.includes(char)) {
      viseme = 'closed';
      // Only the final terminator of a run carries the long settling pause.
      const isLastOfRun = k === meta.lastTerminatorIdx;
      if (!isLastOfRun) {
        delayMs = baseDelay * 0.2;
      } else if (meta.type === 'ellipsis') {
        delayMs = baseDelay * 3.6; // linger
      } else {
        delayMs = baseDelay * 2.4;
      }
    } else {
      // Emoji, numbers, symbols, non-Latin letters — skipped (no audio), but we
      // still hold a brief beat and close the mouth.
      viseme = 'closed';
      delayMs = baseDelay * 0.4;
    }

    steps.push({ char, grapheme: voiced ? lower : '', voiced, viseme, delayMs, playbackRate, gain });
  }

  return steps;
}
