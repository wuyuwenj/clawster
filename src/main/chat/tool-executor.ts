import { shell, Notification, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PET_ACTION_TOOLS } from './tool-definitions';

let notifyCallback: ((title: string, body: string) => void) | null = null;

export function setNotifyCallback(cb: (title: string, body: string) => void): void {
  notifyCallback = cb;
}

// Confirmation gate for safety-critical tools (run_shell). Returns true only
// when the user explicitly approves. When no callback is registered (e.g. in
// tests, or before the UI is ready) the safe default is to NOT execute.
let confirmCallback: ((command: string) => Promise<boolean>) | null = null;

export function setConfirmCallback(cb: ((command: string) => Promise<boolean>) | null): void {
  confirmCallback = cb;
}

// Commands so destructive we refuse to run them even with confirmation.
const CATASTROPHIC_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b[^|;&]*\s\/(\s|$|\*)/i, // rm -rf / or /*
  /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f?\b[^|;&]*\s~(\s|\/|$)/i,                    // rm -rf ~
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,                                 // fork bomb
  /\bmkfs\b/i,                                                                       // format filesystem
  /\bdd\b[^|;&]*\bof=\/dev\//i,                                                      // dd to a device
  /\b(shutdown|reboot|halt)\b/i,                                                     // power state
  />\s*\/dev\/(sd|disk|nvme)/i,                                                      // overwrite a disk
  /\bdiskutil\s+(erase|reformat)/i,                                                  // erase a disk
];

function isCatastrophic(command: string): boolean {
  return CATASTROPHIC_PATTERNS.some(re => re.test(command));
}

function notify(title: string, body: string): void {
  try {
    const n = new Notification({ title, body });
    n.show();
  } catch { /* notifications may not work in dev mode */ }
  notifyCallback?.(title, body);
}

const execAsync = promisify(exec);

function parseDurationMs(input: string): number {
  if (!input) return 0;
  const lower = input.toLowerCase();
  const numMatch = lower.match(/(\d+)/);
  if (!numMatch) return 0;
  const num = parseInt(numMatch[1], 10);
  if (lower.includes('hour')) return num * 3600000;
  if (lower.includes('min')) return num * 60000;
  if (lower.includes('sec')) return num * 1000;
  if (lower.startsWith('in ')) {
    if (lower.includes('hour')) return num * 3600000;
    return num * 60000;
  }
  return num * 60000;
}

export interface ToolResult {
  handled: boolean;
  petAction?: { type: string; value?: string; x?: number; y?: number };
  response?: string;
  // Set when a safety-critical action was proposed. `executed` reflects whether
  // the user approved and it actually ran.
  confirmation?: { kind: string; command: string; executed: boolean };
}

const PET_ACTION_RESPONSES: Record<string, string> = {
  set_mood: 'On it!',
  move_to: 'Coming!',
  move_to_cursor: 'Coming over!',
  snip: '*snip snip*',
  wave: '*waves claws*',
};

