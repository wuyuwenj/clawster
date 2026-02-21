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
import { randomUUID } from 'crypto';
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

// Idle detection state
let lastActivityTime = Date.now();
let idleCheckInterval: NodeJS.Timeout | null = null;
let lastAppSwitchChat = 0;
const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const APP_SWITCH_CHAT_COOLDOWN = 60 * 1000; // 1 minute between app switch chats

// Pet movement animation state
let moveAnimation: NodeJS.Timeout | null = null;

// Pet action types that ClawBot can trigger
interface PetAction {
  type: 'set_mood' | 'move_to' | 'move_to_cursor' | 'snip' | 'wave' | 'look_at';
  value?: string;
  x?: number;
  y?: number;
  duration?: number;
}

// Smooth animation to move pet to target position
function animateMoveTo(targetX: number, targetY: number, duration: number = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (!petWindow) {
      resolve();
      return;
    }
    if (moveAnimation) clearInterval(moveAnimation);

    const [startX, startY] = petWindow.getPosition();
    const startTime = Date.now();

    // Notify renderer that movement started
    petWindow.webContents.send('pet-moving', { moving: true });

    moveAnimation = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out curve for natural movement
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentX = Math.round(startX + (targetX - startX) * eased);
      const currentY = Math.round(startY + (targetY - startY) * eased);

      petWindow?.setPosition(currentX, currentY);

      if (progress >= 1) {
        clearInterval(moveAnimation!);
        moveAnimation = null;
        petWindow?.webContents.send('pet-moving', { moving: false });
        resolve();
      }
    }, 16); // ~60fps
  });
}

// Get current screen context for ClawBot
async function getScreenContext(): Promise<{
  cursor: { x: number; y: number };
  petPosition: { x: number; y: number };
  screenSize: { width: number; height: number };
  screenshot?: string;
}> {
  const cursor = screen.getCursorScreenPoint();
  const [petX, petY] = petWindow?.getPosition() ?? [0, 0];
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  return {
    cursor,
    petPosition: { x: petX, y: petY },
    screenSize: { width, height },
  };
}

// Capture screen with cursor position overlay info
async function captureScreenWithContext(): Promise<{
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
} | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail;
      const cursor = screen.getCursorScreenPoint();
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      return {
        image: screenshot.toDataURL(),
        cursor,
        screenSize: { width, height },
      };
    }
    return null;
  } catch (error) {
    console.error('Screen capture failed:', error);
    return null;
  }
}

// Execute a pet action from ClawBot
async function executePetAction(action: PetAction): Promise<void> {
  if (!petWindow) return;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  switch (action.type) {
    case 'set_mood':
      if (action.value) {
        petWindow.webContents.send('clawbot-mood', { state: action.value });
      }
      break;

    case 'move_to':
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        // Clamp to screen bounds
        const targetX = Math.max(0, Math.min(action.x, screenWidth - 300));
        const targetY = Math.max(0, Math.min(action.y, screenHeight - 300));
        await animateMoveTo(targetX, targetY, action.duration || 1000);
      }
      break;

    case 'move_to_cursor':
      const cursor = screen.getCursorScreenPoint();
      const offset = 100; // Don't cover the cursor
      let targetX = cursor.x + offset;
      let targetY = cursor.y - 150; // Above cursor
      // Clamp to screen bounds
      targetX = Math.max(0, Math.min(targetX, screenWidth - 300));
      targetY = Math.max(0, Math.min(targetY, screenHeight - 300));
      await animateMoveTo(targetX, targetY, action.duration || 1500);
      break;

    case 'snip':
      petWindow.webContents.send('clawbot-mood', { state: 'curious' });
      setTimeout(() => {
        petWindow?.webContents.send('clawbot-mood', { state: 'idle' });
      }, 2000);
      break;

    case 'wave':
      petWindow.webContents.send('clawbot-mood', { state: 'happy' });
      setTimeout(() => {
        petWindow?.webContents.send('clawbot-mood', { state: 'idle' });
      }, 3000);
      break;

    case 'look_at':
      // Move pet to look at a screen position
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        const lookX = Math.max(0, Math.min(action.x - 150, screenWidth - 300));
        const lookY = Math.max(0, Math.min(action.y - 150, screenHeight - 300));
        petWindow.webContents.send('clawbot-mood', { state: 'curious' });
        await animateMoveTo(lookX, lookY, action.duration || 1200);
      }
      break;
  }
}

