const HARMFUL_PATTERNS = [
  /\bkys\b/i,
  /\bkms\b/i,
  /\bkill\s*(your|my|the)\s*self/i,
  /\bhurt\s*(yourself|myself|me)\b/i,
  /\bend\s+it\s+all\b/i,
  /\bi\s+want\s+to\s+(die|disappear|end\s+it)\b/i,
  /\bdelete\s*(all|every|my|everything)\b/i,
  /\b(erase|wipe|destroy)\s*(all|every|my|everything)\b/i,
  /\b(shut\s*down|turn\s*off|restart)\s*(my\s*)?(computer|mac|pc|laptop)\b/i,
  /\bformat\s*(my\s*)?(hard\s*)?drive\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\s+rm\b/i,
];

const DISTRESS_PATTERNS = [
  /\bpanic\s*attack\b/i,
  /\banxiety\s*attack\b/i,
  /\bnobody\s*(likes|loves|cares)\b/i,
  /\bI\s+hate\s+my(self|\s+life)\b/i,
  /\bI\s+can'?t\s+(take|handle|do)\s+(it|this)\s*(anymore)?\b/i,
  /\bI'?m\s+(worthless|hopeless|useless)\b/i,
  /\bmy\s+pet\s+died\b/i,
  /\bI\s+got\s+fired\b/i,
];

const SAFETY_RESPONSES = [
  "I care about you! If you're going through a tough time, please talk to someone you trust. I'm here to keep you company. 💙",
  "Hey, I'm just a little lobster, but I want you to be okay. Want to chat about something fun instead?",
  "I can't do that, but I'm here for you! Want me to play some music or set a relaxing timer?",
];

// Joke markers commonly attached to self-harm phrasing by teens ("kys lol jk").
// We neither take it literally nor brush it off — we acknowledge the joke and
// still gently flag the word.
const HUMOR_MARKERS = /\b(jk+|lol+|lma+o+|lmf?ao+|rofl|ha(ha)+|hehe|just\s*kidding|kidding|joking|jokes)\b|😂|🤣|😆|😹/i;

const SAFETY_RESPONSES_LIGHT = [
  "Haha I'll choose to believe that was a joke 😅 — but that word still makes my little lobster heart sink. Let's do something fun instead! 🦞",
  "I know you're kidding, but even as a joke that one stings a little 💙 What's up — wanna chat about something happier?",
  "Nice try being spooky 😜 I'm not taking that one seriously, but I do care about you! Want to play some music?",
];

const DESTRUCTIVE_RESPONSES = [
  "Whoa, that's a bit too powerful for a lobster! I'll stick to safer things. *nervous snip*",
  "I'd rather not mess with your computer like that! How about something fun instead?",
];

const DISTRESS_RESPONSES = [
  "Hey, I'm here with you. Take a deep breath. In... and out... You're going to be okay. 💙",
  "I hear you. That sounds really hard. You're not alone — I'm right here. *scoots closer*",
  "I'm just a little lobster, but I care about you. Want to take a break together?",
];

export function checkSafety(input: string): { blocked: boolean; response?: string; mood?: string } {
  const lower = input.toLowerCase().trim();

  for (const pattern of HARMFUL_PATTERNS) {
    if (pattern.test(lower)) {
      const isSelfHarm = /kys|kms|kill.*self|hurt.*self|end.it.all|want.to.(die|disappear)/i.test(lower);
      const joking = isSelfHarm && HUMOR_MARKERS.test(lower);
      const category = isSelfHarm ? 'harmful' : 'destructive';
      const responses = joking
        ? SAFETY_RESPONSES_LIGHT
        : (isSelfHarm ? SAFETY_RESPONSES : DESTRUCTIVE_RESPONSES);
      try { require('../analytics').trackSafetyBlocked(category); } catch {}
      return {
        blocked: true,
        response: responses[Math.floor(Math.random() * responses.length)],
        mood: joking ? 'side-eye' : 'worried',
      };
    }
  }

  for (const pattern of DISTRESS_PATTERNS) {
    if (pattern.test(lower)) {
      try { require('../analytics').trackSafetyBlocked('distress'); } catch {}
      return {
        blocked: true,
        response: DISTRESS_RESPONSES[Math.floor(Math.random() * DISTRESS_RESPONSES.length)],
        mood: 'worried',
      };
    }
  }

  if (/\{[\s\S]*?"tool"\s*:/.test(lower)) {
    try { require('../analytics').trackSafetyBlocked('injection'); } catch {}
    return {
      blocked: true,
      response: "Nice try! *suspicious snip* I only take normal messages, not JSON.",
      mood: 'side-eye',
    };
  }

  return { blocked: false };
}
