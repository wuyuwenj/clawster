import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  shell,
  screen,
  nativeImage,
  dialog,
  Tray,
  Menu,
  systemPreferences,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { autoUpdater } from 'electron-updater';
import { Watchers } from './watchers';
import { ClawBotClient } from './clawbot-client';
import { createStore } from './store';
import { TutorialManager } from './tutorial';

// Load environment variables
config();

// Fix transparent window rendering on some Mac hardware (e.g. Mac Mini)
// Electron has a bug where transparent windows < 162px become opaque on external/4K displays
// See: https://github.com/electron/electron/issues/44884
app.disableHardwareAcceleration();

// Windows
let petWindow: BrowserWindow | null = null;
let petChatWindow: BrowserWindow | null = null;
let assistantWindow: BrowserWindow | null = null;
let chatbarWindow: BrowserWindow | null = null;
let screenshotQuestionWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Services
let watchers: Watchers | null = null;
let clawbot: ClawBotClient | null = null;
const store = createStore();
const tutorialManager = new TutorialManager(store);

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

// Pet window size constants
// Minimum 162px to avoid Electron transparency bug on external/4K displays
const PET_WINDOW_WIDTH = 164;
const PET_WINDOW_HEIGHT = 164;
const PET_WINDOW_TUTORIAL_WIDTH = 320;
const PET_WINDOW_TUTORIAL_HEIGHT = 350;

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
        store.set('pet.position', { x: targetX, y: targetY });
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

// Get screen recording permission status on macOS
// Returns: 'granted', 'denied', 'not-determined', 'restricted', or 'granted' for non-macOS
function getScreenCapturePermissionStatus(): string {
  if (process.platform !== 'darwin') {
    return 'granted'; // Non-macOS platforms don't need this check
  }
  return systemPreferences.getMediaAccessStatus('screen');
}

// Native macOS screen capture using screencapture command (much faster than desktopCapturer)
async function captureScreenNative(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    // Fall back to desktopCapturer on non-macOS platforms
    return captureScreenFallback();
  }

  // Check permission first
  const permissionStatus = getScreenCapturePermissionStatus();
  if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
    console.log('Screen capture permission denied. Please enable in System Preferences > Privacy & Security > Screen Recording');
    return null;
  }

  const tempPath = path.join(os.tmpdir(), `clawster-screenshot-${Date.now()}.png`);

  try {
    // Use macOS screencapture command - much faster than desktopCapturer
    // -x: no sound, -C: capture cursor, -t png: format
    execSync(`screencapture -x -C -t png "${tempPath}"`, {
      timeout: 5000,
      windowsHide: true,
    });

    // Read the captured image
    const imageBuffer = fs.readFileSync(tempPath);
    const base64 = imageBuffer.toString('base64');

    // Clean up temp file
    fs.unlinkSync(tempPath);

    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Native screen capture failed:', error);
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    // Fall back to desktopCapturer
    return captureScreenFallback();
  }
}

// Fallback capture using desktopCapturer (slower, used on non-macOS)
async function captureScreenFallback(): Promise<string | null> {
  try {
    const permissionStatus = getScreenCapturePermissionStatus();

    // If explicitly denied or restricted, don't prompt again
    if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
      console.log('Screen capture permission denied. Please enable in System Preferences > Privacy & Security > Screen Recording');
      return null;
    }

    // If 'not-determined' or 'granted', proceed (this will trigger prompt if not-determined)
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
    console.error('Fallback screen capture failed:', error);
    return null;
  }
}

