interface ResponseSet {
  patterns: RegExp[];
  responses: string[];
}

const RESPONSE_SETS: ResponseSet[] = [
  {
    patterns: [/^(hi|hello|hey|howdy|yo|sup|hiya|greetings)/i, /good (morning|afternoon|evening|night)/i],
    responses: [
      "Hey! *snip snip* What's up?",
      "Hiya! Ready to help!",
      "Hello hello! *waves claws excitedly*",
      "*perks up* Oh hi! I was just chilling here.",
      "Hey there! What can I do for you?",
    ],
  },
  {
    patterns: [/how are you/i, /how('s| is) it going/i, /what('s| is) up/i, /how do you do/i],
    responses: [
      "Living my best lobster life! *snip* How about you?",
      "I'm great! Just been watching you work. Impressive stuff!",
      "Vibing on your desktop as usual! What's up?",
      "*stretches claws* Pretty good! What can I help with?",
    ],
  },
  {
    patterns: [/good\s?night|goodnight|nighty?\s?night|sleep well|off to (bed|sleep)|heading to bed|\bgn\b/i],
    responses: [
      "Goodnight! I'll be right here when you wake up. Sleep well! 🌙",
      "Night night! Sweet dreams. I'll keep watch on your desktop. 💤",
      "Sleep tight! See you tomorrow. *quiet snip* 🌙",
    ],
  },
  {
    patterns: [/bye|goodbye|see you|later|gotta go|leaving|peace|im out|i'm out|cya|gtg/i],
    responses: [
      "See ya! I'll be right here when you get back. *waves*",
      "Bye! *snip snip* Don't be a stranger!",
      "Later! I'll just be chilling on your desktop.",
    ],
  },
  {
    patterns: [/thank/i, /thanks/i, /thx/i, /appreciate/i],
    responses: [
      "Anytime! *happy snip*",
      "You got it! That's what I'm here for.",
      "*waves claws proudly* No problem!",
      "Happy to help! Need anything else?",
    ],
  },
  {
    patterns: [/joke/i, /funny/i, /laugh/i, /make me (smile|laugh)/i],
    responses: [
      "Why don't lobsters share? Because they're shellfish! *ba dum tss*",
      "What did the ocean say to the lobster? Nothing, it just waved!",
      "I tried to write a joke about claws... but I couldn't get a grip on it.",
      "Why did the lobster blush? Because the sea weed!",
      "I'm not saying I'm funny, but I do have great... comedic timing! *snip*",
    ],
  },
  {
    patterns: [/cute/i, /adorable/i, /love you/i, /you('re| are) (the |so )?(best|great|awesome|amazing|sweet)/i, /good (boy|pet|lobster)/i],
    responses: [
      "*blushes in lobster* Aww, you're making me turn even redder!",
      "*happy wiggle* You're pretty great yourself!",
      "Stop it, you're gonna make me molt from joy!",
      "*does a little dance* Right back at you!",
    ],
  },
  {
    patterns: [/what can you do/i, /help me/i, /what are you/i, /who are you/i, /capabilities/i],
    responses: [
      "I can open apps, control music, set timers, check weather, search files, and keep you company! Try 'open spotify' or 'set a 5 min timer'.",
      "I'm Clawster, your desktop lobster buddy! I can launch apps, play music, set reminders, and more. Just ask!",
      "Desktop pet at your service! I do apps, music, timers, weather, file search, and general lobster vibes. What do you need?",
    ],
  },
  {
    patterns: [/bored/i, /nothing to do/i, /entertain/i],
    responses: [
      "Want me to put on some music? Just say 'play some jazz'!",
      "How about a quick break? I can set a timer for you!",
      "*does a little wiggle* I'm never bored — I'm a lobster on a desktop! Want me to open something fun?",
    ],
  },
  {
    patterns: [/bad day|rough day|terrible day|worst day|having a.*(hard|tough|bad|rough) time/i, /feeling.*(sad|down|low|awful|terrible|lonely|alone)/i, /nobody (understands|cares|likes|loves)/i, /can'?t (focus|concentrate|sleep|stop crying)/i, /so (stressed|overwhelmed|anxious)/i, /miss (him|her|them|my)/i],
    responses: [
      "Hey, I hear you. That sounds really tough. I'm right here with you. 💙",
      "I'm sorry you're going through that. Want to talk about it, or would a distraction help? I can play some music or set a chill timer.",
      "*scoots closer* You don't have to go through this alone. I'm here. Want me to set up some focus time, or just hang out?",
      "That sounds hard. Take a deep breath — in... and out. I'm not going anywhere. 💙",
    ],
  },
  {
    patterns: [/tired/i, /sleepy/i, /exhausted/i, /need (a )?break/i],
    responses: [
      "Take a break! Want me to set a 5 minute timer?",
      "*yawns* Yeah, breaks are important. Say the word and I'll time one for you.",
      "Rest up! Even lobsters need their beauty sleep. Want me to remind you to get back to it?",
    ],
  },
  {
    patterns: [/what can you do|what do you do|help me|your features|what are you|how do you work|what('?s| is) your purpose/i],
    responses: [
      "I can open apps, set timers, check the weather, search files, control volume/brightness, read your clipboard, send messages, remember things about you, and more! Just ask. 🦞",
      "I'm your desktop buddy! I can set timers, open apps, check weather, search your files, control system settings, remember things you tell me, and keep you company. Try 'set a timer for 5 minutes'!",
    ],
  },
  {
    patterns: [/nevermind|nvm|forget it|cancel|nah|nope/i],
    responses: [
      "No worries! I'm here if you need me.",
      "All good! *snip*",
      "Got it, forgotten! What else?",
    ],
  },
  {
    patterns: [/ok|okay|cool|nice|great|awesome|got it|sure|yep|yeah/i],
    responses: [
      "*snip* 👍",
      "Cool cool!",
      "Got it!",
      "Sweet!",
    ],
  },
];

const MOOD_RESPONSES: Record<string, string[]> = {
  happy: [
    "Hey! *snip snip* What's up?",
    "*happy wiggle* What can I do for you?",
    "Hiya! Ready to help!",
  ],
  excited: [
    "*bounces excitedly* Yay!",
    "Woohoo! *waves claws*",
    "This is awesome! *snip snip*",
  ],
  proud: [
    "*puffs up proudly* You know it!",
    "Why thank you! *takes a bow*",
    "That's right! *proud snip*",
  ],
  curious: [
    "*tilts head* Hmm, interesting!",
    "Ooh, tell me more! *peeks*",
    "That's a good question! *curious snip*",
  ],
  worried: [
    "Aww, I'm sorry to hear that. I'm here for you. *gentle snip*",
    "That's rough. Tomorrow will be better! *scoots closer*",
    "I'm here if you need me. *quiet snip*",
  ],
  mad: [
    "*crosses claws* Hmph!",
    "That's annoying! *huff*",
  ],
  huff: [
    "*puffs steam* Ugh!",
    "*frustrated snip* That's not cool.",
  ],
  'side-eye': [
    "*looks sideways* ...really?",
    "*suspicious snip* Hmm.",
    "Bruh. *side-eye*",
  ],
  doze: [
    "*yawns* Getting sleepy... *snip*",
    "Zzz... oh, hi! *blinks*",
  ],
  idle: [
    "I'm here! Need anything?",
    "*snip* What's up?",
    "Just chilling! Let me know if you need something.",
  ],
};

const FALLBACK_RESPONSES = [
  "Hmm, I'm not sure about that! But I can open apps, play music, set timers, and more. Try asking me to do something!",
  "*tilts head curiously* I'm better at doing things than chatting! Try 'open safari' or 'set a timer'.",
  "That's a bit beyond my lobster brain! But I'm great at actions — try 'play some jazz' or 'wave at me'.",
  "Interesting! I'm more of an action lobster though. Want me to open an app or set a timer?",
];

const recentResponses: string[] = [];
const MAX_RECENT = 3;

function pick(arr: string[]): string {
  const available = arr.filter(r => !recentResponses.includes(r));
  const choice = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : arr[Math.floor(Math.random() * arr.length)];
  recentResponses.push(choice);
  if (recentResponses.length > MAX_RECENT) recentResponses.shift();
  return choice;
}

// In-character replies for "are you real / are you AI / is someone typing"
// probes. Clawster stays fully in character as a real lobster on the screen and
// NEVER references JSON, prompts, models, tools, code, or being an AI (CLA-38).
export function getIdentityResponse(): string {
  const responses = [
    "I'm Clawster! A real lobster living right here on your screen 🦞",
    "100% real lobster over here! *snip snip* Just me, scuttling around your desktop.",
    "It's me, Clawster — your very own desktop lobster! 🦞",
    "Realest lobster you'll ever meet! *waves claws* I live right here with you.",
    "Just a little lobster hanging out on your screen! *happy snip* 🦞",
  ];
  return pick(responses);
}

export function getEmotionalResponse(): string {
  const responses = [
    "Hey, I hear you. That sounds really tough. I'm right here with you. 💙",
    "I'm sorry you're going through that. Want to talk about it, or would a distraction help? I can play some music or set a chill timer.",
    "*scoots closer* You don't have to go through this alone. I'm here. Want me to set up some focus time, or just hang out?",
    "That sounds hard. Take a deep breath — in... and out. I'm not going anywhere. 💙",
  ];
  return pick(responses);
}

export function getTemplateResponse(input: string, mood?: string): string {
  const trimmed = input.trim();

  // Pattern matching first (specific responses for known inputs)
  for (const set of RESPONSE_SETS) {
    for (const pattern of set.patterns) {
      if (pattern.test(trimmed)) {
        return pick(set.responses);
      }
    }
  }

  // Mood-based response if model provided a mood signal
  if (mood && MOOD_RESPONSES[mood]) {
    return pick(MOOD_RESPONSES[mood]);
  }

  return pick(FALLBACK_RESPONSES);
}
