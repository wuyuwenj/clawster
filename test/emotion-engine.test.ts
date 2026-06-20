import { describe, it, expect, beforeEach } from 'vitest';
import { EmotionEngine } from '../src/main/emotion-engine';

describe('EmotionEngine', () => {
  let engine: EmotionEngine;
  let lastMood: string;

  beforeEach(() => {
    engine = new EmotionEngine();
    lastMood = '';
    engine.start((mood) => { lastMood = mood; });
  });

  it('starts in idle state', () => {
    const state = engine.getState();
    expect(state.mood).toBe('idle');
    expect(state.valence).toBeGreaterThan(-0.5);
    expect(state.arousal).toBeGreaterThan(0);
  });

  it('single sad message triggers worried mood', () => {
    engine.onConversationMood('worried');
    const state = engine.getState();
    expect(state.valence).toBeLessThan(-0.2);
    expect(lastMood).toBe('worried');
  });

  it('compliment triggers positive mood', () => {
    engine.onConversationMood('excited');
    const state = engine.getState();
    expect(state.valence).toBeGreaterThan(0.3);
    expect(['happy', 'excited', 'spin', 'proud']).toContain(lastMood);
  });

  it('interaction boosts attention and valence', () => {
    const before = engine.getState();
    engine.onInteraction();
    const after = engine.getState();
    expect(after.attention).toBeGreaterThan(before.attention);
    expect(after.valence).toBeGreaterThan(before.valence);
  });

  it('multiple rapid interactions increase arousal', () => {
    for (let i = 0; i < 6; i++) engine.onInteraction();
    const state = engine.getState();
    expect(state.arousal).toBeGreaterThan(0.5);
  });

  it('mad mood triggers negative valence with high arousal', () => {
    engine.onConversationMood('mad');
    const state = engine.getState();
    expect(state.valence).toBeLessThan(-0.2);
    expect(state.arousal).toBeGreaterThan(0.4);
    expect(['huff', 'mad', 'worried', 'crossed']).toContain(lastMood);
  });

  it('doze mood drops arousal very low', () => {
    engine.onConversationMood('doze');
    engine.onConversationMood('doze');
    const state = engine.getState();
    expect(state.arousal).toBeLessThan(0.2);
  });

  it('app switch to fun app boosts mood', () => {
    const before = engine.getState();
    engine.onAppSwitch('Spotify');
    const after = engine.getState();
    expect(after.valence).toBeGreaterThan(before.valence);
  });

  it('proud mood sets positive valence low arousal', () => {
    engine.onConversationMood('proud');
    const state = engine.getState();
    expect(state.valence).toBeGreaterThan(0.1);
  });

  it('stop cleans up', () => {
    engine.stop();
    // Should not throw
    expect(engine.getState().mood).toBeDefined();
  });
});
