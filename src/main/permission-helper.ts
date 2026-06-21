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
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 28px 32px;
    -webkit-app-region: drag;
    user-select: none;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .emoji { font-size: 36px; }
  h1 {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }
  .subtitle {
    font-size: 13px;
    color: #aaa;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #888;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .unlocks {
    background: #16213e;
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 18px;
  }
  .unlocks li {
    list-style: none;
    font-size: 13px;
    padding: 4px 0;
    color: #ccc;
  }
  .unlocks li::before {
    content: "✓ ";
    color: #4ade80;
    font-weight: bold;
  }
  .steps {
    background: #16213e;
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 20px;
  }
  .steps li {
    list-style: none;
    font-size: 13px;
    padding: 6px 0;
    color: #ccc;
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
    background: #e94560;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .status {
    text-align: center;
    font-size: 13px;
    color: #888;
    margin-bottom: 16px;
    min-height: 20px;
  }
  .status.granted {
    color: #4ade80;
    font-weight: 600;
  }
  .buttons {
    display: flex;
    gap: 10px;
    margin-top: auto;
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
    background: #e94560;
    color: #fff;
  }
  .btn-secondary {
    background: #2a2a4a;
    color: #aaa;
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
    const win = new BrowserWindow({
      width: 400,
      height: 480,
      resizable: false,
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
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(false);
    });

    ipcMain.once('permission-granted-ack', () => {
      cleanup();
      if (!win.isDestroyed()) win.close();
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

export function getRequiredPermission(tool: string): PermissionType | null {
  switch (tool) {
    case 'close_app':
    case 'block_apps':
      return 'accessibility';
    case 'system_control':
      return 'accessibility';
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
