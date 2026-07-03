import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import Store from 'electron-store';
import type { StoreSchema } from './store';
import type { TutorialManager } from './tutorial';

// Window state
let petWindow: BrowserWindow | null = null;
let petChatWindow: BrowserWindow | null = null;
let assistantWindow: BrowserWindow | null = null;
let chatbarWindow: BrowserWindow | null = null;
let screenshotQuestionWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let petContextMenuWindow: BrowserWindow | null = null;
let pendingPetChatReveal = false;
let petChatRevealTimeout: NodeJS.Timeout | null = null;
let petChatAutoHideTimeout: NodeJS.Timeout | null = null;

// Pet window size constants
const PET_WINDOW_WIDTH = 164;
const PET_WINDOW_HEIGHT = 164;
const PET_WINDOW_TUTORIAL_WIDTH = 320;
const PET_WINDOW_TUTORIAL_HEIGHT = 350;
const PET_CHAT_MIN_WIDTH = 220;
const PET_CHAT_MAX_WIDTH = 360;
const PET_CHAT_MIN_HEIGHT = 90;
const PET_CHAT_MAX_HEIGHT = 420;
const PET_CHAT_AUTO_HIDE_MS = 10000;
const PET_CHAT_VERTICAL_GAP = -2;
const ASSISTANT_VERTICAL_GAP = -3;
const PET_CONTEXT_MENU_WIDTH = 220;
const PET_CONTEXT_MENU_HEIGHT = 342;

// Debug border support
const DEV_WINDOW_BORDER_CSS = `
  html, body {
    box-sizing: border-box !important;
    border: 1px dashed rgba(255, 120, 120, 0.95) !important;
  }
`;
const debugBorderStyleKeys = new WeakMap<BrowserWindow, string>();

// Dependencies
let store: Store<StoreSchema> = null!;
let isDev = false;
let DEV_PORT = '5173';
let tutorialManager: TutorialManager = null!;
let startMainAppFn: () => void = () => {};

export function initWindows(deps: {
  store: Store<StoreSchema>;
  isDev: boolean;
  devPort: string;
  tutorialManager: TutorialManager;
  startMainApp: () => void;
}): void {
  store = deps.store;
  isDev = deps.isDev;
  DEV_PORT = deps.devPort;
  tutorialManager = deps.tutorialManager;
  startMainAppFn = deps.startMainApp;
}

// --- Window getters ---

export function getPetWindow(): BrowserWindow | null {
  return petWindow;
}

export function getPetChatWindow(): BrowserWindow | null {
  return petChatWindow;
}

export function getAssistantWindow(): BrowserWindow | null {
  return assistantWindow;
}

export function getChatbarWindow(): BrowserWindow | null {
  return chatbarWindow;
}

export function getScreenshotQuestionWindow(): BrowserWindow | null {
  return screenshotQuestionWindow;
}

export function getOnboardingWindow(): BrowserWindow | null {
  return onboardingWindow;
}

export function getPetContextMenuWindow(): BrowserWindow | null {
  return petContextMenuWindow;
}

// --- Debug border functions ---

export function shouldShowDebugWindowBorders(): boolean {
  return isDev && Boolean(store.get('dev.windowBorders'));
}

export async function applyDebugWindowBorder(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;

  const previousKey = debugBorderStyleKeys.get(window);
  if (previousKey) {
    try {
      await window.webContents.removeInsertedCSS(previousKey);
    } catch (error) {
      console.warn('[Dev] Failed to remove debug window border CSS:', error);
    }
    debugBorderStyleKeys.delete(window);
  }

  if (!shouldShowDebugWindowBorders()) return;

  try {
    const key = await window.webContents.insertCSS(DEV_WINDOW_BORDER_CSS);
    debugBorderStyleKeys.set(window, key);
  } catch (error) {
    console.warn('[Dev] Failed to apply debug window border CSS:', error);
  }
}

export function wireDebugWindowBorder(window: BrowserWindow): void {
  window.webContents.on('did-finish-load', () => {
    void applyDebugWindowBorder(window);
  });
}

export function applyDebugWindowBordersToAllWindows(): void {
  const windows = [petWindow, petChatWindow, assistantWindow, chatbarWindow, screenshotQuestionWindow, onboardingWindow, petContextMenuWindow];
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue;
    void applyDebugWindowBorder(window);
  }
}