// Capture screen with cursor position overlay info
async function captureScreenWithContext(): Promise<{
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
} | null> {
  try {
    // Use native capture for speed
    const image = await captureScreenNative();

    if (image) {
      const cursor = screen.getCursorScreenPoint();
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      return {
        image,
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

  // Don't show chat popups during tutorial
  if (tutorialManager?.getStatus().isActive) return;

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

// Expand pet window for tutorial (to show speech bubble)
function expandPetWindowForTutorial(): void {
  if (!petWindow) return;

  const [currentX, currentY] = petWindow.getPosition();
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Calculate new position to keep pet at same visual location
  // The pet will be at the bottom of the expanded window
  const newY = currentY - (PET_WINDOW_TUTORIAL_HEIGHT - PET_WINDOW_HEIGHT);
  const newX = currentX - (PET_WINDOW_TUTORIAL_WIDTH - PET_WINDOW_WIDTH) / 2;

  // Ensure window stays on screen
  const safeY = Math.max(0, newY);
  const safeX = Math.max(0, newX);

  petWindow.setSize(PET_WINDOW_TUTORIAL_WIDTH, PET_WINDOW_TUTORIAL_HEIGHT);
  petWindow.setPosition(Math.round(safeX), Math.round(safeY));
  petWindow.webContents.send('tutorial-window-expanded', true);
  console.log('[Tutorial] Pet window expanded for tutorial');
}

// Contract pet window back to normal size
function contractPetWindow(): void {
  if (!petWindow) return;

  const [currentX, currentY] = petWindow.getPosition();

  // Calculate new position to keep pet at same visual location
  const newY = currentY + (PET_WINDOW_TUTORIAL_HEIGHT - PET_WINDOW_HEIGHT);
  const newX = currentX + (PET_WINDOW_TUTORIAL_WIDTH - PET_WINDOW_WIDTH) / 2;

  petWindow.setSize(PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT);
  petWindow.setPosition(Math.round(newX), Math.round(newY));
  petWindow.webContents.send('tutorial-window-expanded', false);
  console.log('[Tutorial] Pet window contracted to normal');
}

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Small window just for the lobster
  const petWindowWidth = PET_WINDOW_WIDTH;
  const petWindowHeight = PET_WINDOW_HEIGHT;

  // Use saved position or default to bottom-right
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

  // Don't show chat popups during tutorial
  if (tutorialManager?.getStatus().isActive) return;

  const [petX, petY] = petWindow.getPosition();
  const [petWidth] = petWindow.getSize();

  const chatWidth = 320;
  const chatHeight = 300;
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
      backgroundColor: '#00000000',
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

  const [cw, ch] = petChatWindow.getSize();
  const chatX = petX + (petWidth - cw) / 2;
  const chatY = petY - ch - 10;

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

  // Set up tutorial manager with pet window
  if (petWindow) {
    tutorialManager.setPetWindow(petWindow);
    tutorialManager.setAnimateMoveTo(animateMoveTo);
    tutorialManager.setWindowResizeFunctions(expandPetWindowForTutorial, contractPetWindow);

    // Start or resume tutorial after pet window content is loaded
    petWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (tutorialManager.shouldShowResumePrompt()) {
          hidePetChat(); // Hide any existing chat popup during tutorial
          expandPetWindowForTutorial();
          petWindow?.webContents.send('tutorial-resume-prompt');
        } else if (tutorialManager.shouldStartTutorial()) {
          hidePetChat(); // Hide any existing chat popup during tutorial
          tutorialManager.start();
        }
      }, 500); // Small delay to let pet window settle
    });
  }

  // Initialize ClawBot client
  const clawbotUrl = store.get('clawbot.url') as string;
  const clawbotToken = store.get('clawbot.token') as string;
  const workspaceType = store.get('onboarding.workspaceType') as string | null;
  // Only use 'clawster' agent-id if user chose to create a Clawster workspace
  const agentId = workspaceType === 'clawster' ? 'clawster' : null;
  clawbot = new ClawBotClient(clawbotUrl, clawbotToken, agentId);

  // Forward connection status changes to all renderer windows
  clawbot.on('connection-changed', (status: { connected: boolean; error: string | null; gatewayUrl: string }) => {
    petWindow?.webContents.send('clawbot-connection-changed', status);
    assistantWindow?.webContents.send('clawbot-connection-changed', status);
    petChatWindow?.webContents.send('clawbot-connection-changed', status);
    chatbarWindow?.webContents.send('clawbot-connection-changed', status);
  });

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

  // Listen for cron job results - send to ClawBot for processing
  clawbot.on('cronResult', async (data) => {
    console.log('[Main] Cron result received:', data.jobName, '- sending to ClawBot for processing');

    if (!clawbot) return;

    // Send the cron instruction to ClawBot and get its response
    const response = await clawbot.chat(`[Scheduled reminder: ${data.jobName}] ${data.summary}`);

    if (response.text) {
      const processedData = {
        ...data,
        summary: response.text, // Replace instruction with AI response
      };

      // Send to assistant window and chatbar for chat history
      assistantWindow?.webContents.send('cron-result', processedData);
      chatbarWindow?.webContents.send('cron-result', processedData);

      // Show pet chat popup directly (don't rely on petWindow forwarding)
      if (!tutorialManager?.getStatus().isActive) {
        showPetChat({
          id: randomUUID(),
          text: response.text,
          quickReplies: ['Thanks!', 'Snooze', 'Dismiss'],
        });
        petWindow?.webContents.send('clawbot-mood', { state: 'excited', reason: 'cron reminder' });
      }

      // Handle any actions from the response
      if (response.action) {
        executePetAction(response.action.payload as PetAction);
      }
    }
  });

  clawbot.on('cronError', (data) => {
    console.log('[Main] Cron error received:', data.jobName, data.error);
    petWindow?.webContents.send('cron-error', data);
    assistantWindow?.webContents.send('cron-error', data);
  });
}

