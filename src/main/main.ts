import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  shell,
  screen,
  nativeImage,
} from 'electron';
import path from 'path';
import { Watchers } from './watchers';
import { ClawBotClient } from './clawbot-client';
import { createStore } from './store';

// Windows
let petWindow: BrowserWindow | null = null;
let assistantWindow: BrowserWindow | null = null;
let chatbarWindow: BrowserWindow | null = null;

// Services
let watchers: Watchers | null = null;
let clawbot: ClawBotClient | null = null;
const store = createStore();

const isDev = !app.isPackaged;

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  petWindow = new BrowserWindow({
    width: 120,
    height: 120,
    x: screenWidth - 140,
    y: screenHeight - 140,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Allow dragging
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    petWindow.loadURL('http://localhost:5173/pet.html');
  } else {
    petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createAssistantWindow() {
  if (assistantWindow) {
    assistantWindow.show();
    assistantWindow.focus();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  assistantWindow = new BrowserWindow({
    width: 400,
    height: 500,
    x: screenWidth - 420,
    y: screenHeight - 520,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    assistantWindow.loadURL('http://localhost:5173/assistant.html');
  } else {
    assistantWindow.loadFile(path.join(__dirname, '../renderer/assistant.html'));
  }

  assistantWindow.once('ready-to-show', () => {
    assistantWindow?.show();
    // Open DevTools in dev mode
    if (isDev) {
      assistantWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  assistantWindow.on('closed', () => {
    assistantWindow = null;
  });
}

function toggleAssistantWindow() {
  if (assistantWindow && assistantWindow.isVisible()) {
    assistantWindow.hide();
  } else {
    createAssistantWindow();
  }
}

function createChatbarWindow() {
  if (chatbarWindow) {
    chatbarWindow.show();
    chatbarWindow.focus();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const chatbarWidth = 650;
  const chatbarHeight = 300;

  chatbarWindow = new BrowserWindow({
    width: chatbarWidth,
    height: chatbarHeight,
    x: Math.round((screenWidth - chatbarWidth) / 2),
    y: Math.round(screenHeight / 3),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  chatbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    chatbarWindow.loadURL('http://localhost:5173/chatbar.html');
  } else {
    chatbarWindow.loadFile(path.join(__dirname, '../renderer/chatbar.html'));
  }

  chatbarWindow.once('ready-to-show', () => {
    chatbarWindow?.show();
  });

  // Hide on blur (click outside)
  chatbarWindow.on('blur', () => {
    chatbarWindow?.hide();
  });

  chatbarWindow.on('closed', () => {
    chatbarWindow = null;
  });
}

function toggleChatbarWindow() {
  if (chatbarWindow && chatbarWindow.isVisible()) {
    chatbarWindow.hide();
  } else {
    createChatbarWindow();
  }
}

// Screen capture
async function captureScreen(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail;
      return screenshot.toDataURL();
    }
    return null;
  } catch (error) {
    console.error('Screen capture failed:', error);
    return null;
  }
}

// IPC Handlers
function setupIPC() {
  // Toggle assistant window
  ipcMain.on('toggle-assistant', () => {
    toggleAssistantWindow();
  });

  // Close assistant window
  ipcMain.on('close-assistant', () => {
    assistantWindow?.hide();
  });

  // Toggle chatbar window
  ipcMain.on('toggle-chatbar', () => {
    toggleChatbarWindow();
  });

  // Close chatbar window
  ipcMain.on('close-chatbar', () => {
    chatbarWindow?.hide();
  });

  // Open external URL
  ipcMain.on('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });

  // Open file/folder
  ipcMain.on('open-path', (_event, filePath: string) => {
    shell.openPath(filePath);
  });

  // Get settings
  ipcMain.handle('get-settings', () => {
    return store.store;
  });

  // Update settings
  ipcMain.handle('update-settings', (_event, key: string, value: unknown) => {
    store.set(key, value);

    // Restart watchers if watch settings changed
    if (key.startsWith('watch.')) {
      watchers?.restart();
    }

    // Update ClawBot client if clawbot settings changed
    if (key.startsWith('clawbot.')) {
      const url = store.get('clawbot.url') as string;
      const token = store.get('clawbot.token') as string;
      clawbot?.updateConfig(url, token);
    }

    return store.store;
  });

  // Screen capture
  ipcMain.handle('capture-screen', async () => {
    return await captureScreen();
  });

  // Send message to ClawBot
  ipcMain.handle('send-to-clawbot', async (_event, message: string) => {
    if (!clawbot) return { error: 'ClawBot not connected' };
    return await clawbot.chat(message);
  });

  // Get ClawBot status
  ipcMain.handle('clawbot-status', () => {
    return clawbot?.isConnected() ?? false;
  });

  // Drag pet window
  ipcMain.on('pet-drag', (_event, deltaX: number, deltaY: number) => {
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + deltaX, y + deltaY);
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createPetWindow();
  setupIPC();

  // Register global hotkey: Option + Space for assistant
  globalShortcut.register('Alt+Space', () => {
    toggleAssistantWindow();
  });

  // Register global hotkey: Cmd + Shift + Space for chatbar
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleChatbarWindow();
  });

  // Initialize ClawBot client
  const clawbotUrl = store.get('clawbot.url') as string;
  const clawbotToken = store.get('clawbot.token') as string;
  clawbot = new ClawBotClient(clawbotUrl, clawbotToken);

  // Initialize watchers
  watchers = new Watchers(store, (event) => {
    // Send events to ClawBot
    clawbot?.sendEvent(event);

    // Forward to pet window for reactions
    petWindow?.webContents.send('activity-event', event);

    // Forward to assistant window
    assistantWindow?.webContents.send('activity-event', event);
  });

  watchers.start();

  // Listen for ClawBot responses
  clawbot.on('suggestion', (data) => {
    petWindow?.webContents.send('clawbot-suggestion', data);
    assistantWindow?.webContents.send('clawbot-suggestion', data);
  });

  clawbot.on('mood', (data) => {
    petWindow?.webContents.send('clawbot-mood', data);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  watchers?.stop();
});
