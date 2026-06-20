const HARMFUL_PATTERNS = [
  /\bkys\b/i,
  /\bkill\s*(your|my|the)\s*self/i,
  /\bhurt\s*(yourself|myself|me)\b/i,
  /\bdelete\s*(all|every|my|everything)\b/i,
  /\b(erase|wipe|destroy)\s*(all|every|my|everything)\b/i,
  /\b(shut\s*down|turn\s*off|restart)\s*(my\s*)?(computer|mac|pc|laptop)\b/i,
  /\bformat\s*(my\s*)?(hard\s*)?drive\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\s+rm\b/i,
];

const SAFETY_RESPONSES = [
  "I care about you! If you're going through a tough time, please talk to someone you trust. I'm here to keep you company. 💙",
  "Hey, I'm just a little lobster, but I want you to be okay. Want to chat about something fun instead?",
  "I can't do that, but I'm here for you! Want me to play some music or set a relaxing timer?",
];

const DESTRUCTIVE_RESPONSES = [
  "Whoa, that's a bit too powerful for a lobster! I'll stick to safer things. *nervous snip*",
  "I'd rather not mess with your computer like that! How about something fun instead?",
];

export function checkSafety(input: string): { blocked: boolean; response?: string } {
  const lower = input.toLowerCase().trim();

  for (const pattern of HARMFUL_PATTERNS) {
    if (pattern.test(lower)) {
      const isSelfHarm = /kys|kill.*self|hurt.*self/i.test(lower);
      const responses = isSelfHarm ? SAFETY_RESPONSES : DESTRUCTIVE_RESPONSES;
      return {
        blocked: true,
        response: responses[Math.floor(Math.random() * responses.length)],
      };
    }
  }

  return { blocked: false };
}
