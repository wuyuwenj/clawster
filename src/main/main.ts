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
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { Watchers } from './watchers';
import { ClawBotClient } from './clawbot-client';
import { createStore } from './store';

// Load environment variables
config();

// Windows
let petWindow: BrowserWindow | null = null;
let petChatWindow: BrowserWindow | null = null;
let assistantWindow: BrowserWindow | null = null;
let chatbarWindow: BrowserWindow | null = null;
let screenshotQuestionWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;

// Services
let watchers: Watchers | null = null;
let clawbot: ClawBotClient | null = null;
const store = createStore();

const isDev = !app.isPackaged;
const DEV_PORT = process.env.VITE_DEV_PORT || '5173';

// Idle detection state
let lastActivityTime = Date.now();
let idleCheckInterval: NodeJS.Timeout | null = null;
let lastAppSwitchChat = 0;
const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const APP_SWITCH_CHAT_COOLDOWN = 60 * 1000; // 1 minute between app switch chats

// Pet movement animation state
let moveAnimation: NodeJS.Timeout | null = null;

// Attention seeker state
let attentionInterval: NodeJS.Timeout | null = null;

// Idle behavior system
let idleBehaviorInterval: NodeJS.Timeout | null = null;
let lastInteractionTime = Date.now();
let isPerformingIdleBehavior = false;
const IDLE_BEHAVIOR_MIN_INTERVAL = 3000; // Minimum 3 seconds between behaviors (demo mode)
const IDLE_BEHAVIOR_MAX_INTERVAL = 8000; // Maximum 8 seconds between behaviors (demo mode)
const INTERACTION_COOLDOWN = 5000; // Wait 5 seconds after interaction before idle behaviors

type IdleBehavior = 'look_around' | 'snip_claws' | 'yawn' | 'wander' | 'stretch' | 'blink' | 'wiggle';

const IDLE_BEHAVIORS: { type: IdleBehavior; weight: number }[] = [
  { type: 'blink', weight: 25 },        // Most common
  { type: 'look_around', weight: 20 },
  { type: 'snip_claws', weight: 15 },
  { type: 'wiggle', weight: 15 },
  { type: 'stretch', weight: 10 },
  { type: 'yawn', weight: 10 },
  { type: 'wander', weight: 5 },        // Least common
];

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
      updatePetChatPosition();
      updateAssistantPosition();

      if (progress >= 1) {
        clearInterval(moveAnimation!);
        moveAnimation = null;
        petWindow?.webContents.send('pet-moving', { moving: false });
        resolve();
      }
    }, 16); // ~60fps
  });
}

