import { describe, it, expect } from 'vitest';
import {
  chipVariant,
  closingReaction,
  isClosingReply,
  isEngagingReply,
} from '../src/renderer/pet-chat/quick-replies';
import { getQuickReplies } from '../src/main/chat/quick-replies';

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

  it('never gives coral to a reply the renderer would just close on', () => {
    // 'Cool!' / 'Haha!' / 'Pause' / 'Goodnight' all fall through to the close
    // path, so none of them may look like the call to action.
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

// The chip and the click handler read the same classifier, so a coral chip is
// a promise the handler keeps: coral never closes the bubble.
describe('reply classification drives both the chip and the handler', () => {
  it('treats every unrecognized reply as a close', () => {
    expect(isEngagingReply('Sure, whatever')).toBe(false);
    expect(isClosingReply('Sure, whatever')).toBe(true);
  });

  it('closes on exactly the replies that never take coral', () => {
    const replies = ['Next song', 'Pause', 'Not now', 'Thanks!'];
    for (const reply of replies) {
      const coral = chipVariant(replies, reply) === 'primary';
      expect(coral).toBe(!isClosingReply(reply));
    }
  });

  it('shrugs off dismissals and thanks the friendly exits', () => {
    expect(closingReaction('Not now')).toBe('dismiss');
    expect(closingReaction('Got it')).toBe('dismiss');
    expect(closingReaction('Got it!')).toBe('dismiss');
    expect(closingReaction('Thanks!')).toBe('thanks');
    expect(closingReaction('Goodnight')).toBe('thanks');
  });
});
