import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 1500;
const MAX_TEXT_CHARS = 240;

type FrontmostWindowPayload = {
  appName?: string;
  windowTitle?: string;
};

const JXA_FRONTMOST_WINDOW_SCRIPT = `
(() => {
  const out = { appName: "", windowTitle: "" };
  try {
    const systemEvents = Application("System Events");
    let proc = null;

    try {
      const frontWhere = systemEvents.applicationProcesses.where({ frontmost: true })();
      if (frontWhere && frontWhere.length > 0) {
        proc = frontWhere[0];
      }
    } catch {}

    if (!proc) {
      try {
        const frontWhose = systemEvents.applicationProcesses.whose({ frontmost: true })();
        if (frontWhose && frontWhose.length > 0) {
          proc = frontWhose[0];
        }
      } catch {}
    }

    if (!proc) {
      return JSON.stringify(out);
    }

    out.appName = String(proc.name() || "");

    try {
      const windows = proc.windows();
      if (windows && windows.length > 0) {
        out.windowTitle = String(windows[0].name() || "");
      }
    } catch {}
  } catch {}

  return JSON.stringify(out);
})();
`;

function sanitizeInline(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function parsePayload(text: string): FrontmostWindowPayload | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      return JSON.parse(candidate) as FrontmostWindowPayload;
    } catch {
      continue;
    }
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as FrontmostWindowPayload;
  } catch {
    return null;
  }
}

export async function getFrontmostWindowTitleFromSystemEvents(expectedAppName?: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-l', 'JavaScript', '-e', JXA_FRONTMOST_WINDOW_SCRIPT],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );

    const parsed = parsePayload(String(stdout ?? ''));
    if (!parsed) return undefined;

    const appName = sanitizeInline(parsed.appName);
    if (!appName) return undefined;

    if (expectedAppName && appName !== expectedAppName) {
      return undefined;
    }

    const windowTitle = sanitizeInline(parsed.windowTitle);
    return windowTitle || undefined;
  } catch {
    return undefined;
  }
}