export async function executeTool(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  if ((PET_ACTION_TOOLS as readonly string[]).includes(tool)) {
    return {
      handled: true,
      petAction: { type: tool, ...args } as ToolResult['petAction'],
      response: PET_ACTION_RESPONSES[tool] || 'Done!',
    };
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

    case 'run_shell': {
      const command = (args.command as string || '').trim();
      if (!command) return { handled: true, response: "What command should I run?" };

      if (isCatastrophic(command)) {
        return {
          handled: true,
          response: `Whoa — \`${command}\` looks dangerous. I won't run that one. *backs away slowly*`,
          confirmation: { kind: 'run_shell', command, executed: false },
        };
      }

      if (!confirmCallback) {
        return {
          handled: true,
          response: `I'd run \`${command}\`, but I need to ask before running shell commands and can't pop up a confirmation right now.`,
          confirmation: { kind: 'run_shell', command, executed: false },
        };
      }

      const approved = await confirmCallback(command);
      if (!approved) {
        return {
          handled: true,
          response: `Okay, skipping \`${command}\`. *claws back*`,
          confirmation: { kind: 'run_shell', command, executed: false },
        };
      }

      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 15000, maxBuffer: 1024 * 1024 });
        const out = (stdout || stderr || '').trim();
        const truncated = out.length > 1500 ? out.slice(0, 1500) + '\n…(truncated)' : out;
        return {
          handled: true,
          response: truncated ? `Ran \`${command}\`:\n${truncated}` : `Ran \`${command}\` — no output.`,
          confirmation: { kind: 'run_shell', command, executed: true },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const clean = msg.length > 400 ? msg.slice(0, 400) + '…' : msg;
        return {
          handled: true,
          response: `\`${command}\` failed: ${clean}`,
          confirmation: { kind: 'run_shell', command, executed: true },
        };
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
      notify(title, body);
      return { handled: true, response: `Notification sent!` };
    }

    case 'search_files': {
      const query = args.query as string;
      if (!query) return { handled: true, response: "What should I search for?" };
      const dir = (args.directory as string || '~').replace('~', process.env.HOME || '');

      const vagueQueries = ['files', 'file', 'what', 'list', 'show', 'everything', 'all'];
      if (vagueQueries.includes(query.toLowerCase().trim())) {
        return executeTool('list_files', { directory: args.directory || '~/Desktop' });
      }
      try {
        const { stdout } = await execAsync(`mdfind -onlyin "${dir.replace(/"/g, '\\"')}" "${query.replace(/"/g, '\\"')}" | head -8`, { timeout: 5000 });
        const files = stdout.trim().split('\n').filter(Boolean);
        if (files.length === 0) return { handled: true, response: `No files found matching "${query}".` };
        const home = process.env.HOME || '';
        const formatted = files.map(f => {
          const short = home ? f.replace(home, '~') : f;
          return `- ${short}`;
        }).join('\n');
        return { handled: true, response: `Found ${files.length} file${files.length > 1 ? 's' : ''}:\n${formatted}` };
      } catch {
        return { handled: true, response: `Couldn't search for "${query}".` };
      }
    }

    case 'list_files': {
      const dir = (args.directory as string || '~/Desktop').replace('~', process.env.HOME || '');
      try {
        const { stdout } = await execAsync(`ls -1 "${dir.replace(/"/g, '\\"')}" | head -15`, { timeout: 3000 });
        const files = stdout.trim().split('\n').filter(Boolean);
        if (files.length === 0) return { handled: true, response: `That folder is empty.` };
        const home = process.env.HOME || '';
        const shortDir = home ? dir.replace(home, '~') : dir;
        const list = files.map(f => `- ${f}`).join('\n');
        return { handled: true, response: `Files in ${shortDir}:\n${list}${files.length >= 15 ? '\n(...and more)' : ''}` };
      } catch {
        return { handled: true, response: `Couldn't open that folder.` };
      }
    }

    case 'get_weather': {
      const location = (args.location as string) || '';
      try {
        const url = location
          ? `https://wttr.in/${encodeURIComponent(location)}?format=%l:+%C+%t+%h+humidity+%w+wind`
          : `https://wttr.in/?format=%l:+%C+%t+%h+humidity+%w+wind`;
        const { stdout } = await execAsync(`curl -s "${url}"`, { timeout: 5000 });
        const weather = stdout.trim();
        if (!weather || weather.includes('Unknown')) {
          return { handled: true, response: `Couldn't find weather for "${location}".` };
        }
        return { handled: true, response: weather };
      } catch {
        return { handled: true, response: "Couldn't check the weather right now." };
      }
    }

    case 'create_timer':
    case 'set_timer': {
      const duration = args.duration as string;
      const label = args.label as string || 'Timer';
      const ms = parseDurationMs(duration);
      if (ms > 0) {
        setTimeout(() => {
          notify(label, `${duration} is up!`);
        }, ms);
      }
      return { handled: true, response: `Timer set for ${duration}!${label !== 'Timer' ? ` (${label})` : ''}` };
    }

    case 'create_reminder': {
      const text = args.text as string;
      const time = args.time as string;
      if (!text) return { handled: true, response: "What should I remind you about?" };
      const ms = parseDurationMs(time);
      if (ms > 0) {
        setTimeout(() => {
          notify('Reminder', text);
        }, ms);
        return { handled: true, response: `I'll remind you: "${text}" in ${time}` };
      }
      try {
        await execAsync(`osascript -e 'tell application "Reminders" to make new reminder with properties {name:"${text.replace(/"/g, '\\"')}"}'`);
        return { handled: true, response: `Reminder created: "${text}"` };
      } catch {
        return { handled: true, response: `I'll remind you about "${text}" — but I couldn't add it to Reminders.app.` };
      }
    }

    case 'get_calendar_events': {
      try {
        const script = `
          tell application "Calendar"
            set output to ""
            set today to current date
            set endDate to today + 7 * days
            repeat with c in calendars
              repeat with e in (every event of c whose start date >= today and start date <= endDate)
                set output to output & (summary of e) & " — " & (start date of e as string) & linefeed
              end repeat
            end repeat
            return output
          end tell`;
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 8000 });
        const events = stdout.trim();
        if (!events) return { handled: true, response: "No upcoming events found." };
        const lines = events.split('\n').filter(Boolean).slice(0, 8);
        return { handled: true, response: `Upcoming events:\n${lines.map(l => `- ${l}`).join('\n')}` };
      } catch {
        return { handled: true, response: "Couldn't access Calendar. Make sure Calendar.app has permission." };
      }
    }

    case 'create_calendar_event': {
      const title = args.title as string;
      const start = args.start as string;
      if (!title || !start) return { handled: true, response: "I need a title and time for the event." };
      try {
        const script = `
          tell application "Calendar"
            tell calendar 1
              make new event with properties {summary:"${title.replace(/"/g, '\\"')}", start date:date "${start}"}
            end tell
          end tell`;
        await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
        return { handled: true, response: `Event created: "${title}" at ${start}` };
      } catch {
        return { handled: true, response: `Couldn't create the event. Calendar.app may need permission, or the time format wasn't recognized.` };
      }
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

    case 'system_control': {
      const action = String(args.action || '').toLowerCase().replace(/[\s-]+/g, '_');
      const rawValue = args.value ?? args.level ?? args.amount;
      try {
        switch (action) {
          case 'volume_up':
            await execAsync(`osascript -e 'set volume output volume (output volume of (get volume settings) + 12)'`);
            return { handled: true, response: 'Volume up! 🔊' };
          case 'volume_down':
            await execAsync(`osascript -e 'set volume output volume (output volume of (get volume settings) - 12)'`);
            return { handled: true, response: 'Volume down! 🔉' };
          case 'mute':
            await execAsync(`osascript -e 'set volume output muted true'`);
            return { handled: true, response: 'Muted! 🔇' };
          case 'unmute':
            await execAsync(`osascript -e 'set volume output muted false'`);
            return { handled: true, response: 'Sound back on! 🔊' };
          case 'set_volume': {
            const v = Math.max(0, Math.min(100, parseInt(String(rawValue ?? '50'), 10) || 50));
            await execAsync(`osascript -e 'set volume output volume ${v}'`);
            return { handled: true, response: `Volume set to ${v}%` };
          }
          case 'brightness_up':
            await execAsync(`osascript -e 'tell application "System Events" to key code 144'`);
            return { handled: true, response: 'Brightness up! ☀️' };
          case 'brightness_down':
            await execAsync(`osascript -e 'tell application "System Events" to key code 145'`);
            return { handled: true, response: 'Brightness down! 🌙' };
          case 'battery': {
            const { stdout } = await execAsync(`pmset -g batt`, { timeout: 4000 });
            const pct = stdout.match(/(\d+)%/);
            const charging = /AC Power/.test(stdout) ? ', charging' : '';
            return { handled: true, response: pct ? `Battery is at ${pct[1]}%${charging} 🔋` : "Couldn't read the battery level." };
          }
          case 'lock_screen':
          case 'lock':
            await execAsync(`osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}'`);
            return { handled: true, response: 'Locking your screen! 🔒' };
          case 'sleep':
          case 'sleep_display':
            await execAsync(`pmset displaysleepnow`);
            return { handled: true, response: 'Sending the display to sleep! 😴' };
          case 'dnd_on':
          case 'dnd':
          case 'do_not_disturb': {
            // Best-effort: legacy NotificationCenter toggle (effective on older
            // macOS). Harmless if no-op on newer Focus-based releases.
            await execAsync(`defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean true && killall NotificationCenter`).catch(() => {});
            return { handled: true, response: 'Do Not Disturb on — keeping it quiet for you! 🌙' };
          }
          case 'dnd_off': {
            await execAsync(`defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean false && killall NotificationCenter`).catch(() => {});
            return { handled: true, response: 'Do Not Disturb off — notifications are back! 🔔' };
          }
          default:
            return { handled: true, response: "I can do volume, brightness, battery, lock screen, sleep, and Do Not Disturb!" };
        }
      } catch {
        return { handled: true, response: "Couldn't do that — I might need Accessibility permission in System Settings." };
      }
    }

    default:
      return { handled: false };
  }
}
