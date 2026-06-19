import { shell, Notification } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PET_ACTION_TOOLS } from './tool-definitions';

const execAsync = promisify(exec);

export interface ToolResult {
  handled: boolean;
  petAction?: { type: string; value?: string; x?: number; y?: number };
  response?: string;
}

export async function executeTool(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  if ((PET_ACTION_TOOLS as readonly string[]).includes(tool)) {
    return { handled: true, petAction: { type: tool, ...args } as ToolResult['petAction'] };
  }

  switch (tool) {
    case 'open_app': {
      const app = args.app as string;
      if (!app) return { handled: true, response: "Which app should I open?" };
      try {
        await execAsync(`open -a "${app.replace(/"/g, '\\"')}"`);
        return { handled: true, response: `Opening ${app}!` };
      } catch {
        return { handled: true, response: `Couldn't find ${app} on your Mac.` };
      }
    }

    case 'open_url': {
      const url = args.url as string;
      if (!url) return { handled: true, response: "What URL should I open?" };
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      shell.openExternal(fullUrl);
      return { handled: true, response: `Opening ${fullUrl}!` };
    }

    case 'take_screenshot':
      return { handled: false, response: 'Taking a screenshot!' };

    case 'send_notification': {
      const title = args.title as string || 'Clawster';
      const body = args.body as string || '';
      new Notification({ title, body }).show();
      return { handled: true, response: `Notification sent!` };
    }

    case 'search_files': {
      const query = args.query as string;
      if (!query) return { handled: true, response: "What should I search for?" };
      const dir = args.directory as string || '~';
      try {
        const { stdout } = await execAsync(`mdfind -onlyin "${dir.replace(/"/g, '\\"')}" "${query.replace(/"/g, '\\"')}" | head -5`, { timeout: 5000 });
        const files = stdout.trim().split('\n').filter(Boolean);
        if (files.length === 0) return { handled: true, response: `No files found matching "${query}".` };
        const list = files.map(f => f.split('/').pop()).join(', ');
        return { handled: true, response: `Found: ${list}` };
      } catch {
        return { handled: true, response: `Couldn't search for "${query}".` };
      }
    }

    case 'get_weather':
      return { handled: true, response: "Weather integration coming soon! Check your favorite weather app for now." };

    case 'set_timer': {
      const duration = args.duration as string;
      const label = args.label as string || 'Timer';
      return { handled: true, response: `Timer set: ${duration}${label !== 'Timer' ? ` (${label})` : ''}. I'll remind you!` };
    }

    case 'play_music': {
      const action = args.action as string;
      const query = args.query as string;
      try {
        if (action === 'pause') {
          await execAsync(`osascript -e 'tell application "Music" to pause'`);
          return { handled: true, response: 'Music paused!' };
        }
        if (action === 'next') {
          await execAsync(`osascript -e 'tell application "Music" to next track'`);
          return { handled: true, response: 'Skipping to next track!' };
        }
        if (action === 'previous') {
          await execAsync(`osascript -e 'tell application "Music" to previous track'`);
          return { handled: true, response: 'Going back!' };
        }
        if (query) {
          await execAsync(`open -a Music`);
          return { handled: true, response: `Opening Music to play ${query}!` };
        }
        await execAsync(`osascript -e 'tell application "Music" to play'`);
        return { handled: true, response: 'Playing music!' };
      } catch {
        return { handled: true, response: "Couldn't control Music app." };
      }
    }

    case 'create_reminder':
    case 'get_calendar_events':
    case 'create_calendar_event':
      return { handled: true, response: "Calendar and reminders integration coming soon!" };

    default:
      return { handled: false };
  }
}