// --- Pet window ---

export function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const petWindowWidth = PET_WINDOW_WIDTH;
  const petWindowHeight = PET_WINDOW_HEIGHT;

  const savedPosition = store.get('pet.position') as { x: number; y: number } | null;
  const startX = savedPosition ? savedPosition.x : screenWidth - petWindowWidth - 20;
  const startY = savedPosition ? savedPosition.y : screenHeight - petWindowHeight - 20;

  petWindow = new BrowserWindow({
    width: petWindowWidth,
    height: petWindowHeight,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wireDebugWindowBorder(petWindow);

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    petWindow.loadURL(`http://localhost:${DEV_PORT}/pet.html`);
  } else {
    petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  petWindow.on('closed', () => {
    petWindow = null;
    petChatWindow?.close();
    petContextMenuWindow?.close();
  });
}

// --- Pet chat ---

export function schedulePetChatAutoHide() {
  if (petChatAutoHideTimeout) {
    clearTimeout(petChatAutoHideTimeout);
  }

  petChatAutoHideTimeout = setTimeout(() => {
    petChatAutoHideTimeout = null;
    if (!petChatWindow || petChatWindow.isDestroyed() || !petChatWindow.isVisible()) return;
    hidePetChat();
  }, PET_CHAT_AUTO_HIDE_MS);
}

export function showPetChat(message: { id: string; text: string; quickReplies?: string[]; toolCall?: { tool: string | null; args?: Record<string, unknown> }; userInput?: string }) {
  if (!petWindow) return;

  if (tutorialManager?.getStatus().isActive) return;
  pendingPetChatReveal = true;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();

  const chatWidth = PET_CHAT_MIN_WIDTH;
  const chatHeight = PET_CHAT_MIN_HEIGHT;
  const chatX = petX + (petWidth - chatWidth) / 2;
  const chatY = petY - chatHeight + PET_CHAT_VERTICAL_GAP;

  const scheduleFallbackReveal = () => {
    if (petChatRevealTimeout) clearTimeout(petChatRevealTimeout);
    petChatRevealTimeout = setTimeout(() => {
      if (!pendingPetChatReveal || !petChatWindow || petChatWindow.isDestroyed()) return;
      petChatWindow.setOpacity(1);
      petChatWindow.showInactive();
      pendingPetChatReveal = false;
      petChatRevealTimeout = null;
    }, 250);
  };

  if (!petChatWindow) {
    petChatWindow = new BrowserWindow({
      width: chatWidth,
      height: chatHeight,
      x: Math.max(0, chatX),
      y: Math.max(0, chatY),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    wireDebugWindowBorder(petChatWindow);

    petChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (isDev) {
      petChatWindow.loadURL(`http://localhost:${DEV_PORT}/pet-chat.html`);
    } else {
      petChatWindow.loadFile(path.join(__dirname, '../renderer/pet-chat.html'));
    }

    petChatWindow.on('closed', () => {
      petChatWindow = null;
      pendingPetChatReveal = false;
      if (petChatRevealTimeout) {
        clearTimeout(petChatRevealTimeout);
        petChatRevealTimeout = null;
      }
      if (petChatAutoHideTimeout) {
        clearTimeout(petChatAutoHideTimeout);
        petChatAutoHideTimeout = null;
      }
    });

    petChatWindow.once('ready-to-show', () => {
      petChatWindow?.setOpacity(0);
      petChatWindow?.showInactive();
      petChatWindow?.webContents.send('chat-message', message);
      scheduleFallbackReveal();
      schedulePetChatAutoHide();
    });
  } else {
    petChatWindow.setPosition(Math.max(0, Math.round(chatX)), Math.max(0, Math.round(chatY)));
    petChatWindow.setOpacity(0);
    if (!petChatWindow.isVisible()) {
      petChatWindow.showInactive();
    }
    petChatWindow.webContents.send('chat-message', message);
    scheduleFallbackReveal();
    schedulePetChatAutoHide();
  }
}

export function hidePetChat() {
  pendingPetChatReveal = false;
  if (petChatRevealTimeout) {
    clearTimeout(petChatRevealTimeout);
    petChatRevealTimeout = null;
  }
  if (petChatAutoHideTimeout) {
    clearTimeout(petChatAutoHideTimeout);
    petChatAutoHideTimeout = null;
  }
  if (petChatWindow && !petChatWindow.isDestroyed()) {
    petChatWindow.webContents.send('pet-chat-hidden');
    petChatWindow.setOpacity(1);
    petChatWindow.hide();
  }
}

export function resizePetChatToContent(width: number, height: number) {
  if (!petChatWindow || petChatWindow.isDestroyed()) return;

  const nextWidth = Math.max(PET_CHAT_MIN_WIDTH, Math.min(Math.round(width), PET_CHAT_MAX_WIDTH));
  const nextHeight = Math.max(PET_CHAT_MIN_HEIGHT, Math.min(Math.round(height), PET_CHAT_MAX_HEIGHT));
  const [currentWidth, currentHeight] = petChatWindow.getSize();

  if (nextWidth !== currentWidth || nextHeight !== currentHeight) {
    petChatWindow.setSize(nextWidth, nextHeight, false);
  }

  updatePetChatPosition();

  if (pendingPetChatReveal) {
    if (petChatRevealTimeout) {
      clearTimeout(petChatRevealTimeout);
      petChatRevealTimeout = null;
    }
    petChatWindow.setOpacity(1);
    petChatWindow.showInactive();
    pendingPetChatReveal = false;
  }
}

export function updatePetChatPosition() {
  if (!petWindow || !petChatWindow) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();

  const [cw, ch] = petChatWindow.getSize();
  const chatX = petX + (petWidth - cw) / 2;
  const chatY = petY - ch + PET_CHAT_VERTICAL_GAP;

  petChatWindow.setPosition(Math.max(0, Math.round(chatX)), Math.max(0, Math.round(chatY)));
}

// --- Assistant window ---

export function updateAssistantPosition() {
  if (!petWindow || !assistantWindow || !assistantWindow.isVisible()) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();
  const [assistantWidth, assistantHeight] = assistantWindow.getSize();
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  let assistantX = petX + (petWidth - assistantWidth) / 2;
  const assistantY = petY - assistantHeight + ASSISTANT_VERTICAL_GAP;

  assistantX = Math.max(0, Math.min(assistantX, screenWidth - assistantWidth));

  assistantWindow.setPosition(Math.round(assistantX), Math.max(0, Math.round(assistantY)));
}

export function revealAssistantWindow() {
  if (!assistantWindow || assistantWindow.isDestroyed()) return;

  if (process.platform === 'darwin' || process.platform === 'linux') {
    assistantWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
  }

  assistantWindow.show();
  assistantWindow.focus();
}

export function openAssistantOnTab(tab: 'chat' | 'settings') {
  createAssistantWindow();
  if (!assistantWindow || assistantWindow.isDestroyed()) return;

  const channel = tab === 'settings' ? 'switch-to-settings' : 'switch-to-chat';
  const sendTabSwitch = () => {
    if (!assistantWindow || assistantWindow.isDestroyed()) return;
    assistantWindow.webContents.send(channel);
  };

  if (assistantWindow.webContents.isLoading()) {
    assistantWindow.webContents.once('did-finish-load', () => {
      setTimeout(sendTabSwitch, 0);
    });
  } else {
    sendTabSwitch();
  }
}

export function createAssistantWindow() {
  if (assistantWindow) {
    revealAssistantWindow();
    updateAssistantPosition();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  let initialX = screenWidth - 420;
  let initialY = screenHeight - 520;

  if (petWindow) {
    const [petX, petY] = petWindow.getPosition();
    const [petWidth] = petWindow.getSize();
    const aWidth = 400;
    const aHeight = 500;

    initialX = petX + (petWidth - aWidth) / 2;
    initialY = petY - aHeight + ASSISTANT_VERTICAL_GAP;

    initialX = Math.max(0, Math.min(initialX, screenWidth - aWidth));
    initialY = Math.max(0, initialY);
  }

  assistantWindow = new BrowserWindow({
    width: 400,
    height: 500,
    x: Math.round(initialX),
    y: Math.round(initialY),
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
  wireDebugWindowBorder(assistantWindow);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    assistantWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (isDev) {
    assistantWindow.loadURL(`http://localhost:${DEV_PORT}/assistant.html`);
  } else {
    assistantWindow.loadFile(path.join(__dirname, '../renderer/assistant.html'));
  }

  assistantWindow.once('ready-to-show', () => {
    revealAssistantWindow();
    if (isDev) {
      assistantWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  assistantWindow.on('closed', () => {
    assistantWindow = null;
  });
}

export function toggleAssistantWindow() {
  if (assistantWindow && assistantWindow.isVisible()) {
    assistantWindow.hide();
  } else {
    createAssistantWindow();
  }
}

// --- Pet context menu ---

export function createPetContextMenuWindow() {
  if (petContextMenuWindow) return;

  petContextMenuWindow = new BrowserWindow({
    width: PET_CONTEXT_MENU_WIDTH,
    height: PET_CONTEXT_MENU_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
  wireDebugWindowBorder(petContextMenuWindow);
  petContextMenuWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petContextMenuWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  if (isDev) {
    petContextMenuWindow.loadURL(`http://localhost:${DEV_PORT}/pet-context-menu.html`);
  } else {
    petContextMenuWindow.loadFile(path.join(__dirname, '../renderer/pet-context-menu.html'));
  }

  petContextMenuWindow.on('blur', () => {
    petContextMenuWindow?.hide();
  });

  petContextMenuWindow.on('closed', () => {
    petContextMenuWindow = null;
  });
}

export function showPetContextMenuAtCursor(cursorX: number, cursorY: number) {
  createPetContextMenuWindow();
  if (!petContextMenuWindow || petContextMenuWindow.isDestroyed()) return;

  const display = screen.getDisplayNearestPoint({ x: cursorX, y: cursorY });
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea;

  const x = Math.max(areaX, Math.min(Math.round(cursorX), areaX + areaWidth - PET_CONTEXT_MENU_WIDTH));
  const y = Math.max(areaY, Math.min(Math.round(cursorY), areaY + areaHeight - PET_CONTEXT_MENU_HEIGHT));

  const showWindow = () => {
    if (!petContextMenuWindow || petContextMenuWindow.isDestroyed()) return;
    petContextMenuWindow.setPosition(x, y);
    petContextMenuWindow.show();
    petContextMenuWindow.focus();
  };

  if (petContextMenuWindow.webContents.isLoading()) {
    petContextMenuWindow.webContents.once('did-finish-load', showWindow);
  } else {
    showWindow();
  }
}

// --- Chatbar ---

export function createChatbarWindow() {
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
    transparent: false,
    backgroundColor: '#0f0f0f',
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    show: false,
    skipTaskbar: true,
    hasShadow: true,
    minWidth: 300,
    minHeight: 80,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wireDebugWindowBorder(chatbarWindow);

  chatbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    chatbarWindow.loadURL(`http://localhost:${DEV_PORT}/chatbar.html`);
  } else {
    chatbarWindow.loadFile(path.join(__dirname, '../renderer/chatbar.html'));
  }

  chatbarWindow.once('ready-to-show', () => {
    chatbarWindow?.show();
  });

  chatbarWindow.on('closed', () => {
    chatbarWindow = null;
  });
}

export function toggleChatbarWindow() {
  if (chatbarWindow && chatbarWindow.isVisible()) {
    chatbarWindow.hide();
  } else {
    createChatbarWindow();
  }
}

// --- Screenshot question ---

export function createScreenshotQuestionWindow() {
  console.log('[ScreenshotQuestion] Creating window...');
  if (screenshotQuestionWindow) {
    console.log('[ScreenshotQuestion] Window exists, showing and refocusing');
    screenshotQuestionWindow.show();
    screenshotQuestionWindow.focus();
    screenshotQuestionWindow.webContents.send('retake-screenshot');
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  const windowWidth = 520;
  const windowHeight = 280;

  let x = Math.round(cursor.x - windowWidth / 2);
  let y = Math.round(cursor.y - windowHeight - 20);

  x = Math.max(display.workArea.x, Math.min(x, display.workArea.x + screenWidth - windowWidth));
  y = Math.max(display.workArea.y, Math.min(y, display.workArea.y + screenHeight - windowHeight));

  screenshotQuestionWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
  wireDebugWindowBorder(screenshotQuestionWindow);

  screenshotQuestionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    screenshotQuestionWindow.loadURL(`http://localhost:${DEV_PORT}/screenshot-question.html`);
  } else {
    screenshotQuestionWindow.loadFile(path.join(__dirname, '../renderer/screenshot-question.html'));
  }

  screenshotQuestionWindow.once('ready-to-show', () => {
    console.log('[ScreenshotQuestion] Window ready, showing...');
    screenshotQuestionWindow?.show();
  });

  screenshotQuestionWindow.on('blur', () => {
    screenshotQuestionWindow?.hide();
  });

  screenshotQuestionWindow.on('closed', () => {
    screenshotQuestionWindow = null;
  });
}

export function toggleScreenshotQuestionWindow() {
  if (screenshotQuestionWindow && screenshotQuestionWindow.isVisible()) {
    screenshotQuestionWindow.hide();
  } else {
    createScreenshotQuestionWindow();
  }
}

// --- Onboarding ---

export function createOnboardingWindow(): Promise<void> {
  return new Promise((resolve) => {
    console.log('[Onboarding] createOnboardingWindow called');
    if (onboardingWindow) {
      console.log('[Onboarding] Window already exists, showing');
      onboardingWindow.show();
      onboardingWindow.focus();
      resolve();
      return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 600;
    const windowHeight = 700;

    console.log('[Onboarding] Creating new BrowserWindow');
    onboardingWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: Math.round((screenWidth - windowWidth) / 2),
      y: Math.round((screenHeight - windowHeight) / 2),
      frame: false,
      transparent: false,
      resizable: true,
      minWidth: 500,
      minHeight: 550,
      show: false,
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    wireDebugWindowBorder(onboardingWindow);

    const loadUrl = isDev
      ? `http://localhost:${DEV_PORT}/onboarding.html`
      : path.join(__dirname, '../renderer/onboarding.html');
    console.log('[Onboarding] Loading URL:', loadUrl);

    if (isDev) {
      onboardingWindow.loadURL(`http://localhost:${DEV_PORT}/onboarding.html`);
      // Skip the detached devtools window during automated tests (CLAWSTER_DATA_DIR set),
      // where an extra window would interfere with window lookups.
      if (!process.env.CLAWSTER_DATA_DIR) {
        onboardingWindow.webContents.openDevTools({ mode: 'detach' });
      }
    } else {
      onboardingWindow.loadFile(path.join(__dirname, '../renderer/onboarding.html'));
    }

    onboardingWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[Onboarding] Failed to load:', errorCode, errorDescription);
    });

    onboardingWindow.once('ready-to-show', () => {
      console.log('[Onboarding] Window ready to show');
      onboardingWindow?.show();
      resolve();
    });

    onboardingWindow.on('closed', () => {
      console.log('[Onboarding] Window closed');
      onboardingWindow = null;
    });
  });
}

export function closeOnboardingAndStartApp() {
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  startMainAppFn();
}

// --- Pet window tutorial sizing ---

export function expandPetWindowForTutorial(): void {
  if (!petWindow) return;

  const [currentX, currentY] = petWindow.getPosition();

  const newY = currentY - (PET_WINDOW_TUTORIAL_HEIGHT - PET_WINDOW_HEIGHT);
  const newX = currentX - (PET_WINDOW_TUTORIAL_WIDTH - PET_WINDOW_WIDTH) / 2;

  const safeY = Math.max(0, newY);
  const safeX = Math.max(0, newX);

  petWindow.setSize(PET_WINDOW_TUTORIAL_WIDTH, PET_WINDOW_TUTORIAL_HEIGHT);
  petWindow.setPosition(Math.round(safeX), Math.round(safeY));
  petWindow.webContents.send('tutorial-window-expanded', true);
  console.log('[Tutorial] Pet window expanded for tutorial');
}

export function contractPetWindow(): void {
  if (!petWindow) return;

  const [currentX, currentY] = petWindow.getPosition();

  const newY = currentY + (PET_WINDOW_TUTORIAL_HEIGHT - PET_WINDOW_HEIGHT);
  const newX = currentX + (PET_WINDOW_TUTORIAL_WIDTH - PET_WINDOW_WIDTH) / 2;

  petWindow.setSize(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT);
  petWindow.setPosition(Math.round(newX), Math.round(newY));
  petWindow.webContents.send('tutorial-window-expanded', false);
  console.log('[Tutorial] Pet window contracted to normal');
}
