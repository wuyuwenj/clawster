import { screen } from 'electron';

export interface EmotionState {
  valence: number;   // -1 (sad) to +1 (happy)
  arousal: number;   // 0 (sleepy) to 1 (energetic)
  attention: number; // 0 (neglected) to 100 (just interacted)
  mood: string;      // derived animation state
}

type MoodChangedCallback = (mood: string, state: EmotionState) => void;

const TICK_INTERVAL_MS = 10000;
const ATTENTION_DECAY_PER_TICK = 1.5;
const VALENCE_DECAY_RATE = 0.02;
const AROUSAL_DECAY_RATE = 0.03;
const INTERACTION_ATTENTION_BOOST = 30;
const INTERACTION_VALENCE_BOOST = 0.15;
const INTERACTION_AROUSAL_BOOST = 0.2;
const MOOD_BOOST_FACTOR = 0.3;

const MOOD_VALENCE_MAP: Record<string, number> = {
  happy: 0.6, excited: 0.8, proud: 0.5, spin: 0.9,
  curious: 0.1, idle: 0, peek: 0.05,
  worried: -0.4, mad: -0.6, huff: -0.5, crossed: -0.4,
  sad: -0.7, tap: -0.2, 'side-eye': -0.1,
  sleeping: 0, doze: 0,
};

const MOOD_AROUSAL_MAP: Record<string, number> = {
  happy: 0.6, excited: 0.9, proud: 0.3, spin: 0.95,
  curious: 0.5, idle: 0.2, peek: 0.4,
  worried: 0.7, mad: 0.8, huff: 0.7, crossed: 0.5,
  sad: 0.2, tap: 0.4, 'side-eye': 0.3,
  sleeping: 0, doze: 0.05,
};

export class EmotionEngine {
  private valence: number = 0.1;
  private arousal: number = 0.3;
  private attention: number = 50;
  private currentMood: string = 'idle';
  private tickInterval: NodeJS.Timeout | null = null;
  private lastInteractionTime: number = Date.now();
  private interactionCount: number = 0;
  private interactionWindow: number[] = [];
  private onMoodChanged: MoodChangedCallback | null = null;

  start(callback: MoodChangedCallback): void {
    this.onMoodChanged = callback;
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  getState(): EmotionState {
    return {
      valence: this.valence,
      arousal: this.arousal,
      attention: this.attention,
      mood: this.currentMood,
    };
  }

  onInteraction(): void {
    this.lastInteractionTime = Date.now();
    this.attention = Math.min(100, this.attention + INTERACTION_ATTENTION_BOOST);
    this.valence = Math.min(1, this.valence + INTERACTION_VALENCE_BOOST);
    this.arousal = Math.min(1, this.arousal + INTERACTION_AROUSAL_BOOST);

    const now = Date.now();
    this.interactionWindow = this.interactionWindow.filter(t => now - t < 30000);
    this.interactionWindow.push(now);

    if (this.interactionWindow.length > 5) {
      this.arousal = Math.min(1, this.arousal + 0.15);
      this.valence = Math.min(1, this.valence + 0.1);
    }

    this.updateMood();
  }

  onConversationMood(mood: string): void {
    const targetValence = MOOD_VALENCE_MAP[mood];
    const targetArousal = MOOD_AROUSAL_MAP[mood];
    if (targetValence !== undefined) {
      this.valence += (targetValence - this.valence) * MOOD_BOOST_FACTOR;
    }
    if (targetArousal !== undefined) {
      this.arousal += (targetArousal - this.arousal) * MOOD_BOOST_FACTOR;
    }
    this.valence = clamp(this.valence, -1, 1);
    this.arousal = clamp(this.arousal, 0, 1);
    this.updateMood();
  }

  onAppSwitch(appName: string): void {
    const funApps = ['spotify', 'music', 'discord', 'messages', 'facetime'];
    const workApps = ['terminal', 'code', 'xcode', 'figma', 'notion'];

    const lower = appName.toLowerCase();
    if (funApps.some(a => lower.includes(a))) {
      this.valence += 0.1;
      this.arousal += 0.1;
    } else if (workApps.some(a => lower.includes(a))) {
      this.arousal -= 0.05;
    }

    this.arousal += 0.05;
    this.valence = clamp(this.valence, -1, 1);
    this.arousal = clamp(this.arousal, 0, 1);
    this.updateMood();
  }

  private tick(): void {
    const now = Date.now();
    const idleSeconds = (now - this.lastInteractionTime) / 1000;
    const hour = new Date().getHours();

    this.attention = Math.max(0, this.attention - ATTENTION_DECAY_PER_TICK);
    this.valence = this.valence * (1 - VALENCE_DECAY_RATE);
    this.arousal = this.arousal * (1 - AROUSAL_DECAY_RATE);

    // Time-of-day modulation
    if (hour >= 23 || hour < 6) {
      this.arousal *= 0.95;
    } else if (hour >= 7 && hour <= 9) {
      this.arousal = Math.min(1, this.arousal + 0.02);
    } else if (hour >= 17 && hour <= 19) {
      this.arousal = Math.min(1, this.arousal + 0.01);
    }

    // Neglect responses
    if (this.attention < 20 && idleSeconds > 120) {
      this.valence -= 0.02;
    }
    if (this.attention < 10 && idleSeconds > 300) {
      this.valence -= 0.03;
      this.arousal -= 0.02;
    }

    // Random micro-events (5% per tick)
    if (Math.random() < 0.05) {
      const events = [
        () => { this.arousal += 0.1; }, // sudden curiosity
        () => { this.valence += 0.05; }, // happy thought
        () => { this.arousal -= 0.05; }, // mini yawn
      ];
      events[Math.floor(Math.random() * events.length)]();
    }

    this.valence = clamp(this.valence, -1, 1);
    this.arousal = clamp(this.arousal, 0, 1);
    this.updateMood();
  }

  private updateMood(): void {
    const v = this.valence;
    const a = this.arousal;
    let newMood: string;

    if (a < 0.08) {
      newMood = 'sleeping';
    } else if (a < 0.15) {
      newMood = 'doze';
    } else if (v > 0.5 && a > 0.7) {
      newMood = Math.random() < 0.3 ? 'spin' : 'excited';
    } else if (v > 0.3 && a > 0.5) {
      newMood = 'happy';
    } else if (v > 0.3 && a <= 0.5) {
      newMood = 'proud';
    } else if (v < -0.4 && a > 0.6) {
      newMood = Math.random() < 0.5 ? 'huff' : 'mad';
    } else if (v < -0.3 && a > 0.3) {
      newMood = 'worried';
    } else if (v < -0.2) {
      newMood = Math.random() < 0.5 ? 'side-eye' : 'crossed';
    } else if (a > 0.5 && this.attention < 30) {
      newMood = Math.random() < 0.5 ? 'peek' : 'tap';
    } else if (a > 0.4) {
      newMood = Math.random() < 0.3 ? 'snip' : 'curious';
    } else {
      newMood = 'idle';
    }

    if (newMood !== this.currentMood) {
      this.currentMood = newMood;
      this.onMoodChanged?.(newMood, this.getState());
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
