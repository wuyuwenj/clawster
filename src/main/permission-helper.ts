import { systemPreferences, shell, BrowserWindow, ipcMain } from 'electron';

export type PermissionType = 'accessibility' | 'screen-recording' | 'microphone';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const SETTINGS_URLS: Record<PermissionType, string> = {
  'accessibility': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

const PERMISSION_INFO: Record<PermissionType, {
  title: string;
  emoji: string;
  why: string;
  unlocks: string[];
  steps: string[];
  needsRestart: boolean;
}> = {
  'accessibility': {
    title: 'Accessibility',
    emoji: '🦞',
    why: 'Clawster needs Accessibility permission to control apps on your Mac.',
    unlocks: [
      'Close & quit apps ("close Spotify")',
      'Focus mode — hide distracting apps',
      'Brightness control',
      'See which app you\'re using',
    ],
    steps: [
      'Click <b>Open Settings</b> below',
      'Find <b>Clawster</b> in the list',
      'Toggle it <b>ON</b>',
    ],
    needsRestart: false,
  },
  'screen-recording': {
    title: 'Screen Recording',
    emoji: '📸',
    why: 'Clawster needs Screen Recording permission to see what\'s on your screen.',
    unlocks: [
      'Screenshot analysis ("what\'s on my screen?")',
      'Screen context awareness',
    ],
    steps: [
      'Click <b>Open Settings</b> below',
      'Find <b>Clawster</b> in the list',
      'Toggle it <b>ON</b>',
      'You may need to <b>restart Clawster</b> after',
    ],
    needsRestart: true,
  },
  'microphone': {
    title: 'Microphone',
    emoji: '🎤',
    why: 'Clawster needs microphone access for voice input.',
    unlocks: ['Talk to your pet with your voice'],
    steps: ['Click <b>Allow</b> when the system prompt appears'],
    needsRestart: false,
  },
};

// State: decline cooldowns and dialog mutex
const declineTimestamps: Record<string, number> = {};
let activeDialog: BrowserWindow | null = null;

// Store reference for cooldown persistence
let storeRef: any = null;

export function setPermissionStore(store: any): void {
  storeRef = store;
  try {
    const saved = store.get('permissionDeclines') as Record<string, number> | undefined;
    if (saved && typeof saved === 'object') {
      Object.assign(declineTimestamps, saved);
    }
  } catch { /* fresh install */ }
}

function saveDecline(type: PermissionType): void {
  declineTimestamps[type] = Date.now();
  try {
    storeRef?.set('permissionDeclines', { ...declineTimestamps });
  } catch { /* non-critical */ }
}

function isInCooldown(type: PermissionType): boolean {
  const ts = declineTimestamps[type];
  if (!ts) return false;
  return Date.now() - ts < COOLDOWN_MS;
}

export function checkPermission(type: PermissionType): boolean {
  try {
    switch (type) {
      case 'accessibility':
        return systemPreferences.isTrustedAccessibilityClient(false);
      case 'screen-recording':
        return systemPreferences.getMediaAccessStatus('screen') === 'granted';
      case 'microphone':
        return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
    }
  } catch {
    return true;
  }
}

export async function requestPermission(type: PermissionType): Promise<boolean> {
  if (checkPermission(type)) return true;

  if (type === 'microphone') {
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return true;
    }
  }

  if (isInCooldown(type)) {
    console.log(`[Permission] ${type} in cooldown, skipping prompt`);
    return false;
  }

  // Only one dialog at a time
  if (activeDialog && !activeDialog.isDestroyed()) {
    console.log(`[Permission] Dialog already open, skipping`);
    return false;
  }

  // In test environment, skip the dialog window
  if (process.env.NODE_ENV === 'test') {
    console.log(`[Permission] Test env, skipping dialog for ${type}`);
    return false;
  }

  return showPermissionWindow(type);
}

