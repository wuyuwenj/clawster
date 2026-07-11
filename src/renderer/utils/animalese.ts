/**
 * Animalese-style voice synthesizer for Clawster (v2 — sampled + prosody + mood)
 *
 * v1 synthesized every character with a square-wave oscillator, which sounded
 * robotic and digital. v2 plays back short *sampled* voice clips (one per
 * letter) and pitch-shifts them per character with `AudioBufferSourceNode`'s
 * `playbackRate` — the classic Animal-Crossing "Animalese" technique — for a
 * real vocal timbre. The expressive layer (sentence pitch contour, mood →
 * pitch/speed, punctuation prosody, trail-off) lives in the pure
 * `./animalese-prosody` module so it can be unit-tested without audio.
 *
 * The clips are private, licensed assets bundled at build time and gitignored
 * (see `src/renderer/assets/voice/README.md`). When they are absent — public
 * checkout, CI, unit tests — the engine degrades **silently**: the mouth
 * animation still runs, there is just no audio. Muting (`pet.muted`, CLA-52) is
 * always honored and never bypassed.
 */

import {
  planUtterance,
  inferVoiceMood,
  type MouthShape,
  type VoiceMood,
  type VoiceStep,
} from './animalese-prosody';

// Re-export the pure prosody API so existing importers of this module (and
// tests) keep a single entry point.
export {
  planUtterance,
  moodToVoice,
  inferVoiceMood,
} from './animalese-prosody';
export type { MouthShape, VoiceMood, VoiceStep } from './animalese-prosody';

interface AnimaleseOptions {
  /** Base pitch multiplier (1.0 = normal, higher = cuter). */
  pitch?: number;
  /** Base speed in ms per character. */
  speed?: number;
  /** Master volume 0-1. */
  volume?: number;
}

type VisemeCallback = (mouth: MouthShape | null) => void;

type RendererSettings = {
  pet?: {
    muted?: boolean;
  };
};