// Screen capture - uses native capture for speed
async function captureScreen(): Promise<string | null> {
  return captureScreenNative();
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

    // Re-register hotkeys if hotkey settings changed
    if (key.startsWith('hotkeys.')) {
      registerHotkeys();
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

  // Check screen capture permission status
  // Returns: 'granted', 'denied', 'not-determined', or 'restricted'
  ipcMain.handle('get-screen-capture-permission', () => {
    return getScreenCapturePermissionStatus();
  });

  // Check accessibility permission (for active-win app watching)
  // Returns true if granted, false otherwise
  // If prompt is true, will show macOS permission dialog
  ipcMain.handle('check-accessibility-permission', (_event, prompt: boolean = false) => {
    if (process.platform !== 'darwin') {
      return true; // Non-macOS platforms don't need this
    }
    const result = systemPreferences.isTrustedAccessibilityClient(prompt);
    console.log(`[Accessibility] isTrustedAccessibilityClient(${prompt}) = ${result}`);
    return result;
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

    // Also show response as speech bubble on pet (but not if assistant window is active or during tutorial)
    const assistantActive = assistantWindow && assistantWindow.isVisible();
    if (response.text && !response.text.includes('error') && petWindow && !assistantActive && !tutorialManager?.getStatus().isActive) {
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

  // Get ClawBot status (returns detailed status)
  ipcMain.handle('clawbot-status', () => {
    if (clawbot) {
      return clawbot.getConnectionStatus();
    }
    return { connected: false, error: 'ClawBot not initialized', gatewayUrl: '' };
  });

  // Copy text to clipboard
  ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
  });

  // Drag pet window
  ipcMain.on('pet-drag', (_event, deltaX: number, deltaY: number) => {
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      const newX = x + deltaX;
      const newY = y + deltaY;
      petWindow.setPosition(newX, newY);
      store.set('pet.position', { x: newX, y: newY });
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

  // Reset onboarding (for testing)
  ipcMain.handle('reset-onboarding', () => {
    store.set('onboarding.completed', false);
    store.set('onboarding.skipped', false);
    // Also reset tutorial so it starts fresh after onboarding
    store.set('tutorial.completedAt', null);
    store.set('tutorial.lastStep', 0);
    store.set('tutorial.wasInterrupted', false);
    app.relaunch();
    app.exit(0);
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

    // Reset tutorial state so it starts fresh after onboarding
    store.set('tutorial.completedAt', null);
    store.set('tutorial.lastStep', 0);
    store.set('tutorial.wasInterrupted', false);
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

  // Tutorial handlers
  ipcMain.on('tutorial-pet-clicked', () => {
    tutorialManager.handlePetClicked();
  });

  ipcMain.on('tutorial-next', () => {
    tutorialManager.handleNextClicked();
  });

  ipcMain.on('tutorial-skip', () => {
    tutorialManager.skip();
  });

  ipcMain.on('tutorial-resume', () => {
    hidePetChat(); // Hide any existing chat popup during tutorial
    tutorialManager.resume();
  });

  ipcMain.on('tutorial-start-over', () => {
    hidePetChat(); // Hide any existing chat popup during tutorial
    tutorialManager.startOver();
  });

  ipcMain.on('tutorial-open-panel', () => {
    tutorialManager.handleOpenPanelClicked();
  });

  ipcMain.handle('replay-tutorial', () => {
    hidePetChat(); // Hide any existing chat popup during tutorial
    tutorialManager.replay();
    return true;
  });

  ipcMain.handle('get-tutorial-status', () => {
    return tutorialManager.getStatus();
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
    // Notify tutorial if active
    tutorialManager.handleHotkeyPressed('openAssistant');
    toggleAssistantWindow();
  });
  console.log(`[Hotkeys] Registered open assistant: ${hotkeyOpenAssistant}`);

  globalShortcut.register(hotkeyOpenChat, () => {
    // Notify tutorial if active
    tutorialManager.handleHotkeyPressed('openChat');
    toggleChatbarWindow();
  });
  console.log(`[Hotkeys] Registered open chat: ${hotkeyOpenChat}`);

  globalShortcut.register(hotkeyCaptureScreen, () => {
    console.log('[ScreenshotQuestion] Hotkey triggered');
    toggleScreenshotQuestionWindow();
  });
  console.log(`[Hotkeys] Registered capture screen: ${hotkeyCaptureScreen}`);
}

// Auto-updater setup
function setupAutoUpdater() {
  if (isDev) {
    console.log('[AutoUpdater] Skipping in dev mode');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No updates available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Clawster ${info.version} is ready to install.`,
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later'],
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error);
  });

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify();
}

// Setup system tray
function setupTray() {
  // Create tray icon - use dedicated tray icon (black silhouette for template)
  const iconPath = isDev
    ? path.join(__dirname, '../../assets/tray-icon.png')
    : path.join(process.resourcesPath, 'assets/tray-icon.png');

  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      // Template images adapt to light/dark menu bar automatically
      trayIcon.setTemplateImage(true);
    }
  } catch {
    // Fallback: create a simple colored icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Clawster');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Clawster',
      click: () => {
        petWindow?.show();
        petWindow?.focus();
      },
    },
    {
      label: 'Open Assistant',
      click: () => {
        if (assistantWindow) {
          assistantWindow.show();
          assistantWindow.focus();
        } else {
          createAssistantWindow();
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (assistantWindow) {
          assistantWindow.show();
          assistantWindow.focus();
          assistantWindow.webContents.send('switch-to-settings');
        } else {
          createAssistantWindow();
          // Wait for window to load then switch to settings
          setTimeout(() => {
            assistantWindow?.webContents.send('switch-to-settings');
          }, 500);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Restart Tutorial',
      click: () => {
        tutorialManager.startOver();
      },
    },
    {
      label: 'Reset Onboarding',
      click: () => {
        store.set('onboarding.completed', false);
        store.set('onboarding.skipped', false);
        dialog.showMessageBox({
          type: 'info',
          title: 'Onboarding Reset',
          message: 'Onboarding has been reset. Restart Clawster to see the onboarding wizard.',
          buttons: ['OK'],
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Clawster',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // On macOS, clicking the tray icon shows the menu
  // On Windows/Linux, left-click can show the pet
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      petWindow?.show();
      petWindow?.focus();
    });
  }
}

// App lifecycle
app.whenReady().then(async () => {
  setupIPC();
  setupAutoUpdater();
  setupTray();

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
  tutorialManager.destroy();
});