// Send chat popup to pet window
async function sendChatPopup(
  trigger: 'app_switch' | 'idle' | 'proactive',
  context?: string
) {
  if (!petWindow || !clawbot?.isConnected()) return;

  try {
    let prompt: string;
    switch (trigger) {
      case 'app_switch':
        prompt = context
          ? `The user just switched to ${context}. Give a brief, friendly comment or tip (1-2 sentences max). Be casual and helpful.`
          : 'The user is switching between apps. Give a brief, friendly productivity tip.';
        break;
      case 'idle':
        prompt = 'The user has been idle for a while. Give a brief, friendly message to check in or suggest a break (1-2 sentences max). Be warm and not pushy.';
        break;
      case 'proactive':
        prompt = context || 'Share a brief, helpful tip with the user.';
        break;
    }

    const response = await clawbot.chat(prompt);

    if (response.text && !response.text.includes('error')) {
      petWindow.webContents.send('chat-popup', {
        id: randomUUID(),
        text: response.text,
        trigger,
        quickReplies: ['Thanks!', 'Tell me more', 'Not now'],
      });
    }
  } catch (error) {
    console.error('Failed to send chat popup:', error);
  }
}

// Start idle detection
function startIdleDetection() {
  idleCheckInterval = setInterval(() => {
    const idleTime = Date.now() - lastActivityTime;

    if (idleTime > IDLE_THRESHOLD) {
      // Only send idle message once per idle period
      if (idleTime < IDLE_THRESHOLD + 10000) {
        sendChatPopup('idle');
      }
    }
  }, 30000); // Check every 30 seconds
}

// Reset idle timer on activity
function resetIdleTimer() {
  lastActivityTime = Date.now();
}

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Larger window to accommodate chat popup above the pet
  const petWindowWidth = 300;
  const petWindowHeight = 300;

  petWindow = new BrowserWindow({
    width: petWindowWidth,
    height: petWindowHeight,
    x: screenWidth - petWindowWidth - 20,
    y: screenHeight - petWindowHeight - 20,
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

  // Send message to ClawBot (with optional screen context)
  ipcMain.handle('send-to-clawbot', async (_event, message: string, includeScreen?: boolean) => {
    if (!clawbot) return { error: 'ClawBot not connected' };

    // Get screen context
    const context = await getScreenContext();
    let fullMessage = message;

    // Add screen context to message if requested or if message mentions screen/cursor
    const mentionsScreen = /screen|cursor|mouse|look|where|point|here|there|this/i.test(message);
    if (includeScreen || mentionsScreen) {
      const screenCapture = await captureScreenWithContext();
      if (screenCapture) {
        fullMessage = `[Screen Context: Cursor at (${screenCapture.cursor.x}, ${screenCapture.cursor.y}), Screen size: ${screenCapture.screenSize.width}x${screenCapture.screenSize.height}, Pet at (${context.petPosition.x}, ${context.petPosition.y})]\n\n${message}`;
        // Note: For full screen capture, you'd send the image to a vision-capable model
      }
    }

    const response = await clawbot.chat(fullMessage);

    // Handle any actions in the response
    if (response.action) {
      await executePetAction(response.action as PetAction);
    }

    // Also show response as speech bubble on pet
    if (response.text && !response.text.includes('error') && petWindow) {
      petWindow.webContents.send('chat-popup', {
        id: randomUUID(),
        text: response.text,
        trigger: 'proactive',
        quickReplies: ['Thanks!', 'Not now'],
      });
    }

    return response;
  });

  // Get screen context (cursor position, pet position, etc.)
  ipcMain.handle('get-screen-context', async () => {
    return await getScreenContext();
  });

  // Capture screen with context
  ipcMain.handle('capture-screen-with-context', async () => {
    return await captureScreenWithContext();
  });

  // Execute pet action directly
  ipcMain.handle('execute-pet-action', async (_event, action: PetAction) => {
    await executePetAction(action);
  });

  // Move pet to position
  ipcMain.handle('move-pet-to', async (_event, x: number, y: number, duration?: number) => {
    await animateMoveTo(x, y, duration || 1000);
  });

  // Move pet to cursor
  ipcMain.handle('move-pet-to-cursor', async () => {
    await executePetAction({ type: 'move_to_cursor' });
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
    // Reset idle timer on any activity
    resetIdleTimer();

    // Send events to ClawBot
    clawbot?.sendEvent(event);

    // Forward to pet window for reactions
    petWindow?.webContents.send('activity-event', event);

    // Forward to assistant window
    assistantWindow?.webContents.send('activity-event', event);

    // Trigger chat popup on app switch (with cooldown)
    if (event.type === 'app_focus_changed' && event.app) {
      const now = Date.now();
      if (now - lastAppSwitchChat > APP_SWITCH_CHAT_COOLDOWN) {
        lastAppSwitchChat = now;
        // Random chance to show chat (30% of the time to not be annoying)
        if (Math.random() < 0.3) {
          sendChatPopup('app_switch', event.app);
        }
      }
    }
  });

  watchers.start();

  // Start idle detection
  startIdleDetection();

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
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }
  if (moveAnimation) {
    clearInterval(moveAnimation);
  }
});
