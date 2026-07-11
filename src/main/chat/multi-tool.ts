// Detecting a SECOND request the local classifier dropped (CLA-37).
//
// The fine-tuned tool model emits at most ONE tool call per turn, so a message
// like "play kpop and also what's my battery" runs play_music and silently
// ignores the battery ask. The model can't be retrained from here, so instead
// we spot the leftover request in the raw text and have Clawster acknowledge it
// — "...want me to also check your battery?" — turning a dropped request into a
// one-tap follow-up.
//
// This is deliberately conservative. It only fires when BOTH the request that
// actually ran AND a second, different request are visible in SEPARATE clauses
// of the input, split on a coordinating conjunction. That guards against
// misreading a single request whose wording happens to name two topics, e.g.
// "remind me to check the weather" (one clause → no offer).

export interface SecondaryRequest {
  tool: string;
  // Slots into "want me to also ___?" — Clawster's offer to the user.
  offer: string;
  // A clean command the user can tap to actually trigger the dropped request.
  reply: string;
}

interface Intent {
  tool: string;
  test: RegExp;
  offer: string;
  reply: string;
}

// Splits a message into separate asks on coordinating conjunctions. Adjacent
// connectors ("and also") just yield an empty clause between them, which the
// caller filters out.
const CLAUSE_SPLIT =
  /\s*(?:,|;|&|\band\b|\balso\b|\bthen\b|\bplus\b|\bas well as\b|\bafter that\b)\s*/i;

// Ordered most-specific-first; the first intent that matches a clause wins.
const INTENTS: Intent[] = [
  {
    tool: 'system_control',
    test: /\bbatter(?:y|ies)\b|how much (?:battery|charge)|charge (?:left|remaining)/i,
    offer: 'check your battery',
    reply: 'Check my battery',
  },
  {
    tool: 'get_weather',
    test: /\b(?:weather|forecast|temperature|how (?:hot|cold)|raining|sunny)\b|is it (?:going to |gonna )?rain/i,
    offer: 'check the weather',
    reply: "What's the weather?",
  },
  {
    tool: 'set_timer',
    test: /\b(?:timer|countdown)\b|set (?:a |the )?\d+/i,
    offer: 'set that timer',
    reply: 'Set the timer',
  },
  {
    tool: 'create_reminder',
    test: /\bremind(?:er)?\b/i,
    offer: 'set that reminder',
    reply: 'Set the reminder',
  },
  {
    tool: 'get_calendar_events',
    test: /\b(?:calendar|schedule|agenda|my events?|meetings?)\b/i,
    offer: 'check your calendar',
    reply: "What's on my calendar?",
  },
  {
    tool: 'what_time',
    test: /\bwhat time\b|\bthe time\b|\bwhat day\b|what(?:'?s| is) the date\b/i,
    offer: 'tell you the time',
    reply: 'What time is it?',
  },
  {
    tool: 'take_screenshot',
    test: /\b(?:screenshot|screen shot)\b|what(?:'?s| is) on (?:my |the )?screen|look at (?:my |the )?screen/i,
    offer: 'look at your screen',
    reply: "What's on my screen?",
  },
  {
    tool: 'read_clipboard',
    test: /\bclipboard\b/i,
    offer: 'check your clipboard',
    reply: "What's on my clipboard?",
  },
  {
    tool: 'system_control',
    test: /\bbrightness\b|\b(?:brighter|dimmer)\b/i,
    offer: 'change the brightness',
    reply: 'Change the brightness',
  },
  {
    tool: 'system_control',
    test: /\b(?:volume|mute|unmute)\b|turn (?:it |the (?:music|volume) )?(?:up|down)/i,
    offer: 'adjust the volume',
    reply: 'Change the volume',
  },
  {
    tool: 'play_music',
    test: /\b(?:play|music|song|kpop|k-pop|jazz|playlist|spotify|tunes)\b/i,
    offer: 'put on some music',
    reply: 'Play some music',
  },
  {
    tool: 'search_files',
    test: /\b(?:search|find)\b.*\bfiles?\b/i,
    offer: 'search your files',
    reply: 'Search my files',
  },
  {
    tool: 'list_files',
    test: /\bfiles?\b|\bfolder\b|my (?:desktop|downloads|documents)\b/i,
    offer: 'look through your files',
    reply: 'List my files',
  },
];

// Finds a request the classifier dropped when only `handledTool` ran. Returns
// null unless the handled request AND a distinct second request both appear in
// separate clauses of the input.
export function detectSecondaryRequest(
  input: string,
  handledTool: string | null
): SecondaryRequest | null {
  if (!handledTool) return null;

  const clauses = input.split(CLAUSE_SPLIT).map(c => c.trim()).filter(Boolean);
  if (clauses.length < 2) return null;

  const perClause = clauses.map(clause => INTENTS.filter(i => i.test.test(clause)));

  // Require the handled tool to be visible in some clause, so we know one of the
  // detected asks is the one that actually ran.
  const handledClauses = new Set<number>();
  perClause.forEach((intents, idx) => {
    if (intents.some(i => i.tool === handledTool)) handledClauses.add(idx);
  });
  if (handledClauses.size === 0) return null;

  // Offer the first request that lives in a DIFFERENT clause and maps to a
  // different tool than the one that ran.
  for (let idx = 0; idx < perClause.length; idx++) {
    if (handledClauses.has(idx)) continue;
    const other = perClause[idx].find(i => i.tool !== handledTool);
    if (other) return { tool: other.tool, offer: other.offer, reply: other.reply };
  }
  return null;
}

// Appends Clawster's follow-up offer to a tool's reply text.
export function withSecondaryOffer(text: string, secondary: SecondaryRequest | null): string {
  if (!secondary) return text;
  const base = (text || '').trimEnd();
  const lead = base.length > 0 ? `${base} ` : '';
  return `${lead}Oh — want me to also ${secondary.offer}? *perks up*`;
}

// Quick replies for a message carrying a follow-up offer: a one-tap command that
// re-sends the dropped request as its own turn, plus a decline.
export function secondaryQuickReplies(secondary: SecondaryRequest): string[] {
  return [secondary.reply, 'No thanks'];
}
