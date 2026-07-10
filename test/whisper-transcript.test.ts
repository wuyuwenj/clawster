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

  it('drops an unterminated annotation that is the whole transcript', () => {
    expect(sanitizeTranscript(' [BLANK_AUDIO')).toBe('');
  });

  it('never lets a stray delimiter swallow the rest of the transcript', () => {
    expect(sanitizeTranscript('call me at (555 1234')).toBe('call me at (555 1234');
    expect(sanitizeTranscript('a [b c')).toBe('a [b c');
    expect(sanitizeTranscript('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('keeps speech that is mixed with an annotation', () => {
    expect(sanitizeTranscript(' [BLANK_AUDIO] open my email')).toBe('open my email');
    expect(sanitizeTranscript(' hey (laughs) clawster')).toBe('hey clawster');
    expect(sanitizeTranscript('open my email (laughs) please')).toBe('open my email please');
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
