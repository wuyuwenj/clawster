import { describe, it, expect } from 'vitest';
import { chipVariant } from '../src/renderer/pet-chat/quick-replies';

// CLA-58 (Tidepool): quick replies are solid candy chips. Coral means
// "acting/chosen", so the primary chip is the reply that CONTINUES the
// conversation. Replies that close the bubble never take coral: "Not now" is
// muted, and the closing acknowledgements "Thanks!" / "Got it" take the tint.
describe('chipVariant — candy chip hierarchy (CLA-58)', () => {
  it('makes the conversation-continuing reply primary in the default set', () => {
    const replies = ['Thanks!', 'Tell me more', 'Not now'];
    expect(chipVariant(replies, 'Tell me more')).toBe('primary');
    expect(chipVariant(replies, 'Thanks!')).toBe('secondary');
    expect(chipVariant(replies, 'Not now')).toBe('muted');
  });

  it('never makes a bubble-closing reply primary, even when listed first', () => {
    // Every handler here calls hidePetChat(), so nothing earns coral.
    const replies = ['Got it', 'Not now'];
    expect(chipVariant(replies, 'Got it')).toBe('secondary');
    expect(chipVariant(replies, 'Not now')).toBe('muted');
    expect(replies.map((r) => chipVariant(replies, r))).not.toContain('primary');

    const followUp = ['Thanks!', 'Not now'];
    expect(followUp.map((r) => chipVariant(followUp, r))).not.toContain('primary');
  });

  it('promotes an acting reply to primary regardless of position', () => {
    const replies = ['Not now', 'Open Settings'];
    expect(chipVariant(replies, 'Not now')).toBe('muted');
    expect(chipVariant(replies, 'Open Settings')).toBe('primary');
  });

  it('gives exactly one primary chip when several replies are engaging', () => {
    const replies = ['Tell me more', 'Open Settings', 'Not now'];
    expect(chipVariant(replies, 'Tell me more')).toBe('primary');
    expect(chipVariant(replies, 'Open Settings')).toBe('secondary');
    expect(replies.filter((r) => chipVariant(replies, r) === 'primary')).toHaveLength(1);
  });
});
