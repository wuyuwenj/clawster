import { shell, Notification, BrowserWindow } from 'electron';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { PET_ACTION_TOOLS } from './tool-definitions';
import { addPreference, getPreferences } from './preferences';
import type { MemoryDB } from './memory/memory-db';

let memoryDB: MemoryDB | null = null;

export function setMemoryDB(db: MemoryDB | null): void {
  memoryDB = db;
}

let notifyCallback: ((title: string, body: string) => void) | null = null;

export function setNotifyCallback(cb: (title: string, body: string) => void): void {
  notifyCallback = cb;
}

// Supplies the current `pet.muted` setting. The store lives in main.ts, so it is
// injected here rather than imported. Unset (tests, early startup) means unmuted.
let mutedProvider: (() => boolean) | null = null;

export function setMutedProvider(fn: (() => boolean) | null): void {
  mutedProvider = fn;
}

function isMuted(): boolean {
  try {
    return Boolean(mutedProvider?.());
  } catch {
    return false;
  }
}

// Confirmation gate for safety-critical tools (run_shell, send_message, …).
// Returns true only when the user explicitly approves. When no callback is
// registered (e.g. in tests, or before the UI is ready) the safe default is to
// NOT proceed.
export interface ConfirmRequest {
  title: string;  // dialog headline, e.g. "Send this message?"
  detail: string; // the exact thing being approved (command, message preview, …)
}
let confirmCallback: ((req: ConfirmRequest) => Promise<boolean>) | null = null;

export function setConfirmCallback(cb: ((req: ConfirmRequest) => Promise<boolean>) | null): void {
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

function isAutomationDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not allowed to send Apple events|assistive access|not allowed assisting/i.test(msg);
}

function automationDeniedResponse(tool: string): ToolResult {
  return {
    handled: true,
    response: `I need Automation permission to ${tool.replace(/_/g, ' ')}! macOS should prompt you next time — click "OK" to allow it. If it doesn't, check System Settings → Privacy → Automation.`,
  };
}

function notify(title: string, body: string): void {
  try {
    const n = new Notification({ title, body, silent: isMuted() });
    n.show();
  } catch { /* notifications may not work in dev mode */ }
  notifyCallback?.(title, body);
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Escape a string for embedding inside AppleScript double-quoted literals.
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Run an osascript snippet without going through the shell.
function runOsascript(script: string, timeout = 8000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('osascript', ['-e', script], { timeout });
}

const MAX_TIMEOUT_MS = 2147483647; // 2^31 - 1, setTimeout max

function parseDurationMs(input: string): number {
  if (!input) return 0;
  const lower = input.toLowerCase();
  const numMatch = lower.match(/(\d+)/);
  if (!numMatch) return 0;
  const num = parseInt(numMatch[1], 10);
  let ms: number;
  if (lower.includes('week')) ms = num * 7 * 86400000;
  else if (lower.includes('day')) ms = num * 86400000;
  else if (lower.includes('hour')) ms = num * 3600000;
  else if (lower.includes('min')) ms = num * 60000;
  else if (lower.includes('sec')) ms = num * 1000;
  else ms = num * 60000;
  return Math.min(ms, MAX_TIMEOUT_MS);
}

// Structural summary of arbitrary clipboard text: detect a likely content type,
// then report size + a clean one-line preview. Deterministic and local — no LLM.
function summarizeText(text: string): string {
  const trimmed = text.trim();
  const chars = trimmed.length;
  const words = (trimmed.match(/\S+/g) || []).length;
  const lines = trimmed.split('\n').length;
  let kind = 'text';
  if (/^https?:\/\/\S+$/i.test(trimmed)) kind = 'a link';
  else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) kind = 'an email address';
  else if (/^\s*[[{]/.test(trimmed) && /[\]}]\s*$/.test(trimmed)) kind = 'JSON/data';
  else if (/(^|\n)\s*(function|const|let|var|import |class |def |=>|<\/?[a-z]+>|;\s*$)/m.test(trimmed)) kind = 'code';
  else if (/(^|\n)\s*[-*•]\s+\S+/.test(trimmed) && (trimmed.match(/(^|\n)\s*[-*•]\s+/g) || []).length >= 2) kind = 'a list';
  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 160);
  return `Looks like ${kind} — ${words} word${words === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}, ${chars} chars.\nPreview: ${preview}${trimmed.length > 160 ? '…' : ''}`;
}

