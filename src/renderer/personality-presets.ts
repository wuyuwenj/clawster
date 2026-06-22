// Shared personality preset list for the onboarding "Pick Your Vibe" step and
// the Settings picker. Kept in sync with PRESETS in src/main/personality.ts.

export interface RendererPreset {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
}

export const PERSONALITY_PRESETS: RendererPreset[] = [
  { id: 'chill', label: 'Chill', emoji: '😎', blurb: 'Easygoing and calm. Helps without the fuss.' },
  { id: 'chaotic', label: 'Chaotic', emoji: '⚡️', blurb: 'High-energy gremlin. Maximum hype, zero chill.' },
  { id: 'sassy', label: 'Sassy', emoji: '💅', blurb: 'Witty and a little sarcastic. Soft center.' },
  { id: 'wholesome', label: 'Wholesome', emoji: '💛', blurb: 'Warm and encouraging. Your biggest fan.' },
];