// Attention seeker behavior - periodically moves pet toward cursor
function seekAttention() {
  const enabled = store.get('pet.attentionSeeker') ?? true; // Default to true
  if (!enabled || !petWindow) {
    console.log(`[AttentionSeeker] Skipped: enabled=${enabled}, petWindow=${!!petWindow}`);
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const [petX, petY] = petWindow.getPosition();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Calculate position near cursor (offset so pet doesn't cover cursor)
  const offset = 80;
  let targetX = cursor.x + offset;
  let targetY = cursor.y + offset;

  // Keep within screen bounds
  targetX = Math.max(0, Math.min(targetX, width - 300));
  targetY = Math.max(0, Math.min(targetY, height - 300));

  // Only move if far enough away (> 200px)
  const distance = Math.sqrt(Math.pow(cursor.x - petX, 2) + Math.pow(cursor.y - petY, 2));
  console.log(`[AttentionSeeker] Distance: ${Math.round(distance)}px, cursor: (${cursor.x}, ${cursor.y}), pet: (${petX}, ${petY})`);

  if (distance > 600) {
    console.log(`[AttentionSeeker] Moving to (${targetX}, ${targetY})`);
    // Set excited mood before moving
    petWindow.webContents.send('clawbot-mood', { state: 'excited', reason: 'wants attention' });
    animateMoveTo(targetX, targetY, 1500);
  } else {
    console.log('[AttentionSeeker] Too close, not moving');
  }
}

function startAttentionSeeker() {
  const minDelay = isDev ? 5000 : 30000;   // 5s in dev, 30s in prod
  const maxDelay = isDev ? 15000 : 120000; // 15s in dev, 2min in prod

  function scheduleNext() {
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    console.log(`[AttentionSeeker] Next seek in ${Math.round(delay / 1000)}s`);

    attentionInterval = setTimeout(() => {
      console.log('[AttentionSeeker] Seeking attention...');
      seekAttention();
      scheduleNext();
    }, delay);
  }

  console.log('[AttentionSeeker] Started');
  scheduleNext();
}

function stopAttentionSeeker() {
  if (attentionInterval) {
    clearTimeout(attentionInterval);
    attentionInterval = null;
  }
}

// Pick a random idle behavior based on weights
function pickRandomIdleBehavior(): IdleBehavior {
  const totalWeight = IDLE_BEHAVIORS.reduce((sum, b) => sum + b.weight, 0);
  let random = Math.random() * totalWeight;

  for (const behavior of IDLE_BEHAVIORS) {
    random -= behavior.weight;
    if (random <= 0) return behavior.type;
  }
  return 'blink';
}

// Execute an idle behavior
async function performIdleBehavior(behavior: IdleBehavior): Promise<void> {
  if (!petWindow || isPerformingIdleBehavior) return;

  isPerformingIdleBehavior = true;

  try {
    switch (behavior) {
      case 'blink':
        // Quick blink animation
        petWindow.webContents.send('idle-behavior', { type: 'blink' });
        break;

      case 'look_around':
        // Look left, then right
        petWindow.webContents.send('idle-behavior', { type: 'look_around' });
        break;

      case 'snip_claws':
        // Snip claws a couple times
        petWindow.webContents.send('idle-behavior', { type: 'snip_claws' });
        break;

      case 'yawn':
        // Yawn and look sleepy
        petWindow.webContents.send('idle-behavior', { type: 'yawn' });
        break;

      case 'stretch':
        // Stretch animation
        petWindow.webContents.send('idle-behavior', { type: 'stretch' });
        break;

      case 'wiggle':
        // Happy little wiggle
        petWindow.webContents.send('idle-behavior', { type: 'wiggle' });
        break;

      case 'wander':
        // Move to a random nearby position
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const [currentX, currentY] = petWindow.getPosition();

        // Wander within 200px of current position
        const wanderX = Math.max(0, Math.min(
          currentX + (Math.random() - 0.5) * 400,
          screenWidth - 300
        ));
        const wanderY = Math.max(0, Math.min(
          currentY + (Math.random() - 0.5) * 200,
          screenHeight - 300
        ));

        petWindow.webContents.send('idle-behavior', { type: 'wander', direction: wanderX > currentX ? 'right' : 'left' });
        await animateMoveTo(wanderX, wanderY, 2000);
        break;
    }
  } finally {
    // Reset after behavior completes
    setTimeout(() => {
      isPerformingIdleBehavior = false;
    }, 2000);
  }
}

// Schedule next idle behavior
function scheduleNextIdleBehavior(): void {
  const delay = IDLE_BEHAVIOR_MIN_INTERVAL + Math.random() * (IDLE_BEHAVIOR_MAX_INTERVAL - IDLE_BEHAVIOR_MIN_INTERVAL);

  idleBehaviorInterval = setTimeout(async () => {
    // Only perform if not recently interacted
    const timeSinceInteraction = Date.now() - lastInteractionTime;
    if (timeSinceInteraction > INTERACTION_COOLDOWN && !isPerformingIdleBehavior) {
      const behavior = pickRandomIdleBehavior();
      await performIdleBehavior(behavior);
    }

    // Schedule next one
    scheduleNextIdleBehavior();
  }, delay);
}

// Start idle behavior system
function startIdleBehaviors(): void {
  scheduleNextIdleBehavior();
}

// Stop idle behavior system
function stopIdleBehaviors(): void {
  if (idleBehaviorInterval) {
    clearTimeout(idleBehaviorInterval);
    idleBehaviorInterval = null;
  }
}

// Sleep system
let isSleeping = false;
let sleepCheckInterval: NodeJS.Timeout | null = null;
const SLEEP_AFTER_IDLE = 60000; // Fall asleep after 1 minute of no interaction

function fallAsleep(): void {
  if (isSleeping || !petWindow) return;
  isSleeping = true;
  console.log('[Sleep] Falling asleep - showing doze state');
  petWindow.webContents.send('clawbot-mood', { state: 'doze' });

  // After 5 seconds of dozing, go to full sleep
  setTimeout(() => {
    if (isSleeping && petWindow) {
      console.log('[Sleep] Now fully asleep');
      petWindow.webContents.send('clawbot-mood', { state: 'sleeping' });
    }
  }, 5000);
}

function wakeUp(): void {
  if (!isSleeping || !petWindow) return;
  isSleeping = false;
  console.log('[Sleep] Waking up - showing startle state');
  petWindow.webContents.send('clawbot-mood', { state: 'startle' });

  // After startle animation, return to idle
  setTimeout(() => {
    if (!isSleeping && petWindow) {
      console.log('[Sleep] Now idle');
      petWindow.webContents.send('clawbot-mood', { state: 'idle' });
    }
  }, 1000);
}

function startSleepCheck(): void {
  if (sleepCheckInterval) return;
  sleepCheckInterval = setInterval(() => {
    const timeSinceInteraction = Date.now() - lastInteractionTime;
    if (!isSleeping && timeSinceInteraction >= SLEEP_AFTER_IDLE) {
      fallAsleep();
    }
  }, 10000); // Check every 10 seconds
}

function stopSleepCheck(): void {
  if (sleepCheckInterval) {
    clearInterval(sleepCheckInterval);
    sleepCheckInterval = null;
  }
}

// Reset interaction timer (call this when user interacts)
function resetInteractionTimer(): void {
  lastInteractionTime = Date.now();
  if (isSleeping) {
    wakeUp();
  }
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

  // Small window just for the lobster
  const petWindowWidth = 130;
  const petWindowHeight = 130;

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

  // Allow dragging and going above menu bar
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    petWindow.loadURL(`http://localhost:${DEV_PORT}/pet.html`);
  } else {
    petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  petWindow.on('closed', () => {
    petWindow = null;
    // Also close the chat window when pet is closed
    petChatWindow?.close();
  });
}

// Show chat popup above the pet
function showPetChat(message: { id: string; text: string; quickReplies?: string[] }) {
  if (!petWindow) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();

  const chatWidth = 320;
  const chatHeight = 200;
  const chatX = petX + (petWidth - chatWidth) / 2;
  const chatY = petY - chatHeight - 10;

  if (!petChatWindow) {
    petChatWindow = new BrowserWindow({
      width: chatWidth,
      height: chatHeight,
      x: Math.max(0, chatX),
      y: Math.max(0, chatY),
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

    petChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (isDev) {
      petChatWindow.loadURL(`http://localhost:${DEV_PORT}/pet-chat.html`);
    } else {
      petChatWindow.loadFile(path.join(__dirname, '../renderer/pet-chat.html'));
    }

    petChatWindow.on('closed', () => {
      petChatWindow = null;
    });

    petChatWindow.once('ready-to-show', () => {
      petChatWindow?.webContents.send('chat-message', message);
      petChatWindow?.show();
    });
  } else {
    // Update position and message
    petChatWindow.setPosition(Math.max(0, Math.round(chatX)), Math.max(0, Math.round(chatY)));
    petChatWindow.webContents.send('chat-message', message);
    petChatWindow.show();
  }
}

function hidePetChat() {
  petChatWindow?.hide();
}

function updatePetChatPosition() {
  if (!petWindow || !petChatWindow || !petChatWindow.isVisible()) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();
  const [chatWidth] = petChatWindow.getSize();

  const chatX = petX + (petWidth - chatWidth) / 2;
  const chatY = petY - 200 - 10;

  petChatWindow.setPosition(Math.max(0, Math.round(chatX)), Math.max(0, Math.round(chatY)));
}

function updateAssistantPosition() {
  if (!petWindow || !assistantWindow || !assistantWindow.isVisible()) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();
  const [assistantWidth, assistantHeight] = assistantWindow.getSize();
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  // Center assistant above pet, with 15px gap
  let assistantX = petX + (petWidth - assistantWidth) / 2;
  const assistantY = petY - assistantHeight - 15;

  // Keep within screen bounds
  assistantX = Math.max(0, Math.min(assistantX, screenWidth - assistantWidth));

  assistantWindow.setPosition(Math.round(assistantX), Math.max(0, Math.round(assistantY)));
}

function createAssistantWindow() {
  if (assistantWindow) {
    assistantWindow.show();
    assistantWindow.focus();
    updateAssistantPosition();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Position above pet if pet window exists, otherwise bottom-right
  let initialX = screenWidth - 420;
  let initialY = screenHeight - 520;

  if (petWindow) {
    const [petX, petY] = petWindow.getPosition();
    const [petWidth] = petWindow.getSize();
    const assistantWidth = 400;
    const assistantHeight = 500;

    initialX = petX + (petWidth - assistantWidth) / 2;
    initialY = petY - assistantHeight - 15;

    // Keep within screen bounds
    initialX = Math.max(0, Math.min(initialX, screenWidth - assistantWidth));
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

  if (isDev) {
    assistantWindow.loadURL(`http://localhost:${DEV_PORT}/assistant.html`);
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

  // Make transparent areas click-through
  chatbarWindow.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    chatbarWindow.loadURL(`http://localhost:${DEV_PORT}/chatbar.html`);
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

function createScreenshotQuestionWindow() {
  console.log('[ScreenshotQuestion] Creating window...');
  if (screenshotQuestionWindow) {
    console.log('[ScreenshotQuestion] Window exists, showing and refocusing');
    screenshotQuestionWindow.show();
    screenshotQuestionWindow.focus();
    // Trigger a fresh screenshot capture
    screenshotQuestionWindow.webContents.send('retake-screenshot');
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  const windowWidth = 520;
  const windowHeight = 280;

  // Position near cursor, but keep within screen bounds
  let x = Math.round(cursor.x - windowWidth / 2);
  let y = Math.round(cursor.y - windowHeight - 20);

  // Clamp to screen bounds
  x = Math.max(display.workArea.x, Math.min(x, display.workArea.x + screenWidth - windowWidth));
  y = Math.max(display.workArea.y, Math.min(y, display.workArea.y + screenHeight - windowHeight));

  screenshotQuestionWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
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

  // Hide on blur (click outside)
  screenshotQuestionWindow.on('blur', () => {
    screenshotQuestionWindow?.hide();
  });

  screenshotQuestionWindow.on('closed', () => {
    screenshotQuestionWindow = null;
  });
}

function toggleScreenshotQuestionWindow() {
  if (screenshotQuestionWindow && screenshotQuestionWindow.isVisible()) {
    screenshotQuestionWindow.hide();
  } else {
    createScreenshotQuestionWindow();
  }
}

function createOnboardingWindow(): Promise<void> {
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
      resizable: false,
      show: false,
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const loadUrl = isDev
      ? `http://localhost:${DEV_PORT}/onboarding.html`
      : path.join(__dirname, '../renderer/onboarding.html');
    console.log('[Onboarding] Loading URL:', loadUrl);

    if (isDev) {
      onboardingWindow.loadURL(`http://localhost:${DEV_PORT}/onboarding.html`);
      // Open DevTools in dev mode for debugging
      onboardingWindow.webContents.openDevTools({ mode: 'detach' });
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

function closeOnboardingAndStartApp() {
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  startMainApp();
}

function startMainApp() {
  // Register global hotkeys
  registerHotkeys();

  createPetWindow();

  // Initialize ClawBot client
  const clawbotUrl = store.get('clawbot.url') as string;
  const clawbotToken = store.get('clawbot.token') as string;
  const workspaceType = store.get('onboarding.workspaceType') as string | null;
  // Only use 'clawster' agent-id if user chose to create a Clawster workspace
  const agentId = workspaceType === 'clawster' ? 'clawster' : null;
  clawbot = new ClawBotClient(clawbotUrl, clawbotToken, agentId);

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

  // Start attention seeker behavior
  startAttentionSeeker();

  // Start idle behavior system (makes pet feel alive)
  startIdleBehaviors();

  // Start sleep check (pet falls asleep after 1 minute of no interaction)
  startSleepCheck();

  // Listen for ClawBot responses
  clawbot.on('suggestion', (data) => {
    petWindow?.webContents.send('clawbot-suggestion', data);
    assistantWindow?.webContents.send('clawbot-suggestion', data);
  });

  clawbot.on('mood', (data) => {
    petWindow?.webContents.send('clawbot-mood', data);
  });
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

  // Control mouse events for chatbar (for click-through on transparent areas)
  ipcMain.on('chatbar-set-ignore-mouse', (_event, ignore: boolean) => {
    if (chatbarWindow) {
      chatbarWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // Toggle screenshot question window
  ipcMain.on('toggle-screenshot-question', () => {
    toggleScreenshotQuestionWindow();
  });

  // Close screenshot question window
  ipcMain.on('close-screenshot-question', () => {
    screenshotQuestionWindow?.hide();
  });

  // Ask about screen (screenshot + question)
  ipcMain.handle('ask-about-screen', async (_event, question: string, imageDataUrl: string) => {
    console.log('[ScreenshotQuestion] ask-about-screen called');
    console.log('[ScreenshotQuestion] Question:', question);
    console.log('[ScreenshotQuestion] Image size:', imageDataUrl?.length || 0, 'chars');

    if (!clawbot) {
      console.log('[ScreenshotQuestion] ClawBot not connected!');
      return { error: 'ClawBot not connected' };
    }

    try {
      console.log('[ScreenshotQuestion] Calling analyzeScreen...');
      const response = await clawbot.analyzeScreen(imageDataUrl, question);
      console.log('[ScreenshotQuestion] Response:', response);
      return response;
    } catch (error) {
      console.error('Failed to analyze screen:', error);
      return { error: 'Failed to analyze screenshot' };
    }
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

  // Get chat history
  ipcMain.handle('get-chat-history', () => {
    return store.get('chatHistory') || [];
  });

  // Save chat history
  ipcMain.handle('save-chat-history', (_event, messages: unknown[]) => {
    // Keep only last 100 messages to prevent storage bloat
    const trimmed = messages.slice(-100);
    store.set('chatHistory', trimmed);
    return true;
  });

  // Clear chat history
  ipcMain.handle('clear-chat-history', () => {
    store.set('chatHistory', []);
    return true;
  });

  // Screen capture
  ipcMain.handle('capture-screen', async () => {
    return await captureScreen();
  });

  // Send message to ClawBot (with optional screen context)
  ipcMain.handle('send-to-clawbot', async (_event, message: string, includeScreen?: boolean) => {
    if (!clawbot) return { error: 'ClawBot not connected' };

    resetInteractionTimer(); // User is chatting

    // Get chat history for context (filter to user/assistant only)
    const chatHistory = (store.get('chatHistory') || []) as Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>;
    const history = chatHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));

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

    const response = await clawbot.chat(fullMessage, history);

    // Handle any actions in the response
    if (response.action?.payload) {
      await executePetAction(response.action.payload as PetAction);
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
      // Also move the chat windows if visible
      updatePetChatPosition();
      updateAssistantPosition();
      resetInteractionTimer(); // User is interacting
    }
  });

  // Show pet chat popup
  ipcMain.on('show-pet-chat', (_event, message: { id: string; text: string; quickReplies?: string[] }) => {
    showPetChat(message);
  });

  // Hide pet chat popup
  ipcMain.on('hide-pet-chat', () => {
    hidePetChat();
  });

  // Forward pet chat reply to pet window
  ipcMain.on('pet-chat-reply', (_event, reply: string) => {
    petWindow?.webContents.send('pet-chat-reply', reply);
  });

// Pet movement (legacy API)
  ipcMain.handle('pet-move-to', (_event, x: number, y: number, duration?: number) => {
    animateMoveTo(x, y, duration ?? 1000);
  });

  ipcMain.handle('get-cursor-position', () => {
    return screen.getCursorScreenPoint();
  });

  ipcMain.handle('get-pet-position', () => {
    return petWindow?.getPosition() ?? [0, 0];
  });

  // Pet was clicked
  ipcMain.on('pet-clicked', () => {
    resetInteractionTimer();
  });

  // Chat sync - broadcast to all windows when chat history changes
  ipcMain.on('chat-sync', () => {
    // Notify assistant window to refresh its chat history
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.webContents.send('chat-sync');
    }
    // Notify chatbar window as well (in case it's open)
    if (chatbarWindow && !chatbarWindow.isDestroyed()) {
      chatbarWindow.webContents.send('chat-sync');
    }
  });

  // Onboarding handlers
  ipcMain.handle('onboarding-skip', () => {
    store.set('onboarding.skipped', true);
    closeOnboardingAndStartApp();
    return true;
  });

  ipcMain.handle('onboarding-complete', (_event, data: {
    workspaceType: 'openclaw' | 'clawster';
    migrateMemory: boolean;
    gatewayUrl: string;
    gatewayToken: string;
    identity: string;
    soul: string;
    watchFolders: string[];
    watchActiveApp: boolean;
    watchWindowTitles: boolean;
    hotkeyOpenChat: string;
    hotkeyCaptureScreen: string;
    hotkeyOpenAssistant: string;
  }) => {
    // Save onboarding data to store
    store.set('onboarding.completed', true);
    store.set('onboarding.workspaceType', data.workspaceType);
    store.set('clawbot.url', data.gatewayUrl);
    store.set('clawbot.token', data.gatewayToken);
    store.set('watch.folders', data.watchFolders);
    store.set('watch.activeApp', data.watchActiveApp);
    store.set('watch.sendWindowTitles', data.watchWindowTitles);
    store.set('hotkeys.openChat', data.hotkeyOpenChat);
    store.set('hotkeys.captureScreen', data.hotkeyCaptureScreen);
    store.set('hotkeys.openAssistant', data.hotkeyOpenAssistant);

    // Update ClawBotClient with new config and agentId
    const newAgentId = data.workspaceType === 'clawster' ? 'clawster' : null;
    clawbot?.updateConfig(data.gatewayUrl, data.gatewayToken, newAgentId);

    closeOnboardingAndStartApp();
    return true;
  });

  // Read OpenClaw config file
  ipcMain.handle('read-openclaw-config', () => {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to read OpenClaw config:', error);
    }
    return null;
  });

  // Read OpenClaw workspace files
  ipcMain.handle('read-openclaw-workspace', () => {
    const workspacePath = path.join(os.homedir(), '.openclaw', 'workspace');
    const result: {
      exists: boolean;
      identity: string | null;
      soul: string | null;
      hasMemory: boolean;
    } = {
      exists: false,
      identity: null,
      soul: null,
      hasMemory: false,
    };

    try {
      if (fs.existsSync(workspacePath)) {
        result.exists = true;

        const identityPath = path.join(workspacePath, 'IDENTITY.md');
        if (fs.existsSync(identityPath)) {
          result.identity = fs.readFileSync(identityPath, 'utf-8');
        }

        const soulPath = path.join(workspacePath, 'SOUL.md');
        if (fs.existsSync(soulPath)) {
          result.soul = fs.readFileSync(soulPath, 'utf-8');
        }

        const memoryPath = path.join(workspacePath, 'memory.md');
        result.hasMemory = fs.existsSync(memoryPath);
      }
    } catch (error) {
      console.error('Failed to read OpenClaw workspace:', error);
    }

    return result;
  });

  // Create Clawster workspace
  ipcMain.handle('create-clawster-workspace', (_event, options: {
    identity: string;
    soul: string;
    migrateMemory: boolean;
  }) => {
    const clawsterWorkspace = path.join(os.homedir(), '.openclaw', 'workspace-clawster');

    try {
      // Create directory
      fs.mkdirSync(clawsterWorkspace, { recursive: true });

      // Write identity and soul files
      fs.writeFileSync(path.join(clawsterWorkspace, 'IDENTITY.md'), options.identity);
      fs.writeFileSync(path.join(clawsterWorkspace, 'SOUL.md'), options.soul);

      // Handle memory migration
      const destMemory = path.join(clawsterWorkspace, 'memory.md');
      if (options.migrateMemory) {
        const sourceMemory = path.join(os.homedir(), '.openclaw', 'workspace', 'memory.md');
        if (fs.existsSync(sourceMemory)) {
          fs.copyFileSync(sourceMemory, destMemory);
          store.set('onboarding.memoryMigrated', true);
        }
      } else {
        // Starting fresh - delete existing memory if present
        if (fs.existsSync(destMemory)) {
          fs.unlinkSync(destMemory);
        }
      }

      store.set('onboarding.clawsterWorkspacePath', clawsterWorkspace);
      return { success: true, path: clawsterWorkspace };
    } catch (error) {
      console.error('Failed to create Clawster workspace:', error);
      return { success: false, error: String(error) };
    }
  });

  // Validate gateway connection by making a real chat completions request
  ipcMain.handle('validate-gateway', async (_event, url: string, token: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Make a minimal chat completions request to validate the connection and token
      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'openclaw',
          messages: [
            { role: 'user', content: 'hi' }
          ],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { success: true };
      } else {
        const errorText = await response.text();
        return { success: false, error: `${response.status}: ${errorText.slice(0, 100)}` };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get default identity and soul from app resources
  ipcMain.handle('get-default-personality', () => {
    try {
      // In development, read from openclaw folder relative to project
      // In production, read from resources
      const basePath = isDev
        ? path.join(__dirname, '../../openclaw')
        : path.join(process.resourcesPath, 'openclaw');

      const identity = fs.readFileSync(path.join(basePath, 'IDENTITY.md'), 'utf-8');
      const soul = fs.readFileSync(path.join(basePath, 'SOUL.md'), 'utf-8');

      return { identity, soul };
    } catch (error) {
      console.error('Failed to read default personality:', error);
      return { identity: '', soul: '' };
    }
  });

  // Save personality files to workspace
  ipcMain.handle('save-personality', (_event, workspacePath: string, identity: string, soul: string) => {
    try {
      fs.writeFileSync(path.join(workspacePath, 'IDENTITY.md'), identity);
      fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), soul);
      return { success: true };
    } catch (error) {
      console.error('Failed to save personality:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get onboarding status
  ipcMain.handle('get-onboarding-status', () => {
    return {
      completed: store.get('onboarding.completed') as boolean,
      skipped: store.get('onboarding.skipped') as boolean,
    };
  });
}

// Register global hotkeys from store
function registerHotkeys() {
  // Unregister all first (in case we're re-registering)
  globalShortcut.unregisterAll();

  const hotkeyOpenAssistant = store.get('hotkeys.openAssistant') as string || 'CommandOrControl+Shift+A';
  const hotkeyOpenChat = store.get('hotkeys.openChat') as string || 'CommandOrControl+Shift+Space';
  const hotkeyCaptureScreen = store.get('hotkeys.captureScreen') as string || 'CommandOrControl+Shift+/';

  globalShortcut.register(hotkeyOpenAssistant, () => {
    toggleAssistantWindow();
  });
  console.log(`[Hotkeys] Registered open assistant: ${hotkeyOpenAssistant}`);

  globalShortcut.register(hotkeyOpenChat, () => {
    toggleChatbarWindow();
  });
  console.log(`[Hotkeys] Registered open chat: ${hotkeyOpenChat}`);

  globalShortcut.register(hotkeyCaptureScreen, () => {
    console.log('[ScreenshotQuestion] Hotkey triggered');
    toggleScreenshotQuestionWindow();
  });
  console.log(`[Hotkeys] Registered capture screen: ${hotkeyCaptureScreen}`);
}

// App lifecycle
app.whenReady().then(async () => {
  setupIPC();

  // Check onboarding status
  const onboardingCompleted = store.get('onboarding.completed') as boolean;
  const onboardingSkipped = store.get('onboarding.skipped') as boolean;

  console.log('[Onboarding] Status check:', { onboardingCompleted, onboardingSkipped });

  if (!onboardingCompleted && !onboardingSkipped) {
    // Show onboarding wizard
    console.log('[Onboarding] Showing onboarding window...');
    await createOnboardingWindow();
    console.log('[Onboarding] Window created');
  } else {
    // Start main app directly
    console.log('[Onboarding] Skipping onboarding, starting main app');
    startMainApp();
  }

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
  stopIdleBehaviors();
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }
  stopAttentionSeeker();
  if (moveAnimation) {
    clearInterval(moveAnimation);
  }
});
