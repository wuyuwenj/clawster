// Quick-reply vocabulary for the pet-chat bubble, plus the Tidepool (CLA-58)
// chip hierarchy. Pure logic — no React, no Electron, so it is unit testable in
// the node-environment Vitest suite.
//
// The reply strings live here (not inline in PetChat) because two things branch
// on them: the click handler, which decides whether a reply closes the bubble,
// and chipVariant, which decides how loud the chip looks. They must agree.

export const REPLY_THANKS = 'Thanks!';
export const REPLY_TELL_ME_MORE = 'Tell me more';
export const REPLY_NOT_NOW = 'Not now';
export const REPLY_GOT_IT = 'Got it';
export const REPLY_OPEN_SETTINGS = 'Open Settings';

export const DEFAULT_QUICK_REPLIES = [REPLY_THANKS, REPLY_TELL_ME_MORE, REPLY_NOT_NOW];

// Turns the bubble away without acting on it.
const DISMISSIVE_REPLIES: readonly string[] = [REPLY_NOT_NOW];

// Accepts the answer, then closes the bubble. Friendly, but still an exit.
const CLOSING_REPLIES: readonly string[] = [REPLY_THANKS, REPLY_GOT_IT];

export function isDismissiveReply(reply: string): boolean {
  return DISMISSIVE_REPLIES.includes(reply);
}

export function isClosingReply(reply: string): boolean {
  return CLOSING_REPLIES.includes(reply);
}

// Coral means "acting/chosen" in Tidepool, so the solid coral chip is reserved
// for the reply that keeps the conversation going ("Tell me more",
// "Open Settings"). Replies that close the bubble never take coral: outright
// dismissals go muted, closing acknowledgements take the coral tint. A set of
// pure exits ("Got it" / "Not now") therefore has no primary chip — nothing
// there is worth shouting about.
export type ChipVariant = 'primary' | 'secondary' | 'muted';

export function chipVariant(replies: string[], reply: string): ChipVariant {
  if (isDismissiveReply(reply)) return 'muted';
  if (isClosingReply(reply)) return 'secondary';

  const firstEngaging = replies.find((r) => !isDismissiveReply(r) && !isClosingReply(r));
  return reply === firstEngaging ? 'primary' : 'secondary';
}
