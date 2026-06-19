// Test dataset for evaluating tool-calling accuracy.
// Each case has an input utterance, expected tool, expected args, and a category.

export interface TestCase {
  input: string;
  expected_tool: string | null;
  expected_args: Record<string, any>;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export const DATASET: TestCase[] = [
  // ============================================================
  // CALENDAR (15 cases)
  // ============================================================
  { input: "what's on my calendar today", expected_tool: 'get_calendar_events', expected_args: { date: 'today' }, category: 'calendar', difficulty: 'easy' },
  { input: 'do I have any meetings tomorrow', expected_tool: 'get_calendar_events', expected_args: { date: 'tomorrow' }, category: 'calendar', difficulty: 'easy' },
  { input: 'show me my next 3 events', expected_tool: 'get_calendar_events', expected_args: { count: 3 }, category: 'calendar', difficulty: 'medium' },
  { input: 'any events on friday?', expected_tool: 'get_calendar_events', expected_args: { date: 'friday' }, category: 'calendar', difficulty: 'medium' },
  { input: 'schedule a meeting with Sarah at 2pm', expected_tool: 'create_calendar_event', expected_args: { title: 'meeting with Sarah', start: '14:00' }, category: 'calendar', difficulty: 'medium' },
  { input: 'add dentist appointment tomorrow at 10am', expected_tool: 'create_calendar_event', expected_args: { title: 'dentist appointment', start: 'tomorrow 10:00' }, category: 'calendar', difficulty: 'medium' },
  { input: 'create an event called standup from 9 to 9:30 tomorrow', expected_tool: 'create_calendar_event', expected_args: { title: 'standup', start: 'tomorrow 9:00', end: 'tomorrow 9:30' }, category: 'calendar', difficulty: 'hard' },
  { input: 'am I free at 3pm', expected_tool: 'get_calendar_events', expected_args: { date: 'today' }, category: 'calendar', difficulty: 'hard' },
  { input: 'whats happening this week', expected_tool: 'get_calendar_events', expected_args: { date: 'this week' }, category: 'calendar', difficulty: 'medium' },
  { input: 'put lunch with mike on my calendar for noon', expected_tool: 'create_calendar_event', expected_args: { title: 'lunch with mike', start: '12:00' }, category: 'calendar', difficulty: 'medium' },
  { input: 'check my schedule', expected_tool: 'get_calendar_events', expected_args: {}, category: 'calendar', difficulty: 'easy' },
  { input: 'cal', expected_tool: 'get_calendar_events', expected_args: {}, category: 'calendar', difficulty: 'hard' },
  { input: 'block off 2-4pm for deep work', expected_tool: 'create_calendar_event', expected_args: { title: 'deep work', start: '14:00', end: '16:00' }, category: 'calendar', difficulty: 'hard' },
  { input: 'when is my next meeting', expected_tool: 'get_calendar_events', expected_args: { count: 1 }, category: 'calendar', difficulty: 'medium' },
  { input: 'events on march 15th', expected_tool: 'get_calendar_events', expected_args: { date: '2024-03-15' }, category: 'calendar', difficulty: 'medium' },

  // ============================================================
  // REMINDERS (10 cases)
  // ============================================================
  { input: 'remind me to buy milk at 5pm', expected_tool: 'create_reminder', expected_args: { text: 'buy milk', time: '17:00' }, category: 'reminder', difficulty: 'easy' },
  { input: 'set a reminder to call mom in 30 minutes', expected_tool: 'create_reminder', expected_args: { text: 'call mom', time: 'in 30 minutes' }, category: 'reminder', difficulty: 'medium' },
  { input: 'reminder: submit report by end of day', expected_tool: 'create_reminder', expected_args: { text: 'submit report', time: 'end of day' }, category: 'reminder', difficulty: 'medium' },
  { input: 'dont let me forget to water the plants tomorrow morning', expected_tool: 'create_reminder', expected_args: { text: 'water the plants', time: 'tomorrow morning' }, category: 'reminder', difficulty: 'hard' },
  { input: 'remind me about the standup at 9', expected_tool: 'create_reminder', expected_args: { text: 'standup', time: '9:00' }, category: 'reminder', difficulty: 'easy' },
  { input: 'ping me at 3 to take a break', expected_tool: 'create_reminder', expected_args: { text: 'take a break', time: '15:00' }, category: 'reminder', difficulty: 'medium' },
  { input: 'I need to remember to pick up dry cleaning at 6', expected_tool: 'create_reminder', expected_args: { text: 'pick up dry cleaning', time: '18:00' }, category: 'reminder', difficulty: 'medium' },
  { input: 'remind me in 1 hour to check the oven', expected_tool: 'create_reminder', expected_args: { text: 'check the oven', time: 'in 1 hour' }, category: 'reminder', difficulty: 'easy' },
  { input: 'set alarm for 7am', expected_tool: 'create_reminder', expected_args: { text: 'alarm', time: '7:00' }, category: 'reminder', difficulty: 'medium' },
  { input: 'nudge me about the PR review at 4', expected_tool: 'create_reminder', expected_args: { text: 'PR review', time: '16:00' }, category: 'reminder', difficulty: 'hard' },

  // ============================================================
  // PET ACTIONS (12 cases)
  // ============================================================
  { input: 'come here', expected_tool: 'move_to_cursor', expected_args: {}, category: 'pet', difficulty: 'easy' },
  { input: 'move to the top left corner', expected_tool: 'move_to', expected_args: { x: 0, y: 0 }, category: 'pet', difficulty: 'medium' },
  { input: 'go to sleep', expected_tool: 'set_mood', expected_args: { value: 'sleeping' }, category: 'pet', difficulty: 'easy' },
  { input: 'cheer up!', expected_tool: 'set_mood', expected_args: { value: 'happy' }, category: 'pet', difficulty: 'easy' },
  { input: 'do a little dance', expected_tool: 'set_mood', expected_args: { value: 'excited' }, category: 'pet', difficulty: 'medium' },
  { input: 'snap your claws', expected_tool: 'snip', expected_args: {}, category: 'pet', difficulty: 'easy' },
  { input: 'wave at me', expected_tool: 'wave', expected_args: {}, category: 'pet', difficulty: 'easy' },
  { input: 'go over there', expected_tool: 'move_to_cursor', expected_args: {}, category: 'pet', difficulty: 'medium' },
  { input: 'be curious about something', expected_tool: 'set_mood', expected_args: { value: 'curious' }, category: 'pet', difficulty: 'easy' },
  { input: 'chill out', expected_tool: 'set_mood', expected_args: { value: 'idle' }, category: 'pet', difficulty: 'medium' },
  { input: 'move to the center of the screen', expected_tool: 'move_to', expected_args: { x: 960, y: 540 }, category: 'pet', difficulty: 'medium' },
  { input: 'think about something', expected_tool: 'set_mood', expected_args: { value: 'thinking' }, category: 'pet', difficulty: 'easy' },

  // ============================================================
  // APP LAUNCHING (8 cases)
  // ============================================================
  { input: 'open spotify', expected_tool: 'open_app', expected_args: { app: 'Spotify' }, category: 'app', difficulty: 'easy' },
  { input: 'launch terminal', expected_tool: 'open_app', expected_args: { app: 'Terminal' }, category: 'app', difficulty: 'easy' },
  { input: 'can you open slack for me', expected_tool: 'open_app', expected_args: { app: 'Slack' }, category: 'app', difficulty: 'easy' },
  { input: 'fire up vscode', expected_tool: 'open_app', expected_args: { app: 'Visual Studio Code' }, category: 'app', difficulty: 'medium' },
  { input: 'open chrome and go to github.com', expected_tool: 'open_url', expected_args: { url: 'https://github.com' }, category: 'app', difficulty: 'hard' },
  { input: 'take me to youtube', expected_tool: 'open_url', expected_args: { url: 'https://youtube.com' }, category: 'app', difficulty: 'medium' },
  { input: 'pull up finder', expected_tool: 'open_app', expected_args: { app: 'Finder' }, category: 'app', difficulty: 'medium' },
  { input: 'open the calculator', expected_tool: 'open_app', expected_args: { app: 'Calculator' }, category: 'app', difficulty: 'easy' },

  // ============================================================
  // MUSIC (8 cases)
  // ============================================================
  { input: 'play some jazz', expected_tool: 'play_music', expected_args: { query: 'jazz' }, category: 'music', difficulty: 'easy' },
  { input: 'pause the music', expected_tool: 'play_music', expected_args: { action: 'pause' }, category: 'music', difficulty: 'easy' },
  { input: 'next song', expected_tool: 'play_music', expected_args: { action: 'next' }, category: 'music', difficulty: 'easy' },
  { input: 'play bohemian rhapsody', expected_tool: 'play_music', expected_args: { query: 'bohemian rhapsody' }, category: 'music', difficulty: 'easy' },
  { input: 'put on some lo-fi beats', expected_tool: 'play_music', expected_args: { query: 'lo-fi beats' }, category: 'music', difficulty: 'medium' },
  { input: 'skip this track', expected_tool: 'play_music', expected_args: { action: 'next' }, category: 'music', difficulty: 'medium' },
  { input: 'resume playback', expected_tool: 'play_music', expected_args: { action: 'play' }, category: 'music', difficulty: 'medium' },
  { input: 'go back to the last song', expected_tool: 'play_music', expected_args: { action: 'previous' }, category: 'music', difficulty: 'medium' },

  // ============================================================
  // WEATHER (5 cases)
  // ============================================================
  { input: 'what is the weather like', expected_tool: 'get_weather', expected_args: {}, category: 'weather', difficulty: 'easy' },
  { input: 'is it going to rain today', expected_tool: 'get_weather', expected_args: {}, category: 'weather', difficulty: 'easy' },
  { input: 'weather in tokyo', expected_tool: 'get_weather', expected_args: { location: 'tokyo' }, category: 'weather', difficulty: 'easy' },
  { input: 'do I need an umbrella', expected_tool: 'get_weather', expected_args: {}, category: 'weather', difficulty: 'hard' },
  { input: 'how cold is it in new york', expected_tool: 'get_weather', expected_args: { location: 'new york' }, category: 'weather', difficulty: 'medium' },

  // ============================================================
  // TIMER (5 cases)
  // ============================================================
  { input: 'set a 5 minute timer', expected_tool: 'set_timer', expected_args: { duration: '5 minutes' }, category: 'timer', difficulty: 'easy' },
  { input: 'timer for 25 minutes, pomodoro', expected_tool: 'set_timer', expected_args: { duration: '25 minutes', label: 'pomodoro' }, category: 'timer', difficulty: 'medium' },
  { input: 'start a 1 hour countdown', expected_tool: 'set_timer', expected_args: { duration: '1 hour' }, category: 'timer', difficulty: 'easy' },
  { input: 'countdown 30 seconds', expected_tool: 'set_timer', expected_args: { duration: '30 seconds' }, category: 'timer', difficulty: 'easy' },
  { input: 'egg timer 10 mins', expected_tool: 'set_timer', expected_args: { duration: '10 minutes', label: 'egg timer' }, category: 'timer', difficulty: 'medium' },

  // ============================================================
  // SCREENSHOT (3 cases)
  // ============================================================
  { input: 'take a screenshot', expected_tool: 'take_screenshot', expected_args: {}, category: 'screenshot', difficulty: 'easy' },
  { input: 'capture my screen', expected_tool: 'take_screenshot', expected_args: {}, category: 'screenshot', difficulty: 'easy' },
  { input: 'what am I looking at', expected_tool: 'take_screenshot', expected_args: {}, category: 'screenshot', difficulty: 'hard' },

  // ============================================================
  // FILE SEARCH (5 cases)
  // ============================================================
  { input: 'find my resume', expected_tool: 'search_files', expected_args: { query: 'resume' }, category: 'files', difficulty: 'easy' },
  { input: 'where is the project report', expected_tool: 'search_files', expected_args: { query: 'project report' }, category: 'files', difficulty: 'easy' },
  { input: 'search for tax documents in downloads', expected_tool: 'search_files', expected_args: { query: 'tax', directory: 'Downloads' }, category: 'files', difficulty: 'medium' },
  { input: 'find all pdfs on my desktop', expected_tool: 'search_files', expected_args: { query: 'pdf', directory: 'Desktop' }, category: 'files', difficulty: 'medium' },
  { input: 'locate the readme file', expected_tool: 'search_files', expected_args: { query: 'readme' }, category: 'files', difficulty: 'easy' },

  // ============================================================
  // LIST FILES (6 cases)
  // ============================================================
  { input: "what files are on my desktop", expected_tool: 'list_files', expected_args: { directory: '~/Desktop' }, category: 'files', difficulty: 'easy' },
  { input: "show me my downloads", expected_tool: 'list_files', expected_args: { directory: '~/Downloads' }, category: 'files', difficulty: 'easy' },
  { input: "whats in my documents folder", expected_tool: 'list_files', expected_args: { directory: '~/Documents' }, category: 'files', difficulty: 'easy' },
  { input: "list files in downloads", expected_tool: 'list_files', expected_args: { directory: '~/Downloads' }, category: 'files', difficulty: 'medium' },
  { input: "what did I download recently", expected_tool: 'list_files', expected_args: { directory: '~/Downloads' }, category: 'files', difficulty: 'hard' },
  { input: "ls desktop", expected_tool: 'list_files', expected_args: { directory: '~/Desktop' }, category: 'files', difficulty: 'medium' },

  // ============================================================
  // NOTIFICATIONS (3 cases)
  // ============================================================
  { input: 'notify me that the build is done', expected_tool: 'send_notification', expected_args: { title: 'Build Complete', body: 'the build is done' }, category: 'notification', difficulty: 'medium' },
  { input: 'show a notification saying hello world', expected_tool: 'send_notification', expected_args: { title: 'Clawster', body: 'hello world' }, category: 'notification', difficulty: 'easy' },
  { input: 'alert me with a message that says lunch is ready', expected_tool: 'send_notification', expected_args: { title: 'Alert', body: 'lunch is ready' }, category: 'notification', difficulty: 'medium' },

  // ============================================================
  // MULTI-TOOL (5 cases) — expects the model to pick the primary tool
  // ============================================================
  { input: 'open spotify and play some chill music', expected_tool: 'play_music', expected_args: { query: 'chill' }, category: 'multi', difficulty: 'hard' },
  { input: 'come here and wave at me', expected_tool: 'move_to_cursor', expected_args: {}, category: 'multi', difficulty: 'hard' },
  { input: 'set a timer for 10 mins and remind me to stretch', expected_tool: 'set_timer', expected_args: { duration: '10 minutes' }, category: 'multi', difficulty: 'hard' },
  { input: 'check weather and add umbrella reminder if rain', expected_tool: 'get_weather', expected_args: {}, category: 'multi', difficulty: 'hard' },
  { input: 'take a screenshot and tell me what you see', expected_tool: 'take_screenshot', expected_args: {}, category: 'multi', difficulty: 'hard' },

  // ============================================================
  // REJECT — should NOT call any tool (10 cases)
  // ============================================================
  { input: 'hello', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'how are you doing', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'tell me a joke', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'what is the meaning of life', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'asdfghjkl', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: 'thanks!', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'you are so cute', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'what can you do', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
  { input: 'nevermind', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'easy' },
  { input: 'explain quantum computing', expected_tool: null, expected_args: {}, category: 'reject', difficulty: 'medium' },
];

// Utility: get dataset stats
export function getDatasetStats() {
  const byCategory: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};

  for (const tc of DATASET) {
    byCategory[tc.category] = (byCategory[tc.category] || 0) + 1;
    byDifficulty[tc.difficulty] = (byDifficulty[tc.difficulty] || 0) + 1;
  }

  return { total: DATASET.length, byCategory, byDifficulty };
}
