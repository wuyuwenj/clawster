/**
 * Animalese-style voice synthesizer for Clawster
 *
 * Generates gibberish speech sounds that play as text appears,
 * similar to Animal Crossing's "Animalese" dialogue.
 *
 * Uses Web Audio API to synthesize short vocal blips per character
 * with pitch variation based on the letter.
 */

// Base frequencies for vowels (more resonant, longer)
const VOWEL_FREQS: Record<string, number> = {
  a: 420,
  e: 480,
  i: 520,
  o: 390,
  u: 360,
};

// Consonants get a mid-range buzz
const CONSONANT_BASE = 440;

// Character to relative pitch offset (gives each letter a unique sound)
const LETTER_OFFSETS: Record<string, number> = {
  a: 0, b: 15, c: 30, d: -10, e: 5, f: 25, g: -15, h: 35,
  i: 10, j: -20, k: 40, l: -5, m: 20, n: -25, o: -8, p: 45,
  q: -30, r: 12, s: 50, t: -12, u: -3, v: 28, w: -18, x: 55,
  y: 8, z: -35,
};

/** Mouth shape visemes matching Clawster's SVG mouths */
export type MouthShape = 'neutral' | 'happy' | 'o' | 'worried' | 'mad' | 'closed';

/** Map characters to mouth shapes */
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

interface AnimaleseOptions {
  /** Pitch multiplier (1.0 = normal, 1.3 = higher/cuter) */
  pitch?: number;
  /** Speed in ms per character */
  speed?: number;
  /** Volume 0-1 */
  volume?: number;
}

type VisemeCallback = (mouth: MouthShape | null) => void;

class AnimaleseEngine {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private cancelFlag = false;
  private volume = 0.15;
  private pitch = 1.25; // Slightly pitched up for Clawster's cute digital vibe
  private speed = 60; // ms per character
  private visemeCallback: VisemeCallback | null = null;

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

  private playCharSound(char: string, time: number): number {
    const ctx = this.getAudioContext();
    if (!this.gainNode) return 0;

    const lower = char.toLowerCase();

    // Skip non-letter characters (silence)
    if (!/[a-z]/.test(lower)) {
      return lower === ' ' ? this.speed * 0.5 : this.speed * 0.3;
    }

    const isVowel = 'aeiou'.includes(lower);
    const baseFreq = isVowel ? VOWEL_FREQS[lower] : CONSONANT_BASE;
    const offset = LETTER_OFFSETS[lower] || 0;

    // Add slight randomization for natural feel
    const randomPitch = 1 + (Math.random() - 0.5) * 0.1;
    const freq = (baseFreq + offset) * this.pitch * randomPitch;

    const duration = isVowel ? this.speed / 1000 * 1.2 : this.speed / 1000 * 0.8;

    // Main oscillator (square wave for that digital/retro feel)
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);

    // Slight pitch slide for natural feel
    const slideTarget = freq * (0.95 + Math.random() * 0.1);
    osc.frequency.linearRampToValueAtTime(slideTarget, time + duration * 0.7);

    // Envelope for each blip
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(1, time + 0.008); // Quick attack
    envelope.gain.setValueAtTime(1, time + duration * 0.4);
    envelope.gain.exponentialRampToValueAtTime(0.01, time + duration); // Decay

    // Low-pass filter for softer, more vocal sound
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isVowel ? 2000 : 3000, time);
    filter.Q.setValueAtTime(2, time);

    // Connect: osc → filter → envelope → master gain → output
    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.gainNode);

    osc.start(time);
    osc.stop(time + duration + 0.01);

    return this.speed;
  }

  /**
   * Play Animalese sounds for a string of text.
   * Returns a promise that resolves when playback completes or is cancelled.
   */
  async speak(text: string): Promise<void> {
    // Cancel any ongoing speech
    this.stop();

    if (!text || text.trim().length === 0) return;

    this.isPlaying = true;
    this.cancelFlag = false;

    const chars = Array.from(text);
    let charIndex = 0;

    return new Promise<void>((resolve) => {
      const playNext = () => {
        if (this.cancelFlag || charIndex >= chars.length) {
          this.isPlaying = false;
          this.visemeCallback?.(null);
          resolve();
          return;
        }

        const char = chars[charIndex];
        const lower = char.toLowerCase();
        charIndex++;

        // Emit viseme for this character
        const mouth = CHAR_TO_MOUTH[lower] || null;
        if (mouth) {
          this.visemeCallback?.(mouth);
        } else {
          // Space/punctuation = close mouth briefly
          this.visemeCallback?.('closed');
        }

        // Play audio for this character
        const ctx = this.getAudioContext();
        const delay = this.playCharSound(char, ctx.currentTime + 0.01);

        // Schedule next character
        setTimeout(playNext, delay);
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
    this.cancelFlag = true;
    this.isPlaying = false;
    this.visemeCallback?.(null);
  }

  get playing(): boolean {
    return this.isPlaying;
  }
}

// Singleton instance
export const animalese = new AnimaleseEngine();
