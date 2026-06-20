// Tool definitions for Clawster's computer-use assistant.
// These define what the fine-tuned model should be able to call.

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export const TOOLS: ToolDefinition[] = [
  // --- Pet actions (already implemented in Clawster) ---
  {
    name: 'set_mood',
    description: 'Change the pet animation/mood state',
    parameters: {
      value: {
        type: 'string',
        description: 'The mood to set',
        enum: ['idle', 'happy', 'curious', 'sleeping', 'thinking', 'excited', 'proud', 'mad', 'spin', 'huff', 'peek', 'side-eye', 'tap', 'scoot'],
        required: true,
      },
    },
  },
  {
    name: 'move_to',
    description: 'Move the pet to a screen position',
    parameters: {
      x: { type: 'number', description: 'X coordinate on screen', required: true },
      y: { type: 'number', description: 'Y coordinate on screen', required: true },
    },
  },
  {
    name: 'move_to_cursor',
    description: 'Move the pet near the user cursor',
    parameters: {},
  },
  {
    name: 'snip',
    description: 'Do a claw snip animation',
    parameters: {},
  },
  {
    name: 'wave',
    description: 'Wave claws happily',
    parameters: {},
  },

  // --- System actions (to be implemented) ---
  {
    name: 'open_app',
    description: 'Open an application by name',
    parameters: {
      app: { type: 'string', description: 'Application name (e.g. "Spotify", "Safari", "Terminal")', required: true },
    },
  },
  {
    name: 'open_url',
    description: 'Open a URL in the default browser',
    parameters: {
      url: { type: 'string', description: 'The URL to open', required: true },
    },
  },
  {
    name: 'close_app',
    description: 'Quit/close an application (asks for confirmation first)',
    parameters: {
      app: { type: 'string', description: 'Application name to quit', required: true },
    },
  },
  {
    name: 'run_shell',
    description: 'Run a shell command',
    parameters: {
      command: { type: 'string', description: 'The shell command to execute', required: true },
    },
  },
  {
    name: 'system_control',
    description: 'Control system settings (volume, brightness, battery, lock, Do Not Disturb)',
    parameters: {
      action: { type: 'string', description: 'volume_up|volume_down|mute|unmute|set_volume|brightness_up|brightness_down|battery|lock_screen|sleep|dnd_on|dnd_off', required: true },
      value: { type: 'number', description: '0-100 for set_volume', required: false },
    },
  },
  {
    name: 'send_message',
    description: 'Send an iMessage to a contact (asks for confirmation first)',
    parameters: {
      recipient: { type: 'string', description: 'Contact name or phone/email', required: true },
      message: { type: 'string', description: 'The message text to send', required: true },
    },
  },
  {
    name: 'block_apps',
    description: 'Focus mode — hide distracting apps for a while',
    parameters: {
      apps: { type: 'string', description: 'Apps to hide (e.g. "Slack, Discord") or omit for defaults', required: false },
      minutes: { type: 'number', description: 'How long to keep them hidden', required: false },
    },
  },
  {
    name: 'remember_preference',
    description: 'Remember a fact or preference about the user',
    parameters: {
      preference: { type: 'string', description: 'The fact to remember, e.g. "likes jazz"', required: true },
    },
  },
  {
    name: 'recall_preferences',
    description: 'Recall what the user has asked you to remember',
    parameters: {},
  },
  {
    name: 'take_screenshot',
    description: 'Capture the current screen',
    parameters: {},
  },
  {
    name: 'read_clipboard',
    description: "Read and show what's currently on the clipboard",
    parameters: {},
  },
  {
    name: 'summarize_clipboard',
    description: 'Read the clipboard and give a short summary of it',
    parameters: {},
  },

  // --- Calendar ---
  {
    name: 'get_calendar_events',
    description: 'List upcoming calendar events',
    parameters: {
      date: { type: 'string', description: 'Date to check (e.g. "today", "tomorrow", "2024-03-15")', required: false },
      count: { type: 'number', description: 'Max number of events to return', required: false },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event',
    parameters: {
      title: { type: 'string', description: 'Event title', required: true },
      start: { type: 'string', description: 'Start time (ISO 8601 or natural language)', required: true },
      end: { type: 'string', description: 'End time (ISO 8601 or natural language)', required: false },
    },
  },

  // --- Reminders ---
  {
    name: 'create_reminder',
    description: 'Set a reminder for the user',
    parameters: {
      text: { type: 'string', description: 'What to remind about', required: true },
      time: { type: 'string', description: 'When to remind (e.g. "15:00", "in 30 minutes", "tomorrow 9am")', required: true },
    },
  },

  // --- Music ---
  {
    name: 'play_music',
    description: 'Play music with optional genre/artist/song',
    parameters: {
      query: { type: 'string', description: 'Song, artist, or genre to play', required: false },
      action: { type: 'string', description: 'Playback action', enum: ['play', 'pause', 'next', 'previous'], required: false },
    },
  },

  // --- Notifications ---
  {
    name: 'send_notification',
    description: 'Show a system notification to the user',
    parameters: {
      title: { type: 'string', description: 'Notification title', required: true },
      body: { type: 'string', description: 'Notification body text', required: true },
    },
  },

  // --- File operations ---
  {
    name: 'search_files',
    description: 'Search for files on the computer',
    parameters: {
      query: { type: 'string', description: 'Search query (filename or content)', required: true },
      directory: { type: 'string', description: 'Directory to search in', required: false },
    },
  },

  {
    name: 'list_files',
    description: 'List files in a directory',
    parameters: {
      directory: { type: 'string', description: 'Directory path (e.g. "~/Desktop", "~/Downloads")', required: true },
    },
  },

  // --- Weather ---
  {
    name: 'get_weather',
    description: 'Get current weather or forecast',
    parameters: {
      location: { type: 'string', description: 'City or location name', required: false },
    },
  },

  // --- Timer ---
  {
    name: 'set_timer',
    description: 'Set a countdown timer',
    parameters: {
      duration: { type: 'string', description: 'Duration (e.g. "5 minutes", "1 hour", "30 seconds")', required: true },
      label: { type: 'string', description: 'Optional label for the timer', required: false },
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// Build OpenAI-compatible tool definitions
export function toOpenAITools() {
  return TOOLS.map((tool) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
      properties[name] = { type: param.type, description: param.description };
      if (param.enum) properties[name].enum = param.enum;
      if (param.required) required.push(name);
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  });
}

// Build a text description of tools (for local models without native tool calling)
export function toToolPrompt(): string {
  const lines = ['You are a desktop pet assistant. When the user asks you to do something, respond with a JSON tool call.\n'];
  lines.push('Available tools:');

  for (const tool of TOOLS) {
    const params = Object.entries(tool.parameters)
      .map(([name, p]) => `${name}: ${p.type}${p.required ? ' (required)' : ''}${p.enum ? ` [${p.enum.join('|')}]` : ''} - ${p.description}`)
      .join(', ');
    lines.push(`- ${tool.name}(${params}): ${tool.description}`);
  }

  lines.push('\nIf the user request does not match any tool, respond with: {"tool": null}');
  lines.push('Always respond with ONLY a JSON object: {"tool": "<name>", "args": {...}}');
  lines.push('Do NOT include any other text.');

  return lines.join('\n');
}
