import { describe, it, expect } from 'vitest';
import { chipVariant } from '../src/renderer/pet-chat/PetChat';

// CLA-58 (Tidepool): quick replies are solid candy chips and exactly one of
// them — the first non-dismissive reply — must read as the primary "yes"
// button. Dismissive replies ("Not now") stay muted.
describe('chipVariant — candy chip hierarchy (CLA-58)', () => {
  it('makes the first affirmative reply primary in the default set', () => {
    const replies = ['Thanks!', 'Tell me more', 'Not now'];
    expect(chipVariant(replies, 'Thanks!')).toBe('primary');
    expect(chipVariant(replies, 'Tell me more')).toBe('secondary');
    expect(chipVariant(replies, 'Not now')).toBe('muted');
  });

  it('promotes "Got it" to primary in error/ack sets', () => {
    const replies = ['Got it', 'Not now'];
    expect(chipVariant(replies, 'Got it')).toBe('primary');
    expect(chipVariant(replies, 'Not now')).toBe('muted');
  });

  it('never makes a dismissive reply primary, even when listed first', () => {
    const replies = ['Not now', 'Open Settings'];
    expect(chipVariant(replies, 'Not now')).toBe('muted');
    expect(chipVariant(replies, 'Open Settings')).toBe('primary');
  });
});
