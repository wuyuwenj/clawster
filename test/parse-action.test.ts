import { describe, it, expect } from 'vitest';
import { parseActionFromResponse } from '../src/main/chat/parse-action';

describe('parseActionFromResponse', () => {
  it('returns text unchanged when no action block is present', () => {
    const result = parseActionFromResponse('Hello there!');
    expect(result.cleanText).toBe('Hello there!');
    expect(result.action).toBeUndefined();
  });

  it('extracts a valid action block and cleans the text', () => {
    const input = 'Coming over!\n```action\n{"type": "move_to_cursor"}\n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe('Coming over!');
    expect(result.action).toEqual({ type: 'move_to_cursor' });
  });

  it('parses set_mood action with value', () => {
    const input = 'Feeling happy!\n```action\n{"type": "set_mood", "value": "happy"}\n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe('Feeling happy!');
    expect(result.action).toEqual({ type: 'set_mood', value: 'happy' });
  });

  it('parses move_to action with coordinates', () => {
    const input = 'Moving!\n```action\n{"type": "move_to", "x": 500, "y": 300}\n```';
    const result = parseActionFromResponse(input);
    expect(result.action).toEqual({ type: 'move_to', x: 500, y: 300 });
  });

  it('handles malformed JSON with fallback parser', () => {
    const input = 'Snipping!\n```action\n{"type": "set_mood", "curious"}\n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe('Snipping!');
    expect(result.action).toBeDefined();
    expect((result.action as { type: string }).type).toBe('set_mood');
    expect((result.action as { value: string }).value).toBe('curious');
  });

  it('handles action block with extra whitespace', () => {
    const input = 'Hi!\n```action\n  { "type": "wave" }  \n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe('Hi!');
    expect(result.action).toEqual({ type: 'wave' });
  });

  it('returns full text unchanged when action block has no JSON object', () => {
    const input = 'Hmm\n```action\nnot json at all\n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe(input);
    expect(result.action).toBeUndefined();
  });

  it('handles text that is only an action block', () => {
    const input = '```action\n{"type": "snip"}\n```';
    const result = parseActionFromResponse(input);
    expect(result.cleanText).toBe('');
    expect(result.action).toEqual({ type: 'snip' });
  });

  it('handles action block with look_at coordinates', () => {
    const input = 'Looking!\n```action\n{"type": "look_at", "x": 800, "y": 400}\n```';
    const result = parseActionFromResponse(input);
    expect(result.action).toEqual({ type: 'look_at', x: 800, y: 400 });
  });

  it('handles empty string input', () => {
    const result = parseActionFromResponse('');
    expect(result.cleanText).toBe('');
    expect(result.action).toBeUndefined();
  });
});