/** Discover bundled voice clips at build time (empty when none are present). */
function defaultClipUrls(): Record<string, string> {
  // Eager URL glob: Vite resolves this to `{}` when the folder holds no audio,
  // which is exactly the public/CI/test case → silent degradation. In tests the
  // glob also resolves to `{}`, and a bank can be injected via the constructor.
  const modules = import.meta.glob('../assets/voice/*.{wav,mp3,ogg,aiff,m4a,flac}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;

  const urls: Record<string, string> = {};
  for (const [path, url] of Object.entries(modules)) {
    const name = path.split('/').pop() ?? '';
    const key = name.replace(/\.[^.]+$/, '').toLowerCase();
    if (key) urls[key] = url;
  }
  return urls;
}

interface EngineDeps {
  /** grapheme → clip URL. Defaults to the bundled glob. */
  clipUrls?: Record<string, string>;
  /** Pre-decoded bank, bypassing fetch/decode (used by tests). */
  voiceBank?: Map<string, AudioBuffer>;
}

// Fallback preference order when a specific letter clip is missing but the bank
// is non-empty, so partial banks still render every input.
const FALLBACK_KEYS = ['a', 'e', 'o', 'u', 'i', 'm', 'n'];

export class AnimaleseEngine {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private playbackToken = 0;
  private pendingTimeout: number | null = null;
  private volume = 0.15;
  private pitch = 1.2; // Cute baseline; mood profiles multiply on top.
  private speed = 60; // ms per character
  private visemeCallback: VisemeCallback | null = null;
  private muted = false;
  private mutedInitialized = false;

  private readonly clipUrls: Record<string, string>;
  private voiceBank: Map<string, AudioBuffer>;
  private bankLoaded: boolean;
  private bankLoadPromise: Promise<void> | null = null;

  constructor(deps: EngineDeps = {}) {
    this.clipUrls = deps.clipUrls ?? defaultClipUrls();
    this.voiceBank = deps.voiceBank ?? new Map();
    // A pre-supplied bank (tests) or an empty clip list (public/CI) needs no load.
    this.bankLoaded = deps.voiceBank !== undefined || Object.keys(this.clipUrls).length === 0;
  }

  /** True when audio output must be suppressed (automated tests / CLAWSTER_MUTE_AUDIO).
   *  Read lazily so the preload bridge is available; the engine is constructed at
   *  module load, before `window.clawster` exists. */
  private isMuted(): boolean {
    return typeof window !== 'undefined' && (window as any).clawster?.audioMuted === true;
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      // Use latencyHint to help with autoplay policy in Electron
      this.audioCtx = new AudioContext({ latencyHint: 'interactive' });
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioCtx.destination);
    }
    // Always try to resume — Electron BrowserWindows may suspend audio
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  configure(options: AnimaleseOptions) {
    if (options.pitch !== undefined) this.pitch = options.pitch;
    if (options.speed !== undefined) this.speed = options.speed;
    if (options.volume !== undefined) {
      this.volume = options.volume;
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume;
      }
    }
  }

  /** True when at least one voice clip is available to play. */
  get hasVoiceBank(): boolean {
    return this.voiceBank.size > 0;
  }

  /**
   * Decode the bundled clips once. Resolves immediately (no-op) when there are
   * no clips — the silent degradation path — so callers never block on it.
   */
  private ensureBankLoaded(): Promise<void> {
    if (this.bankLoaded) return Promise.resolve();
    if (this.bankLoadPromise) return this.bankLoadPromise;
    this.bankLoadPromise = this.loadBank();
    return this.bankLoadPromise;
  }

  private async loadBank(): Promise<void> {
    const entries = Object.entries(this.clipUrls);
    if (entries.length === 0 || typeof fetch === 'undefined') {
      this.bankLoaded = true;
      return;
    }
    const ctx = this.getAudioContext();
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(arr);
          this.voiceBank.set(key, buf);
        } catch {
          // A clip that fails to load just stays silent.
        }
      }),
    );
    this.bankLoaded = true;
  }

  private resolveBuffer(grapheme: string): AudioBuffer | null {
    const direct = this.voiceBank.get(grapheme);
    if (direct) return direct;
    if (this.voiceBank.size === 0) return null;
    for (const key of FALLBACK_KEYS) {
      const buf = this.voiceBank.get(key);
      if (buf) return buf;
    }
    // Any clip is better than silence for coverage.
    const first = this.voiceBank.values().next();
    return first.done ? null : first.value;
  }

  private playStep(step: VoiceStep): void {
    if (!step.voiced) return;
    const buffer = this.resolveBuffer(step.grapheme);
    if (!buffer) return; // No clip → silent (graceful degradation).

    const ctx = this.getAudioContext();
    if (!this.gainNode) return;

    const time = ctx.currentTime + 0.01;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(step.playbackRate, time);

    // Per-step gain for emphasis / trail-off, with a tiny attack to avoid clicks
    // at clip boundaries.
    const env = ctx.createGain();
    const peak = Math.max(0.0001, step.gain);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.006);

    source.connect(env);
    env.connect(this.gainNode);
    source.start(time);
  }

  /**
   * Live mute state. Pushed from the main process so muting takes effect
   * mid-utterance rather than on the next message.
   */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.mutedInitialized = true;
  }

  /** Seed mute state from persisted settings until the first live update arrives. */
  private async syncMutedFromSettings(): Promise<void> {
    if (this.mutedInitialized) return;
    try {
      if (typeof window === 'undefined' || !window.clawster?.getSettings) return;
      const settings = (await window.clawster.getSettings()) as RendererSettings;
      if (this.mutedInitialized) return;
      this.muted = Boolean(settings.pet?.muted);
      this.mutedInitialized = true;
    } catch {
      // Leave the default (unmuted) in place and retry on the next utterance.
    }
  }

  /**
   * Play Animalese sounds for a string of text.
   *
   * @param text  The text to voice.
   * @param mood  Optional voice mood; when omitted it is inferred from the text.
   * Returns a promise that resolves when playback completes or is cancelled.
   */
  async speak(text: string, mood?: VoiceMood): Promise<void> {
    // Cancel any ongoing speech
    this.stop();

    if (!text || text.trim().length === 0) return;

    // Audio-safety: in tests / muted mode, produce NO sound (mock audio output)
    // and never open an AudioContext. Resolve immediately.
    if (this.isMuted()) return;

    this.isPlaying = true;
    const playbackToken = ++this.playbackToken;
    await this.syncMutedFromSettings();
    // Load clips (no-op when absent) before scheduling so audio and mouth stay
    // in sync from the first character.
    await this.ensureBankLoaded();
    if (this.playbackToken !== playbackToken) return;

    const resolvedMood = mood ?? inferVoiceMood(text);
    const steps = planUtterance(text, resolvedMood, {
      baseSpeedMs: this.speed,
      basePitch: this.pitch,
    });

    let stepIndex = 0;

    return new Promise<void>((resolve) => {
      const playNext = () => {
        if (this.playbackToken !== playbackToken) {
          resolve();
          return;
        }

        if (stepIndex >= steps.length) {
          this.clearPendingTimeout();
          this.isPlaying = false;
          this.visemeCallback?.(null);
          resolve();
          return;
        }

        const step = steps[stepIndex];
        stepIndex++;

        // Emit viseme for this step (drives the mouth animation).
        this.visemeCallback?.(step.viseme);

        // Play audio for this step unless muted.
        if (!this.muted) {
          this.playStep(step);
        }

        // Schedule next step.
        this.pendingTimeout = window.setTimeout(playNext, step.delayMs);
      };

      playNext();
    });
  }

  /** Register a callback for mouth shape changes */
  onViseme(callback: VisemeCallback | null) {
    this.visemeCallback = callback;
  }

  /** Stop any currently playing speech */
  stop() {
    this.playbackToken += 1;
    this.clearPendingTimeout();
    this.isPlaying = false;
    this.visemeCallback?.(null);
  }

  private clearPendingTimeout() {
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  get playing(): boolean {
    return this.isPlaying;
  }
}

// Singleton instance
export const animalese = new AnimaleseEngine();