// Resolve the list of apps to hide for focus mode. Accepts an array, a
// comma/"and"-separated string, or vague phrasing (→ default distraction list).
const DEFAULT_DISTRACTIONS = ['Slack', 'Discord', 'Messages', 'Mail', 'Telegram'];
export function resolveFocusApps(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const list = raw.map(s => String(s).trim()).filter(Boolean);
    return list.length ? list : DEFAULT_DISTRACTIONS;
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || /\b(distract\w*|social|everything|all|focus)\b/i.test(s)) return DEFAULT_DISTRACTIONS;
    const list = s.split(/\s*(?:,|;|\band\b)\s*/i).map(p => p.trim()).filter(Boolean);
    return list.length ? list : DEFAULT_DISTRACTIONS;
  }
  return DEFAULT_DISTRACTIONS;
}

// Focus mode: hide the given apps now and keep re-hiding them for the window.
let focusTimer: ReturnType<typeof setInterval> | null = null;
function hideApps(apps: string[]): void {
  for (const app of apps) {
    runOsascript(`tell application "System Events" to set visible of (every process whose name is "${escapeAppleScript(app)}") to false`).catch(() => {});
  }
}
function startFocusMode(apps: string[], minutes: number): void {
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  hideApps(apps);
  let ticks = 0;
  const maxTicks = Math.max(1, minutes) * 6; // re-hide every 10s for the window
  focusTimer = setInterval(() => {
    hideApps(apps);
    if (++ticks >= maxTicks) { if (focusTimer) clearInterval(focusTimer); focusTimer = null; }
  }, 10000);
}

