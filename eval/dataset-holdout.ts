// Holdout eval set — completely different phrasings from training data.
// Tests whether the model learned the CONCEPT or just memorized examples.

import type { TestCase } from './dataset';

export const HOLDOUT: TestCase[] = [
  // ============================================================
  // CALENDAR — phrasings NOT in training data
  // ============================================================
  { input: "what do I have going on this afternoon", expected_tool: 'get_calendar_events', expected_args: { date: 'today' }, category: 'calendar', difficulty: 'medium' },
  { input: "anything scheduled for the weekend", expected_tool: 'get_calendar_events', expected_args: { date: 'this weekend' }, category: 'calendar', difficulty: 'medium' },
  { input: "clear afternoon?", expected_tool: 'get_calendar_events', expected_args: { date: 'today' }, category: 'calendar', difficulty: 'hard' },
  { input: "list my appointments", expected_tool: 'get_calendar_events', expected_args: {}, category: 'calendar', difficulty: 'easy' },
  { input: "pencil in a standup at 9:15", expected_tool: 'create_calendar_event', expected_args: { title: 'standup', start: '9:15' }, category: 'calendar', difficulty: 'hard' },
  { input: "reserve 3-5pm for coding", expected_tool: 'create_calendar_event', expected_args: { title: 'coding', start: '15:00', end: '17:00' }, category: 'calendar', difficulty: 'hard' },
  { input: "throw a lunch event on my cal at 12:30", expected_tool: 'create_calendar_event', expected_args: { title: 'lunch', start: '12:30' }, category: 'calendar', difficulty: 'hard' },
  { input: "any conflicts at 11", expected_tool: 'get_calendar_events', expected_args: { date: 'today' }, category: 'calendar', difficulty: 'hard' },

  // ============================================================
  // REMINDERS — completely different phrasing
  // ============================================================
  { input: "make sure I don't forget the keys at 7", expected_tool: 'create_reminder', expected_args: { text: 'keys', time: '7:00' }, category: 'reminder', difficulty: 'hard' },
  { input: "poke me about standup in 45 min", expected_tool: 'create_reminder', expected_args: { text: 'standup', time: 'in 45 minutes' }, category: 'reminder', difficulty: 'hard' },
  { input: "heads up at 6pm to order dinner", expected_tool: 'create_reminder', expected_args: { text: 'order dinner', time: '18:00' }, category: 'reminder', difficulty: 'hard' },
  { input: "drop me a note at 4 about the release", expected_tool: 'create_reminder', expected_args: { text: 'the release', time: '16:00' }, category: 'reminder', difficulty: 'hard' },
  { input: "give me a nudge in 20 min", expected_tool: 'create_reminder', expected_args: { text: 'reminder', time: 'in 20 minutes' }, category: 'reminder', difficulty: 'medium' },
  { input: "holler at me at 2 to review the doc", expected_tool: 'create_reminder', expected_args: { text: 'review the doc', time: '14:00' }, category: 'reminder', difficulty: 'hard' },

  // ============================================================
  // PET — different vocabulary
  // ============================================================
  { input: "show me your happy face", expected_tool: 'set_mood', expected_args: { value: 'happy' }, category: 'pet', difficulty: 'medium' },
  { input: "look confused", expected_tool: 'set_mood', expected_args: { value: 'curious' }, category: 'pet', difficulty: 'medium' },
  { input: "take a rest", expected_tool: 'set_mood', expected_args: { value: 'sleeping' }, category: 'pet', difficulty: 'medium' },
  { input: "stop moving around", expected_tool: 'set_mood', expected_args: { value: 'idle' }, category: 'pet', difficulty: 'medium' },
  { input: "get pumped", expected_tool: 'set_mood', expected_args: { value: 'excited' }, category: 'pet', difficulty: 'hard' },
  { input: "scuttle over to me", expected_tool: 'move_to_cursor', expected_args: {}, category: 'pet', difficulty: 'hard' },
  { input: "waddle this way", expected_tool: 'move_to_cursor', expected_args: {}, category: 'pet', difficulty: 'hard' },
  { input: "do the pinchy thing", expected_tool: 'snip', expected_args: {}, category: 'pet', difficulty: 'hard' },
  { input: "greet me", expected_tool: 'wave', expected_args: {}, category: 'pet', difficulty: 'medium' },
  { input: "park yourself in the corner", expected_tool: 'move_to', expected_args: { x: 0, y: 0 }, category: 'pet', difficulty: 'hard' },

  // ============================================================
  // APP — different apps and phrasing
  // ============================================================
  { input: "boot up figma", expected_tool: 'open_app', expected_args: { app: 'Figma' }, category: 'app', difficulty: 'medium' },
  { input: "bring up the mail app", expected_tool: 'open_app', expected_args: { app: 'Mail' }, category: 'app', difficulty: 'medium' },
  { input: "start zoom", expected_tool: 'open_app', expected_args: { app: 'Zoom' }, category: 'app', difficulty: 'easy' },
  { input: "i wanna browse hacker news", expected_tool: 'open_url', expected_args: { url: 'https://news.ycombinator.com' }, category: 'app', difficulty: 'hard' },
  { input: "pull up notion", expected_tool: 'open_app', expected_args: { app: 'Notion' }, category: 'app', difficulty: 'medium' },

  // ============================================================
  // MUSIC — different genres and phrasing
  // ============================================================
  { input: "throw on some hip hop", expected_tool: 'play_music', expected_args: { query: 'hip hop' }, category: 'music', difficulty: 'medium' },
  { input: "queue up drake", expected_tool: 'play_music', expected_args: { query: 'drake' }, category: 'music', difficulty: 'medium' },
  { input: "mute the tunes", expected_tool: 'play_music', expected_args: { action: 'pause' }, category: 'music', difficulty: 'hard' },
  { input: "i'm over this song", expected_tool: 'play_music', expected_args: { action: 'next' }, category: 'music', difficulty: 'hard' },
  { input: "back up one track", expected_tool: 'play_music', expected_args: { action: 'previous' }, category: 'music', difficulty: 'medium' },
  { input: "unpause", expected_tool: 'play_music', expected_args: { action: 'play' }, category: 'music', difficulty: 'medium' },

  // ============================================================
  // WEATHER — different phrasing
  // ============================================================
  { input: "gonna be sunny later?", expected_tool: 'get_weather', expected_args: {}, category: 'weather', difficulty: 'hard' },
  { input: "what should I wear outside", expected_tool: 'get_weather', expected_args: {}, category: 'weather', difficulty: 'hard' },
  { input: "climate in barcelona", expected_tool: 'get_weather', expected_args: { location: 'barcelona' }, category: 'weather', difficulty: 'medium' },

  // ============================================================
  // TIMER — different phrasing
  // ============================================================
  { input: "give me a 90 second countdown", expected_tool: 'set_timer', expected_args: { duration: '90 seconds' }, category: 'timer', difficulty: 'medium' },
  { input: "time me for 7 minutes", expected_tool: 'set_timer', expected_args: { duration: '7 minutes' }, category: 'timer', difficulty: 'medium' },
  { input: "stopwatch 2 min", expected_tool: 'set_timer', expected_args: { duration: '2 minutes' }, category: 'timer', difficulty: 'medium' },

  // ============================================================
  // SCREENSHOT — different phrasing
  // ============================================================
  { input: "freeze frame my desktop", expected_tool: 'take_screenshot', expected_args: {}, category: 'screenshot', difficulty: 'hard' },
  { input: "show me a picture of the screen", expected_tool: 'take_screenshot', expected_args: {}, category: 'screenshot', difficulty: 'medium' },

  // ============================================================
  // FILE SEARCH — different phrasing
  // ============================================================
  { input: "track down my presentation slides", expected_tool: 'search_files', expected_args: { query: 'presentation' }, category: 'files', difficulty: 'hard' },
  { input: "dig up the config file", expected_tool: 'search_files', expected_args: { query: 'config' }, category: 'files', difficulty: 'hard' },
  { input: "any spreadsheets in my documents folder", expected_tool: 'search_files', expected_args: { query: 'spreadsheet', directory: 'Documents' }, category: 'files', difficulty: 'medium' },

  // ============================================================
  // REJECT — conversational, should NOT call a tool
  // ============================================================
  { input: "you're a funny little lobster", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: "what time zone are we in", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: "do lobsters dream", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: "that worked great", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: "sup", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: "bruh", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'hard' },
  { input: "yep", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: "can you write code", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: "what's 2+2", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: "recommend a movie", expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
];
