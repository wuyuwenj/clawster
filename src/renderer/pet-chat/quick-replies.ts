// Quick-reply vocabulary for the pet-chat bubble, plus the Tidepool (CLA-58)
// chip hierarchy. Pure logic — no React, no Electron, so it is unit testable in
// the node-environment Vitest suite.
//
// One classifier serves both consumers so they cannot drift: the click handler
// asks whether a reply closes the bubble, and chipVariant asks how loud the
// chip looks. The reply strings themselves are produced by the main process
// (src/main/chat/quick-replies.ts) — the engaging allowlist below mirrors that
// vocabulary. Anything unrecognized is treated as a close, which is exactly
// what the click handler does with it.

export const REPLY_THANKS = 'Thanks!';
export const REPLY_TELL_ME_MORE = 'Tell me more';
export const REPLY_NOT_NOW = 'Not now';
export const REPLY_GOT_IT = 'Got it';
export const REPLY_OPEN_SETTINGS = 'Open Settings';

export const DEFAULT_QUICK_REPLIES = [REPLY_THANKS, REPLY_TELL_ME_MORE, REPLY_NOT_NOW];

// Replies that ask Clawster for more: tapping one sends it back as a follow-up
// and keeps the bubble open. Only these are eligible for the coral chip.
const ENGAGING_REPLIES: readonly string[] = [
  REPLY_TELL_ME_MORE,
  REPLY_OPEN_SETTINGS,
  'Next song',
  'Set another',
  'Set a timer',
  'Remind me again',
  'Anywhere else?',
  "What's next?",
  'Add another',
  'Open another',
  'Close another',
  'Search them',
  'List a folder',
  'What else do you know?',
  'Remember something new',
  'How much time left?',
  'Do more',
  'Run another',
  'Send another',
  'Wake up!',
  'What can you do?',
];

// Turns the bubble away without acting on it.
const DISMISSIVE_REPLIES: readonly string[] = [REPLY_NOT_NOW];

// Closing replies where the pet should read the exit as a shrug rather than
// gratitude. Every other close ("Thanks!", "Cool!", "Goodnight", …) is warm.
const DISMISS_REACTION_REPLIES: readonly string[] = [REPLY_NOT_NOW, REPLY_GOT_IT, 'Got it!'];

function isDismissiveReply(reply: string): boolean {
  return DISMISSIVE_REPLIES.includes(reply);
}

export function isEngagingReply(reply: string): boolean {
  return ENGAGING_REPLIES.includes(reply);
}

// Anything that isn't engaging closes the bubble — including replies the main
// process invents that this module has never heard of.
export function isClosingReply(reply: string): boolean {
  return !isEngagingReply(reply);
}

export function closingReaction(reply: string): 'dismiss' | 'thanks' {
  return DISMISS_REACTION_REPLIES.includes(reply) ? 'dismiss' : 'thanks';
}

// Coral means "acting/chosen" in Tidepool, so the solid coral chip is reserved
// for the reply that keeps the conversation going. Replies that close the
// bubble never take coral: outright dismissals go muted, everything else takes
// the coral tint. A set of pure exits ("Got it" / "Not now") therefore has no
// primary chip, and a set with several engaging replies promotes only the
// first — never two coral chips.
export type ChipVariant = 'primary' | 'secondary' | 'muted';

export function chipVariant(replies: string[], reply: string): ChipVariant {
  if (isDismissiveReply(reply)) return 'muted';
  if (isClosingReply(reply)) return 'secondary';

  const firstEngaging = replies.find(isEngagingReply);
  return reply === firstEngaging ? 'primary' : 'secondary';
}