function buildDialogHTML(type: PermissionType): string {
  const info = PERMISSION_INFO[type];
  const unlocksList = info.unlocks.map(u => `<li>${u}</li>`).join('');
  const stepsList = info.steps.map((s, i) => `<li><span class="step-num">${i + 1}</span>${s}</li>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0f0f;
    color: #e5e5e5;
    padding: 28px 32px 36px;
    -webkit-app-region: drag;
    user-select: none;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  body::-webkit-scrollbar { width: 6px; }
  body::-webkit-scrollbar-track { background: transparent; }
  body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .emoji { font-size: 36px; }
  h1 {
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: #fff;
  }
  .subtitle {
    font-size: 13px;
    color: #a3a3a3;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #737373;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .unlocks {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 18px;
  }
  .unlocks li {
    list-style: none;
    font-size: 13px;
    padding: 4px 0;
    color: #d4d4d4;
  }
  .unlocks li::before {
    content: "✓ ";
    color: #008080;
    font-weight: bold;
  }
  .steps {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 20px;
  }
  .steps li {
    list-style: none;
    font-size: 13px;
    padding: 6px 0;
    color: #d4d4d4;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #FF8C69;
    color: #0f0f0f;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .status {
    text-align: center;
    font-size: 13px;
    color: #737373;
    margin-bottom: 16px;
    min-height: 20px;
  }
  .status.granted {
    color: #008080;
    font-weight: 600;
  }
  .buttons {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    -webkit-app-region: no-drag;
  }
  button {
    flex: 1;
    padding: 10px 16px;
    border-radius: 8px;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  .btn-primary {
    background: #FF8C69;
    color: #0f0f0f;
  }
  .btn-secondary {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.05);
    color: #a3a3a3;
  }
</style>
</head>
<body>
  <div class="header">
    <span class="emoji">${info.emoji}</span>
    <h1>${info.title} Permission</h1>
  </div>
  <p class="subtitle">${info.why}</p>

  <div class="section-label">This unlocks</div>
  <ul class="unlocks">${unlocksList}</ul>

  <div class="section-label">How to enable</div>
  <ol class="steps">${stepsList}</ol>

  <div class="status" id="status">Waiting for permission...</div>

  <div class="buttons">
    <button class="btn-primary" id="openSettings">Open Settings</button>
    <button class="btn-secondary" id="maybeLater">Maybe Later</button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    document.getElementById('openSettings').addEventListener('click', () => {
      ipcRenderer.send('permission-open-settings');
    });
    document.getElementById('maybeLater').addEventListener('click', () => {
      ipcRenderer.send('permission-declined');
    });
    ipcRenderer.on('permission-granted', () => {
      document.getElementById('status').textContent = 'Permission granted! ✅';
      document.getElementById('status').className = 'status granted';
      setTimeout(() => ipcRenderer.send('permission-granted-ack'), 800);
    });
  </script>
</body>
</html>`;
}

function showPermissionWindow(type: PermissionType): Promise<boolean> {
  return new Promise((resolve) => {
    const height = PERMISSION_INFO[type].steps.length > 3 ? 660 : 600;
    const win = new BrowserWindow({
      width: 400,
      height,
      resizable: true,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      backgroundColor: '#1a1a2e',
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    activeDialog = win;

    const html = buildDialogHTML(type);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    let granted = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Poll for permission every second
    pollTimer = setInterval(() => {
      if (checkPermission(type)) {
        granted = true;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (!win.isDestroyed()) {
          win.webContents.send('permission-granted');
        }
      }
    }, 1000);

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      ipcMain.removeAllListeners('permission-open-settings');
      ipcMain.removeAllListeners('permission-declined');
      ipcMain.removeAllListeners('permission-granted-ack');
      activeDialog = null;
    };

    ipcMain.once('permission-open-settings', () => {
      shell.openExternal(SETTINGS_URLS[type]);
    });

    ipcMain.once('permission-declined', () => {
      saveDecline(type);
      try { require('./analytics').trackPermissionRequested({ permission: type, granted: false }); } catch {}
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(false);
    });

    ipcMain.once('permission-granted-ack', () => {
      try { require('./analytics').trackPermissionRequested({ permission: type, granted: true }); } catch {}
      cleanup();
      if (!win.isDestroyed()) win.close();
      if (PERMISSION_INFO[type].needsRestart) {
        const { dialog: dlg } = require('electron');
        dlg.showMessageBox({
          type: 'info',
          title: 'Restart Required',
          message: `${PERMISSION_INFO[type].title} permission granted! Please restart Clawster for it to take effect.`,
          buttons: ['Restart Now', 'Later'],
          defaultId: 0,
        }).then((r: { response: number }) => {
          if (r.response === 0) {
            const { app: electronApp } = require('electron');
            electronApp.relaunch();
            electronApp.quit();
          }
        });
      }
      resolve(true);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (!granted) {
        cleanup();
        if (!win.isDestroyed()) win.close();
        resolve(checkPermission(type));
      }
    }, 60000);

    win.on('closed', () => {
      cleanup();
      if (!granted) resolve(false);
    });
  });
}

export function getRequiredPermission(tool: string, args?: Record<string, unknown>): PermissionType | null {
  switch (tool) {
    case 'close_app':
    case 'block_apps':
      return 'accessibility';
    case 'system_control': {
      const action = String(args?.action || '').toLowerCase().replace(/[\s-]+/g, '_');
      // Battery and volume are read-only/safe — no accessibility needed
      if (['battery', 'volume_up', 'volume_down', 'mute', 'unmute', 'set_volume'].includes(action)) return null;
      return 'accessibility';
    }
    case 'take_screenshot':
      return 'screen-recording';
    default:
      return null;
  }
}

export function getDegradedMessage(type: PermissionType): string {
  const info = PERMISSION_INFO[type];
  const features = info.unlocks.slice(0, 2).join(' and ');
  return `I need ${info.title} permission for that! It lets me do ${features}. Say "Open Settings" and I'll take you there.`;
}

export function needsRestart(type: PermissionType): boolean {
  return PERMISSION_INFO[type].needsRestart;
}

export function checkCodeSigning(): { signed: boolean; warning?: string } {
  try {
    const { app } = require('electron');
    if (!app.isPackaged) return { signed: true };
    // In production, if the app isn't properly signed, TCC may silently
    // refuse to add it to the permission list
    const identity = process.env.CODE_SIGN_IDENTITY || '';
    if (app.isPackaged && !identity) {
      return {
        signed: false,
        warning: 'Clawster may not appear in System Settings because it isn\'t code-signed. Contact the developer.',
      };
    }
    return { signed: true };
  } catch {
    return { signed: true };
  }
}
