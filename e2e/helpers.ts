import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const PROJECT_ROOT = path.join(__dirname, '..');

export function isProd(): boolean {
  return process.env.E2E_MODE === 'prod';
}

function prodExecutable(): string {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const dir = arch === 'arm64' ? 'mac-arm64' : 'mac';
  const exe = path.join(PROJECT_ROOT, 'release', dir, 'Clawster.app', 'Contents', 'MacOS', 'Clawster');
  if (!fs.existsSync(exe)) {
    throw new Error(`Production build not found at ${exe} — run npm run dist:mac first`);
  }
  return exe;
}

// Audio-safety flags for every Electron/e2e launch (this runs on the captain's
// live machine): mute all output, and hand Chromium a FAKE media device so a
// test that reaches getUserMedia never opens the real microphone.
const AUDIO_SAFE_ARGS = [
  '--mute-audio',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

export function launchApp(opts?: { dataDir?: string }): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, NODE_ENV: 'test' };
  if (opts?.dataDir) env.CLAWSTER_DATA_DIR = opts.dataDir;

  if (isProd()) {
    return electron.launch({ executablePath: prodExecutable(), args: AUDIO_SAFE_ARGS, env });
  }
  return electron.launch({ args: [PROJECT_ROOT, ...AUDIO_SAFE_ARGS], env });
}

export async function sendChat(page: Page, msg: string): Promise<any> {
  return page.evaluate(async (m) => {
    const r = await (window as any).clawster.sendToClawbot(m);
    return JSON.parse(JSON.stringify(r));
  }, msg);
}

export async function findWindow(app: ElectronApplication, substr: string, timeout = 25000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch { /* window mid-navigation */ }
      if (url.includes(substr)) {
        await w.waitForLoadState('domcontentloaded').catch(() => {});
        return w;
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Window matching "${substr}" not found within ${timeout}ms`);
}

export async function hasWindow(app: ElectronApplication, substr: string): Promise<boolean> {
  return app.windows().some(w => {
    try { return w.url().includes(substr); } catch { return false; }
  });
}
