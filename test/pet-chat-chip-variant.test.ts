import { describe, it, expect } from 'vitest';
import {
  chipVariant,
  closingReaction,
  isEngagingReply,
} from '../src/renderer/pet-chat/quick-replies';
import { getQuickReplies } from '../src/main/chat/quick-replies';

// CLA-58 (Tidepool): quick replies are solid candy chips. Coral means
// "acting/chosen", so the primary chip is the reply on the engaging allowlist —
// the one that reads as "keep going". Everything off the allowlist stays quiet:
// "Not now" is muted, and acknowledgements like "Thanks!" / "Got it" take the
// tint. This is a colour rule only; it does not decide what a tap does.
describe('chipVariant — candy chip hierarchy (CLA-58)', () => {
  it('makes the conversation-continuing reply primary in the default set', () => {
    const replies = ['Thanks!', 'Tell me more', 'Not now'];
    expect(chipVariant(replies, 'Tell me more')).toBe('primary');
    expect(chipVariant(replies, 'Thanks!')).toBe('secondary');
    expect(chipVariant(replies, 'Not now')).toBe('muted');
  });

  it('never makes an acknowledgement primary, even when listed first', () => {
    // Nothing here reads as "keep going", so nothing earns coral.
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

  it('never gives coral to a reply that reads as an acknowledgement', () => {
    // 'Cool!' / 'Haha!' / 'Pause' / 'Goodnight' all wrap the exchange up, so
    // none of them may look like the call to action.
    for (const replies of [
      ['Cool!', 'Not now'],
      ['Haha!', 'Thanks!'],
      ['Nice one!', 'Thanks!'],
      ["I'm okay", 'Thanks'],
      ['Pause', 'Thanks!'],
      ['Goodnight', 'Thanks!'],
    ]) {
      expect(replies.map((r) => chipVariant(replies, r))).not.toContain('primary');
    }
  });

  it('promotes the engaging reply in each real main-process reply set', () => {
    const tools: [string, string][] = [
      ['play_music', 'Next song'],
      ['set_timer', 'Set another'],
      ['create_reminder', 'Remind me again'],
      ['get_weather', 'Anywhere else?'],
      ['get_calendar_events', "What's next?"],
      ['list_files', 'Search them'],
      ['block_apps', 'How much time left?'],
      ['run_shell', 'Run another'],
      ['what_time', 'Set a timer'],
    ];
    for (const [tool, engaging] of tools) {
      const replies = getQuickReplies(tool);
      expect(replies).toContain(engaging);
      expect(chipVariant(replies, engaging)).toBe('primary');
      expect(replies.filter((r) => chipVariant(replies, r) === 'primary')).toHaveLength(1);
    }

    const doze = getQuickReplies(null, 'doze');
    expect(chipVariant(doze, 'Wake up!')).toBe('primary');
    expect(chipVariant(doze, 'Goodnight')).toBe('secondary');

    const hint = ['What can you do?', 'Got it!'];
    expect(chipVariant(hint, 'What can you do?')).toBe('primary');
    expect(chipVariant(hint, 'Got it!')).toBe('secondary');
  });
});

// The allowlist decides colour and nothing else. A reply the renderer has never
// heard of is quiet by default rather than loudly inviting a tap.
describe('engaging allowlist governs coral eligibility', () => {
  it('leaves an unrecognized reply off the allowlist', () => {
    expect(isEngagingReply('Sure, whatever')).toBe(false);
    expect(chipVariant(['Sure, whatever', 'Thanks!'], 'Sure, whatever')).toBe('secondary');
  });

  it('gives coral to exactly the engaging replies', () => {
    const replies = ['Next song', 'Pause', 'Not now', 'Thanks!'];
    for (const reply of replies) {
      const coral = chipVariant(replies, reply) === 'primary';
      expect(coral).toBe(isEngagingReply(reply));
    }
  });
});

// closingReaction picks the pet's mood on the way out, independent of colour.
describe('closingReaction', () => {
  it('shrugs off dismissals and thanks the friendly exits', () => {
    expect(closingReaction('Not now')).toBe('dismiss');
    expect(closingReaction('Got it')).toBe('dismiss');
    expect(closingReaction('Thanks!')).toBe('thanks');
    expect(closingReaction('Got it!')).toBe('thanks');
    expect(closingReaction('Goodnight')).toBe('thanks');
  });
});
