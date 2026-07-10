// Cleanup for raw whisper.cpp output before it reaches the renderer.

// Whisper marks non-speech audio with bracketed annotations such as
// "[BLANK_AUDIO]", "(upbeat music)" or "*coughs*". None of it is dictation.
const NON_SPEECH_ANNOTATION = /\[[^\]]*\]?|\([^)]*\)?|\*[^*]*\*?/g;

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Normalizes a whisper transcript: strips non-speech annotations, collapses the
 * whitespace whisper pads segments with, and resolves annotation-only or
 * punctuation-only output to an empty string.
 */
export function sanitizeTranscript(raw: string): string {
  if (!raw) return '';

  const stripped = raw.replace(NON_SPEECH_ANNOTATION, ' ').replace(/\s+/g, ' ').trim();

  // Pure room tone often decodes to a lone "." or "-".
  if (!HAS_WORD_CHARACTER.test(stripped)) return '';

  return stripped;
}
