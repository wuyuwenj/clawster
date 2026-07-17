import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AUDIO_SAFE_ARGS, findWindow } from './electron-launch.mjs';

export { findWindow };

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

export function launchApp(opts?: { dataDir?: string }): Promise<ElectronApplication> {
  // Audio safety: NODE_ENV=test also mutes Animalese in the renderer (animalese.ts
  // reads window.clawster.audioMuted), and `--mute-audio` mutes all Chromium audio
  // output at the engine level — belt-and-suspenders so the suite never plays sound
  // on a real machine. The mic is never opened (only the speech-start IPC does that,
  // and the tests never call it).
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

export async function hasWindow(app: ElectronApplication, substr: string): Promise<boolean> {
  return app.windows().some(w => {
    try { return w.url().includes(substr); } catch { return false; }
  });
}