export interface ToolResult {
  handled: boolean;
  petAction?: { type: string; value?: string; x?: number; y?: number };
  response?: string;
  // Set when a safety-critical action was proposed. `executed` reflects whether
  // the user approved and it actually ran.
  confirmation?: { kind: string; detail: string; executed: boolean };
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
        await execFileAsync('open', ['-a', app]);
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
          confirmation: { kind: 'run_shell', detail: command, executed: false },
        };
      }

      if (!confirmCallback) {
        return {
          handled: true,
          response: `I'd run \`${command}\`, but I need to ask before running shell commands and can't pop up a confirmation right now.`,
          confirmation: { kind: 'run_shell', detail: command, executed: false },
        };
      }

      const approved = await confirmCallback({ title: 'Run this shell command?', detail: command });
      if (!approved) {
        return {
          handled: true,
          response: `Okay, skipping \`${command}\`. *claws back*`,
          confirmation: { kind: 'run_shell', detail: command, executed: false },
        };
      }

      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 15000, maxBuffer: 1024 * 1024 });
        const out = (stdout || stderr || '').trim();
        const truncated = out.length > 1500 ? out.slice(0, 1500) + '\n…(truncated)' : out;
        return {
          handled: true,
          response: truncated ? `Ran \`${command}\`:\n${truncated}` : `Ran \`${command}\` — no output.`,
          confirmation: { kind: 'run_shell', detail: command, executed: true },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const clean = msg.length > 400 ? msg.slice(0, 400) + '…' : msg;
        return {
          handled: true,
          response: `\`${command}\` failed: ${clean}`,
          confirmation: { kind: 'run_shell', detail: command, executed: true },
        };
      }
    }

    case 'send_message': {
      const recipient = String(args.recipient ?? args.to ?? args.contact ?? '').trim();
      const body = String(args.message ?? args.body ?? args.text ?? '').trim();
      if (!recipient) return { handled: true, response: "Who should I message?" };
      if (!body) return { handled: true, response: `What should I say to ${recipient}?` };

      const preview = `To ${recipient}:\n${body}`;

      if (!confirmCallback) {
        return {
          handled: true,
          response: `I drafted "${body}" to ${recipient}, but I need to confirm before sending and can't pop up a dialog right now.`,
          confirmation: { kind: 'send_message', detail: preview, executed: false },
        };
      }

      const approved = await confirmCallback({ title: 'Send this iMessage?', detail: preview });
      if (!approved) {
        return {
          handled: true,
          response: `Okay, I won't send it. *holds the message back*`,
          confirmation: { kind: 'send_message', detail: preview, executed: false },
        };
      }

      const script = `
        tell application "Messages"
          set targetService to 1st service whose service type = iMessage
          set targetBuddy to buddy "${escapeAppleScript(recipient)}" of targetService
          send "${escapeAppleScript(body)}" to targetBuddy
        end tell`;
      try {
        await runOsascript(script);
        return {
          handled: true,
          response: `Sent to ${recipient}! 💬`,
          confirmation: { kind: 'send_message', detail: preview, executed: true },
        };
      } catch {
        return {
          handled: true,
          response: `Couldn't send to ${recipient} — Messages may need permission, or I couldn't find that contact.`,
          confirmation: { kind: 'send_message', detail: preview, executed: true },
        };
      }
    }

    case 'open_url': {
      const rawUrl = ((args.url as string) || '').trim();
      if (!rawUrl) return { handled: true, response: "What URL should I open?" };
      // Only open real web pages. Reject file:/javascript:/data:/ftp: and friends —
      // shell.openExternal on a file:// or javascript: URL is a security hole.
      const declined = { handled: true, response: "I can only open web links (http/https) — that one's not safe for a little lobster! 🦞" };
      let candidate: string;
      if (/^https?:\/\//i.test(rawUrl)) {
        candidate = rawUrl;                                   // already http(s)
      } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) {
        return declined;                                      // explicit non-web scheme (file://, ftp://, …)
      } else if (/^(javascript|data|file|vbscript|blob|about|mailto|tel):/i.test(rawUrl)) {
        return declined;                                      // non-hierarchical dangerous scheme
      } else {
        candidate = `https://${rawUrl}`;                      // bare domain / host:port / path
      }
      let parsed: URL | null = null;
      try { parsed = new URL(candidate); } catch { parsed = null; }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return declined;
      }
      shell.openExternal(parsed.href);
      return { handled: true, response: `Opening ${parsed.href}!` };
    }

    case 'take_screenshot':
      return { handled: false, response: 'Taking a screenshot!' };

    case 'read_clipboard': {
      try {
        const { stdout } = await execFileAsync('pbpaste', [], { timeout: 3000, maxBuffer: 1024 * 1024 });
        const text = stdout.replace(/\s+$/, '');
        if (!text.trim()) return { handled: true, response: "Your clipboard is empty!" };
        const truncated = text.length > 1200 ? text.slice(0, 1200) + '\n…(truncated)' : text;
        return { handled: true, response: `Here's your clipboard:\n${truncated}` };
      } catch {
        return { handled: true, response: "Couldn't read the clipboard." };
      }
    }

    case 'summarize_clipboard': {
      try {
        const { stdout } = await execFileAsync('pbpaste', [], { timeout: 3000, maxBuffer: 1024 * 1024 });
        const text = stdout.trim();
        if (!text) return { handled: true, response: "Your clipboard is empty — nothing to summarize!" };
        return { handled: true, response: summarizeText(text) };
      } catch {
        return { handled: true, response: "Couldn't read the clipboard to summarize." };
      }
    }

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
        const { stdout } = await execFileAsync('mdfind', ['-onlyin', dir, query], { timeout: 5000 });
        const files = stdout.trim().split('\n').filter(Boolean).slice(0, 8);
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
        const { stdout } = await execFileAsync('ls', ['-1', dir], { timeout: 3000 });
        const files = stdout.trim().split('\n').filter(Boolean).slice(0, 15);
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
        const { stdout } = await execFileAsync('curl', ['-s', url], { timeout: 5000 });
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
      if (ms <= 0) {
        return { handled: true, response: "I couldn't understand that duration — try something like '5 minutes' or '30 seconds'." };
      }
      setTimeout(() => {
        notify(label, `${duration} is up!`);
      }, ms);
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
        await runOsascript(`tell application "Reminders" to make new reminder with properties {name:"${escapeAppleScript(text)}"}`);
        return { handled: true, response: `Reminder created: "${text}"` };
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('create_reminder');
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
        const { stdout } = await runOsascript(script);
        const events = stdout.trim();
        if (!events) return { handled: true, response: "No upcoming events found." };
        const lines = events.split('\n').filter(Boolean).slice(0, 8);
        return { handled: true, response: `Upcoming events:\n${lines.map(l => `- ${l}`).join('\n')}` };
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('get_calendar_events');
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
              make new event with properties {summary:"${escapeAppleScript(title)}", start date:date "${escapeAppleScript(start)}"}
            end tell
          end tell`;
        await runOsascript(script, 5000);
        return { handled: true, response: `Event created: "${title}" at ${start}` };
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('create_calendar_event');
        return { handled: true, response: `Couldn't create the event. Calendar.app may need permission, or the time format wasn't recognized.` };
      }
    }

    case 'play_music': {
      const action = args.action as string;
      const query = args.query as string;
      try {
        if (action === 'pause') {
          await runOsascript('tell application "Music" to pause');
          return { handled: true, response: 'Music paused!' };
        }
        if (action === 'next') {
          await runOsascript('tell application "Music" to next track');
          return { handled: true, response: 'Skipping to next track!' };
        }
        if (action === 'previous') {
          await runOsascript('tell application "Music" to previous track');
          return { handled: true, response: 'Going back!' };
        }
        if (query) {
          await execFileAsync('open', ['-a', 'Music']);
          return { handled: true, response: `Opening Music to play ${query}!` };
        }
        await runOsascript('tell application "Music" to play');
        return { handled: true, response: 'Playing music!' };
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('play_music');
        return { handled: true, response: "Couldn't control Music app." };
      }
    }

    case 'system_control': {
      const action = String(args.action || '').toLowerCase().replace(/[\s-]+/g, '_');
      const rawValue = args.value ?? args.level ?? args.amount;
      try {
        switch (action) {
          case 'volume_up':
            await runOsascript('set volume output volume (output volume of (get volume settings) + 12)');
            return { handled: true, response: 'Volume up! 🔊' };
          case 'volume_down':
            await runOsascript('set volume output volume (output volume of (get volume settings) - 12)');
            return { handled: true, response: 'Volume down! 🔉' };
          case 'mute':
            await runOsascript('set volume output muted true');
            return { handled: true, response: 'Muted! 🔇' };
          case 'unmute':
            await runOsascript('set volume output muted false');
            return { handled: true, response: 'Sound back on! 🔊' };
          case 'set_volume': {
            const v = Math.max(0, Math.min(100, parseInt(String(rawValue ?? '50'), 10) || 50));
            await runOsascript(`set volume output volume ${v}`);
            return { handled: true, response: `Volume set to ${v}%` };
          }
          case 'brightness_up':
            await runOsascript('tell application "System Events" to key code 144');
            return { handled: true, response: 'Brightness up! ☀️' };
          case 'brightness_down':
            await runOsascript('tell application "System Events" to key code 145');
            return { handled: true, response: 'Brightness down! 🌙' };
          case 'battery': {
            const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 4000 });
            const pct = stdout.match(/(\d+)%/);
            const charging = /AC Power/.test(stdout) ? ', charging' : '';
            return { handled: true, response: pct ? `Battery is at ${pct[1]}%${charging} 🔋` : "Couldn't read the battery level." };
          }
          case 'lock_screen':
          case 'lock':
            await runOsascript('tell application "System Events" to keystroke "q" using {control down, command down}');
            return { handled: true, response: 'Locking your screen! 🔒' };
          case 'sleep':
          case 'sleep_display':
            await execFileAsync('pmset', ['displaysleepnow']);
            return { handled: true, response: 'Sending the display to sleep! 😴' };
          case 'dnd_on':
          case 'dnd':
          case 'do_not_disturb': {
            await execFileAsync('defaults', ['-currentHost', 'write', 'com.apple.notificationcenterui', 'doNotDisturb', '-boolean', 'true']).catch(() => {});
            await execFileAsync('killall', ['NotificationCenter']).catch(() => {});
            return { handled: true, response: 'Do Not Disturb on — keeping it quiet for you! 🌙' };
          }
          case 'dnd_off': {
            await execFileAsync('defaults', ['-currentHost', 'write', 'com.apple.notificationcenterui', 'doNotDisturb', '-boolean', 'false']).catch(() => {});
            await execFileAsync('killall', ['NotificationCenter']).catch(() => {});
            return { handled: true, response: 'Do Not Disturb off — notifications are back! 🔔' };
          }
          default:
            return { handled: true, response: "I can do volume, brightness, battery, lock screen, sleep, and Do Not Disturb!" };
        }
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('system_control');
        return { handled: true, response: "Couldn't do that — I might need Accessibility permission in System Settings." };
      }
    }

    case 'close_app': {
      const app = String(args.app ?? args.name ?? args.application ?? '').trim();
      if (!app) return { handled: true, response: "Which app should I close?" };

      if (!confirmCallback) {
        return {
          handled: true,
          response: `I'd close ${app}, but I need to confirm before quitting apps and can't pop up a dialog right now.`,
          confirmation: { kind: 'close_app', detail: app, executed: false },
        };
      }

      const approved = await confirmCallback({ title: 'Quit this app?', detail: app });
      if (!approved) {
        return {
          handled: true,
          response: `Okay, leaving ${app} open. *claws back*`,
          confirmation: { kind: 'close_app', detail: app, executed: false },
        };
      }

      try {
        await runOsascript(`tell application "${escapeAppleScript(app)}" to quit`, 5000);
        return {
          handled: true,
          response: `Closed ${app}! 👋`,
          confirmation: { kind: 'close_app', detail: app, executed: true },
        };
      } catch (err) {
        if (isAutomationDenied(err)) return automationDeniedResponse('close_app');
        return {
          handled: true,
          response: `Couldn't close ${app} — it may not be running.`,
          confirmation: { kind: 'close_app', detail: app, executed: true },
        };
      }
    }

    case 'remember_preference': {
      const pref = String(args.preference ?? args.text ?? args.value ?? args.fact ?? '').trim();
      if (!pref) return { handled: true, response: "What would you like me to remember?" };
      if (memoryDB?.isReady()) {
        const key = `pref_${pref.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
        await memoryDB.upsertFact({ key, value: pref, person: '', updatedAt: new Date().toISOString() });
      } else {
        addPreference(pref);
      }
      return { handled: true, response: `Got it — I'll remember that! 🧠 ("${pref}")` };
    }

    case 'recall_preferences': {
      if (memoryDB?.isReady()) {
        const facts = await memoryDB.getAllFacts();
        if (!facts.length) {
          return { handled: true, response: "I don't know much about you yet! Tell me to remember something. *curious snip*" };
        }
        return { handled: true, response: `Here's what I remember about you:\n${facts.map(f => `- ${f.value}`).join('\n')}` };
      }
      const prefs = getPreferences();
      if (!prefs.length) {
        return { handled: true, response: "I don't know much about you yet! Tell me to remember something. *curious snip*" };
      }
      return { handled: true, response: `Here's what I remember about you:\n${prefs.map(p => `- ${p}`).join('\n')}` };
    }

    case 'block_apps': {
      const apps = resolveFocusApps(args.apps ?? args.app ?? args.list);
      const durMs = parseDurationMs(String(args.minutes ?? args.duration ?? args.time ?? '25 minutes'));
      const minutes = Math.min(120, durMs > 0 ? Math.max(1, Math.round(durMs / 60000)) : 25);
      startFocusMode(apps, minutes);
      return {
        handled: true,
        response: `Focus mode on for ${minutes} min! Hiding ${apps.join(', ')}. *raises a tiny claw barrier* 🛡️`,
      };
    }

    case 'what_time': {
      const now = new Date();
      const until = args.until ?? args.date ?? args.event ?? args.target;
      if (until) {
        const target = new Date(String(until));
        if (!isNaN(target.getTime())) {
          const ms = target.getTime() - now.getTime();
          if (ms <= 0) return { handled: true, response: "That moment has already passed! ⏰" };
          const days = Math.floor(ms / 86400000);
          const hours = Math.floor((ms % 86400000) / 3600000);
          const mins = Math.floor((ms % 3600000) / 60000);
          const parts: string[] = [];
          if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
          if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
          if (!days && mins) parts.push(`${mins} minute${mins > 1 ? 's' : ''}`);
          return { handled: true, response: `${parts.join(', ') || 'Less than a minute'} to go! ⏳` };
        }
      }
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return { handled: true, response: `It's ${time} on ${date}. ⏰` };
    }

    default:
      return { handled: false };
  }
}
