import { describe, it, expect } from 'vitest';
import { sanitizeTranscript } from '../src/main/whisper-transcript';

describe('sanitizeTranscript', () => {
  it('trims the leading space whisper puts on every segment', () => {
    expect(sanitizeTranscript(' Hello there.')).toBe('Hello there.');
  });

  it('joins segments into single-spaced text', () => {
    expect(sanitizeTranscript(' Hello there.  How are\n you?')).toBe('Hello there. How are you?');
  });

  it('drops non-speech annotations whisper emits for silence', () => {
    expect(sanitizeTranscript('[BLANK_AUDIO]')).toBe('');
    expect(sanitizeTranscript(' [ Silence ]')).toBe('');
    expect(sanitizeTranscript('(upbeat music)')).toBe('');
    expect(sanitizeTranscript('*coughs*')).toBe('');
  });

  it('drops unterminated annotations', () => {
    expect(sanitizeTranscript(' [BLANK_AUDIO')).toBe('');
  });

  it('keeps speech that is mixed with an annotation', () => {
    expect(sanitizeTranscript(' [BLANK_AUDIO] open my email')).toBe('open my email');
    expect(sanitizeTranscript(' hey (laughs) clawster')).toBe('hey clawster');
  });

  it('resolves punctuation-only output to empty text', () => {
    expect(sanitizeTranscript(' .')).toBe('');
    expect(sanitizeTranscript(' - ')).toBe('');
  });

  it('handles empty and whitespace-only input', () => {
    expect(sanitizeTranscript('')).toBe('');
    expect(sanitizeTranscript('   ')).toBe('');
  });

  it('preserves normal dictation verbatim', () => {
    expect(sanitizeTranscript(' What is 2 + 2?')).toBe('What is 2 + 2?');
  });
});
