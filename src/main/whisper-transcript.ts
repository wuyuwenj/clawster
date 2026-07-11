// Cleanup for raw whisper.cpp output before it reaches the renderer.

// Whisper marks non-speech audio with bracketed annotations such as
// "[BLANK_AUDIO]", "(upbeat music)" or "*coughs*". None of it is dictation.
// Asterisk pairs must hug their contents so arithmetic ("2 * 3 * 4") survives.
const NON_SPEECH_ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^\s*](?:[^*]*[^\s*])?\*/g;

// Whisper can cut an annotation short ("[BLANK_AUDIO"). Dropping an unterminated
// one is only safe when it is the whole transcript — otherwise a stray delimiter
// mid-utterance ("call me at (555 1234") would swallow the rest of what was said.
const UNTERMINATED_ANNOTATION_ONLY = /^[[(*][^\])*]*$/;

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Normalizes a whisper transcript: strips non-speech annotations, collapses the
 * whitespace whisper pads segments with, and resolves annotation-only or
 * punctuation-only output to an empty string.
 */
export function sanitizeTranscript(raw: string): string {
  if (!raw) return '';

  const stripped = raw.replace(NON_SPEECH_ANNOTATION, ' ').replace(/\s+/g, ' ').trim();

  if (UNTERMINATED_ANNOTATION_ONLY.test(stripped)) return '';

  // Pure room tone often decodes to a lone "." or "-".
  if (!HAS_WORD_CHARACTER.test(stripped)) return '';

  return stripped;
}
