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
    patterns: [/tired/i, /sleepy/i, /exhausted/i, /need (a )?break/i],
    responses: [
      "Take a break! Want me to set a 5 minute timer?",
      "*yawns* Yeah, breaks are important. Say the word and I'll time one for you.",
      "Rest up! Even lobsters need their beauty sleep. Want me to remind you to get back to it?",
    ],
  },
  {
    patterns: [/bye|goodbye|see you|later|gotta go|leaving/i],
    responses: [
      "See ya! I'll be right here when you get back. *waves*",
      "Bye! *snip snip* Don't be a stranger!",
      "Later! I'll just be chilling on your desktop.",
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

const FALLBACK_RESPONSES = [
  "Hmm, I'm not sure about that! But I can open apps, play music, set timers, and more. Try asking me to do something!",
  "*tilts head curiously* I'm better at doing things than chatting! Try 'open safari' or 'set a timer'.",
  "That's a bit beyond my lobster brain! But I'm great at actions — try 'play some jazz' or 'wave at me'.",
  "Interesting! I'm more of an action lobster though. Want me to open an app or set a timer?",
];

export function getTemplateResponse(input: string): string {
  const trimmed = input.trim();
  for (const set of RESPONSE_SETS) {
    for (const pattern of set.patterns) {
      if (pattern.test(trimmed)) {
        return set.responses[Math.floor(Math.random() * set.responses.length)];
      }
    }
  }
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}
