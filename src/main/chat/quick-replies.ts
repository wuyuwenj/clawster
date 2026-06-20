// Contextual quick-reply suggestions for the pet speech bubble, chosen from the
// tool that just ran (or, for plain conversation, the mood). These are phrased
// as things the user might tap to say next — most map to a real follow-up.

const TOOL_REPLIES: Record<string, string[]> = {
  take_screenshot: ['Tell me more', 'Thanks!'],
  play_music: ['Next song', 'Pause'],
  set_timer: ['Set another', 'Thanks!'],
  create_timer: ['Set another', 'Thanks!'],
  create_reminder: ['Remind me again', 'Thanks!'],
  get_weather: ['Anywhere else?', 'Thanks!'],
  get_calendar_events: ["What's next?", 'Thanks!'],
  create_calendar_event: ['Add another', 'Thanks!'],
  open_app: ['Open another', 'Thanks!'],
  close_app: ['Close another', 'Thanks!'],
  open_url: ['Open another', 'Thanks!'],
  list_files: ['Search them', 'Thanks!'],
  search_files: ['List a folder', 'Thanks!'],
  remember_preference: ['What else do you know?', 'Thanks!'],
  recall_preferences: ['Remember something new', 'Thanks!'],
  block_apps: ['How much time left?', 'Thanks!'],
  system_control: ['Do more', 'Thanks!'],
  run_shell: ['Run another', 'Thanks!'],
  send_message: ['Send another', 'Thanks!'],
  what_time: ['Set a timer', 'Thanks!'],
};

const MOOD_REPLIES: Record<string, string[]> = {
  curious: ['Tell me more', 'Cool!'],
  excited: ['Haha!', 'Thanks!'],
  happy: ['Haha!', 'Thanks!'],
  proud: ['Nice one!', 'Thanks!'],
  worried: ["I'm okay", 'Thanks'],
  doze: ['Wake up!', 'Goodnight'],
};

const DEFAULT_REPLIES = ['Thanks!', 'Not now'];

export function getQuickReplies(tool: string | null, mood?: string): string[] {
  if (tool && TOOL_REPLIES[tool]) return TOOL_REPLIES[tool];
  if (mood && MOOD_REPLIES[mood]) return MOOD_REPLIES[mood];
  return DEFAULT_REPLIES;
}
