import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  nativeImage,
  dialog,
  Tray,
  Menu,
  systemPreferences,
} from 'electron';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { autoUpdater } from 'electron-updater';
import { Watchers } from './watchers';
import { LocalToolProvider, ChatRouter, setNotifyCallback, setConfirmCallback, setMemoryDB, setMutedProvider, createProxyVision } from './chat';
import { buildAuthHeaders } from './chat/hmac-auth';
import {
  migrateFlatHistory, resolveActiveId, newSession, withMessages, capSessions, toMeta,
  type ChatMessage, type ChatSession,
} from './chat/sessions';
import { MemoryManager } from './chat/memory';
import { runConsolidation } from './chat/memory/consolidation';
import { requestPermission, setPermissionStore, getAllPermissionStatuses, openPermissionSettings, startPolling, stopPolling, checkPermission, needsRestart } from './permission-helper';
import type { PermissionType } from './permission-helper';
import { initAnalytics, shutdownAnalytics, trackPetInteraction } from './analytics';
import { EmotionEngine } from './emotion-engine';
import { createStore } from './store';
import { clawsterDataDir } from './paths';
import {
  applyPreset,
  ensureActivePersonality,
  getActivePersonality,
  activePersonalityDir,
  isPresetId,
  PRESETS,
  DEFAULT_PRESET,
  type PresetId,
} from './personality';
import { TutorialManager } from './tutorial';
import { getFrontmostWindowTitleFromSystemEvents } from './window-title';
import { logEvent } from './event-logger';

// Extracted modules
import {
  ensureSpeechHelper,
  resetSpeechHelperState,
  getSpeechHelperPath,
  getSpeechProcess,
  isSpeechSessionActive,
  isSpeechStartPending,
  setSpeechSender,
  setSpeechSessionActive,
  setSpeechStartPending,
  nextSpeechStartSequence,
  getSpeechStartSequence,
  setSpeechProcessExitExpected,
} from './speech';
import {
  initPetBehaviors,
  animateMoveTo,
  startAttentionSeeker,
  stopAttentionSeeker,
  startIdleBehaviors,
  stopIdleBehaviors,
  startSleepCheck,
  stopSleepCheck,
  resetInteractionTimer,
  executePetAction,
  getIsSleeping,
  forceSleep,
  clearMoveAnimation,
  PetAction,
} from './pet-behaviors';
import {
  initScreenCapture,
  getScreenCapturePermissionStatus,
  getScreenContext,
  playPetCameraSnapAnimationBeforeCapture,
  captureScreen,
  captureScreenWithContext,
} from './screen-capture';
import {
  initWindows,
  getPetWindow,
  getPetChatWindow,
  getAssistantWindow,
  getChatbarWindow,
  getScreenshotQuestionWindow,
  getPetContextMenuWindow,
  createPetWindow,
  createAssistantWindow,
  revealAssistantWindow,
  toggleAssistantWindow,
  openAssistantOnTab,
  updateAssistantPosition,
  createChatbarWindow,
  toggleChatbarWindow,
  createScreenshotQuestionWindow,
  toggleScreenshotQuestionWindow,
  createOnboardingWindow,
  closeOnboardingAndStartApp,
  showPetChat,
  hidePetChat,
  resizePetChatToContent,
  updatePetChatPosition,
  schedulePetChatAutoHide,
  expandPetWindowForTutorial,
  contractPetWindow,
  showPetContextMenuAtCursor,
  applyDebugWindowBordersToAllWindows,
} from './windows';

const execFileAsync = promisify(execFile);

// Load environment variables
config();

// Fix transparent window rendering on some Mac hardware (e.g. Mac Mini)
app.disableHardwareAcceleration();

// Services
let watchers: Watchers | null = null;
let chatProvider: ChatRouter | null = null;
const store = createStore();
setPermissionStore(store);
const tutorialManager = new TutorialManager(store);

const isDev = process.env.CLAWSTER_DEV === 'true' || (!app.isPackaged && process.env.CLAWSTER_DEV !== 'false');
const DEV_PORT = process.env.VITE_DEV_PORT || '5173';

// Constants used only in main.ts
const PET_CAMERA_SNAP_CAPTURE_DELAY_MS = 560;
const PET_CAMERA_SNAP_DURATION_MS = 920;
const PET_CAMERA_SNAP_FLASH_DURATION_MS = 120;
const DEV_FORCE_ACTIVE_APP_COMMENT_DELAY_MS = 5000;
const APP_SWITCH_CHAT_COOLDOWN = 60 * 1000;

// Idle detection state
let lastActivityTime = Date.now();
let idleCheckInterval: NodeJS.Timeout | null = null;
let lastAppSwitchChat = 0;
let lastDeniedPermission: string | null = null;
let lastBrowserContext: { domain: string; title: string; url: string } | null = null;
let lastChatContext: { userInput: string; toolCall: unknown; modelOutput: string } | null = null;
const IDLE_THRESHOLD = 5 * 60 * 1000;

// Tray
let tray: Tray | null = null;

// Initialize extracted modules with their dependencies
function initModules() {
  initWindows({
    store,
    isDev,
    devPort: DEV_PORT,
    tutorialManager,
    startMainApp,
  });

  initPetBehaviors({
    getPetWindow,
    store,
    isDev,
    updatePetChatPosition,
    updateAssistantPosition,
  });

  initScreenCapture({
    getPetWindow,
    getIsSleeping,
    cameraSnapCaptureDelayMs: PET_CAMERA_SNAP_CAPTURE_DELAY_MS,
    cameraSnapDurationMs: PET_CAMERA_SNAP_DURATION_MS,
    cameraSnapFlashDurationMs: PET_CAMERA_SNAP_FLASH_DURATION_MS,
  });
}

function setLaunchOnStartup(enabled: boolean) {
  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
      return;
    }

    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
      return;
    }

    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    console.error('Failed to update launch-on-startup setting:', error);
  }
}

function resetOnboardingState(): void {
  store.set('onboarding.completed', false);
  store.set('onboarding.skipped', false);
}

// Send chat popup to pet window
async function sendChatPopup(
  trigger: 'app_switch' | 'idle' | 'proactive',
  context?: string,
  windowTitle?: string,
  browserUrl?: string,
) {
  const petWindow = getPetWindow();
  if (!petWindow || !chatProvider?.isAvailable()) return;

  // Don't show chat popups during tutorial
  if (tutorialManager?.getStatus().isActive) return;

  try {
      let prompt: string;
      switch (trigger) {
      case 'app_switch':
        if (!context?.trim()) {
          return;
        }
        prompt = `User is using app name: "${context}". Window title: "${windowTitle?.trim() || '[unavailable]'}"${browserUrl ? `. URL: ${browserUrl}` : ''}. Based on what you know about the user, say something funny that's relevant to the app and/or window title.`;
        break;
      case 'idle':
        prompt = 'The user has been idle for a while. Give a brief, friendly message to check in or suggest a break (1-2 sentences max). Be warm and not pushy.';
        break;
      case 'proactive':
        prompt = context || 'Share a brief, helpful tip with the user.';
        break;
    }

    console.log('[ChatPopup] sendChatPopup', { trigger, context, windowTitle, prompt });

    const popupResponses: Record<string, string[]> = {
      idle: [
        "Hey, you still there? *pokes with claw*",
        "Taking a break? Good idea! *yawns*",
        "*peeks* Everything okay over there?",
        "I'm getting lonely over here! *snip snip*",
      ],
      app_switch: [
        "Ooh, switching things up!",
        "Nice app choice! *curious snip*",
        "What are we doing now? *peeks*",
      ],
      proactive: [
        "Just checking in! Need anything?",
        "*waves* Hi! I'm here if you need me.",
      ],
    };

    const responses = popupResponses[trigger] || popupResponses.proactive;
    const response = { text: responses[Math.floor(Math.random() * responses.length)] };

    if (response.text) {
      resetInteractionTimer();
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

let idleNotified = false;

function startIdleDetection() {
  idleCheckInterval = setInterval(() => {
    const idleTime = Date.now() - lastActivityTime;

    if (idleTime > IDLE_THRESHOLD && !idleNotified) {
      idleNotified = true;
      sendChatPopup('idle');
    }
  }, 30000);
}

function resetIdleTimer() {
  lastActivityTime = Date.now();
  idleNotified = false;
}

function startMainApp() {
  logEvent('app_launched', { version: app.getVersion() });

  // Re-verify all permissions on launch (handles OS updates, Sequoia monthly re-confirm)
  const launchStatuses = getAllPermissionStatuses();
  console.log('[Permissions] Launch check:', launchStatuses);
  if (launchStatuses['accessibility'] !== 'granted') {
    store.set('watch.activeApp', false);
    store.set('watch.sendWindowTitles', false);
  }

  // Register global hotkeys
  registerHotkeys();

  createPetWindow();

  const petWindow = getPetWindow();

  // Set up tutorial manager with pet window
  if (petWindow) {
    tutorialManager.setPetWindow(petWindow);
    tutorialManager.setAnimateMoveTo(animateMoveTo);
    tutorialManager.setWindowResizeFunctions(expandPetWindowForTutorial, contractPetWindow);

    // Start or resume tutorial after pet window content is loaded
    petWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (tutorialManager.shouldShowResumePrompt()) {
          hidePetChat();
          expandPetWindowForTutorial();
          getPetWindow()?.webContents.send('tutorial-resume-prompt');
        } else if (tutorialManager.shouldStartTutorial()) {
          hidePetChat();
          tutorialManager.start();
        }
      }, 500);
    });
  }

  // Seed the active personality from the chosen preset on first run (idempotent).
  ensureActivePersonality((store.get('personality.preset') as PresetId) || DEFAULT_PRESET);

  const toolModel = new LocalToolProvider(
    isDev ? 'clawster-qwen3-8b-q4:latest' : (process.env.FIREWORKS_MODEL || 'clawster-qwen3-8b-q4:latest'),
    isDev ? 'http://127.0.0.1:11434' : (process.env.FIREWORKS_BASE_URL || 'http://127.0.0.1:11434'),
    isDev ? 'ollama' : ((process.env.FIREWORKS_BASE_URL ? 'openai' : 'ollama') as 'ollama' | 'openai'),
    isDev ? undefined : process.env.FIREWORKS_API_KEY,
  );
  chatProvider = new ChatRouter(toolModel);

  // Wire on-demand cloud vision for screen analysis (local model has no vision).
  // Dev mode: uses proxy (OpenAI via CF Worker). Production: uses Fireworks Vision.
  let deviceId = store.get('clawbot').deviceId;
  if (!deviceId) {
    deviceId = randomUUID();
    store.set('clawbot', { ...store.get('clawbot'), deviceId });
  }
  const proxyUrl = store.get('clawbot').url;
  console.log('[Vision] Using proxy vision (GPT-4o-mini)');
  chatProvider.setVisionProvider(createProxyVision(proxyUrl, deviceId));
  chatProvider.setScreenCapturer(() => captureScreen());

  // Initialize analytics
  initAnalytics({
    apiKey: process.env.POSTHOG_API_KEY || '',
    deviceId,
    analyticsEnabled: store.get('analytics').enabled,
    modelName: 'clawster-tool-v8-q4',
  });

  // Initialize memory layer (SQLite — facts + emotional memories)
  const memoryDbPath = path.join(clawsterDataDir(), 'memory', 'clawster.db');
  const memory = new MemoryManager({
    dbPath: memoryDbPath,
  });
  memory.init().then(ok => {
    if (ok) {
      chatProvider!.setMemoryManager(memory);
      setMemoryDB(memory.getDB());
      console.log(`[Memory] SQLite initialized at ${memoryDbPath}`);
      setTimeout(() => {
        runConsolidation(memory.getDB()).catch(err => {
          console.error('[Memory] Consolidation error:', err);
        });
      }, 5000);
    } else {
      console.warn('[Memory] Failed to initialize — running without memory');
    }
  }).catch(err => {
    console.error('[Memory] Init error:', err);
  });

  // Start emotion engine
  const emotionEngine = new EmotionEngine();
  emotionEngine.start((mood, _state) => {
    const petWindow = getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('clawbot-mood', { state: mood });
    }
  });

  // Wire chat router to feed mood signals to emotion engine
  chatProvider.setEmotionEngine(emotionEngine);

  setMutedProvider(() => Boolean(store.get('pet.muted')));

  setNotifyCallback((title, body) => {
    showPetChat({
      id: randomUUID(),
      text: `${title}: ${body}`,
      quickReplies: ['Thanks!', 'Not now'],
    });
  });

  // Confirmation gate for safety-critical tools (run_shell, send_message, …).
  // Shows a native modal with the exact action; nothing proceeds unless the
  // user clicks the confirm button.
  setConfirmCallback(async (req) => {
    if (process.env.NODE_ENV === 'test') {
      console.log(`[Test] Auto-approving: ${req.title} — ${req.detail}`);
      return true;
    }
    const parent = getPetWindow() || getAssistantWindow() || getChatbarWindow() || undefined;
    const opts = {
      type: 'warning' as const,
      buttons: ['Confirm', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Clawster needs your OK',
      message: req.title,
      detail: req.detail,
      noLink: true,
    };
    const { response } = parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
    return response === 0;
  });

  // Initialize watchers
  watchers = new Watchers(store, (event) => {
    // Reset idle timer on any activity
    resetIdleTimer();

    // Forward to pet window for reactions
    getPetWindow()?.webContents.send('activity-event', event);

    // Forward to assistant window
    getAssistantWindow()?.webContents.send('activity-event', event);

    // Feed app switches to emotion engine
    if (event.type === 'app_focus_changed' && event.app) {
      emotionEngine.onAppSwitch(event.app);

      if (event.url && event.domain) {
        lastBrowserContext = { domain: event.domain, title: event.title || '', url: event.url };
      } else {
        lastBrowserContext = null;
      }

      const now = Date.now();
      if (now - lastAppSwitchChat > APP_SWITCH_CHAT_COOLDOWN) {
        lastAppSwitchChat = now;
        if (Math.random() < 0.3) {
          sendChatPopup('app_switch', event.app, event.title, event.url);
        }
      }
    }
  });

  watchers.start();

  // Start idle detection
  startIdleDetection();

  // Start attention seeker behavior
  startAttentionSeeker();

  // First-launch hint: show once after onboarding
  if (!store.get('permissionDeclines')?.hintShown) {
    setTimeout(() => {
      const pw = getPetWindow();
      if (pw && !pw.isDestroyed()) {
        pw.webContents.send('chat-popup', {
          id: randomUUID(),
          text: "Try asking me to do things! I'll ask for permissions only when I need them. 🦞",
          trigger: 'proactive',
          quickReplies: ['What can you do?', 'Got it!'],
        });
        store.set('permissionDeclines', { ...store.get('permissionDeclines'), hintShown: true });
      }
    }, 5000);
  }

  // Start idle behavior system (makes pet feel alive)
  startIdleBehaviors();

  // Start sleep check (pet falls asleep after 1 minute of no interaction)
  startSleepCheck();
}

// IPC Handlers
function setupIPC() {
  // Toggle assistant window
  ipcMain.on('toggle-assistant', () => {
    toggleAssistantWindow();
  });

  // Open assistant window on current desktop/space
  ipcMain.on('open-assistant', () => {
    createAssistantWindow();
  });

  // Close assistant window
  ipcMain.on('close-assistant', () => {
    getAssistantWindow()?.hide();
  });

  ipcMain.on('show-pet-context-menu', (_event, position: { x: number; y: number }) => {
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return;
    showPetContextMenuAtCursor(position.x, position.y);
  });

  ipcMain.on('pet-context-menu-action', (_event, action: 'chat' | 'settings' | 'quit') => {
    if (action === 'quit') {
      app.quit();
    } else if (action === 'settings') {
      openAssistantOnTab('settings');
    } else {
      openAssistantOnTab('chat');
    }
    getPetContextMenuWindow()?.hide();
  });

  ipcMain.on('hide-pet-context-menu', () => {
    getPetContextMenuWindow()?.hide();
  });

  // Force pet into sleep mode (dev utility)
  ipcMain.on('force-pet-sleep', () => {
    forceSleep();
  });

  // Force a test app-switch chat popup (dev utility)
  ipcMain.handle('dev-force-active-app-comment', async () => {
    await new Promise((resolve) => setTimeout(resolve, DEV_FORCE_ACTIVE_APP_COMMENT_DELAY_MS));

    let activeApp: string | undefined;
    let activeWindowTitle: string | undefined;
    const sendTitles = store.get('watch.sendWindowTitles') as boolean;
    let screenRecordingDenied = false;

    try {
      const activeWin = await import('active-win');
      let win: Awaited<ReturnType<typeof activeWin.default>> | undefined;
      try {
        win = await activeWin.default({
          accessibilityPermission: true,
          screenRecordingPermission: sendTitles,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const requiresScreenRecording = message.toLowerCase().includes('screen recording');
        if (requiresScreenRecording && sendTitles) {
          screenRecordingDenied = true;
          console.warn('[Dev] Screen Recording permission not granted. Testing active app comment without window title.');
          win = await activeWin.default({
            accessibilityPermission: true,
            screenRecordingPermission: false,
          });
        } else {
          throw error;
        }
      }
      activeApp = win?.owner?.name;
      activeWindowTitle = sendTitles ? win?.title : undefined;
      if (sendTitles && screenRecordingDenied && activeApp && !activeWindowTitle) {
        activeWindowTitle = await getFrontmostWindowTitleFromSystemEvents(activeApp);
      }
    } catch (error) {
      console.warn('[Dev] Failed to resolve active app for forced comment:', error);
    }

    await sendChatPopup('app_switch', activeApp, activeWindowTitle);
    return true;
  });

  // Toggle chatbar window
  ipcMain.on('toggle-chatbar', () => {
    toggleChatbarWindow();
  });

  // Close chatbar window
  ipcMain.on('close-chatbar', () => {
    getChatbarWindow()?.hide();
  });

  // Control mouse events for chatbar (for click-through on transparent areas)
  ipcMain.on('chatbar-set-ignore-mouse', (_event, ignore: boolean) => {
    const chatbarWindow = getChatbarWindow();
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
    getScreenshotQuestionWindow()?.hide();
  });

  // Ask about screen (screenshot + question)
  ipcMain.handle('ask-about-screen', async (_event, question: string, imageDataUrl: string) => {
    if (!chatProvider) {
      return { error: 'ChatProvider not initialized' };
    }

    try {
      const response = await chatProvider.analyzeScreen(imageDataUrl, question);
      return response;
    } catch (error) {
      console.error('Failed to analyze screen:', error);
      return { error: 'Failed to analyze screenshot' };
    }
  });

  // Open external URL — allowlist safe schemes
  ipcMain.on('open-external', (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // Open file/folder — restrict to user home directory
  ipcMain.on('open-path', (_event, filePath: string) => {
    const home = os.homedir();
    if (typeof filePath === 'string' && filePath.startsWith(home)) {
      shell.openPath(filePath);
    }
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
      chatProvider?.updateConfig(url);
    }

    // Apply analytics opt-out immediately (not just on restart)
    if (key === 'analytics.enabled') {
      const { setAnalyticsEnabled } = require('./analytics');
      setAnalyticsEnabled(Boolean(value));
    }

    if (key === 'pet.transparentWhenSleeping') {
      getPetWindow()?.webContents.send('pet-transparent-sleep-changed', Boolean(value));
    }

    // The Animalese engine lives in the pet-chat window, so mute must reach it
    // there — sending only to the pet window would never gate the voice.
    if (key === 'pet.muted') {
      getPetChatWindow()?.webContents.send('pet-muted-changed', Boolean(value));
    }

    if (key === 'dev.windowBorders') {
      applyDebugWindowBordersToAllWindows();
    }

    if (key === 'dev.showPetModeOverlay') {
      getPetWindow()?.webContents.send('dev-show-pet-mode-overlay-changed', Boolean(value));
    }

    return store.store;
  });

  // ── Chat sessions (CLA-33) ────────────────────────────────────────────────
  // Each session keeps its own history so conversations don't mix context.
  // Legacy flat `chatHistory` is migrated into one session on first access.
  function loadSessions(): ChatSession[] {
    let sessions = (store.get('sessions') || []) as ChatSession[];
    if (sessions.length === 0) {
      const flat = (store.get('chatHistory') || []) as ChatMessage[];
      const migrated = migrateFlatHistory(sessions, flat, Date.now(), randomUUID());
      if (migrated !== sessions) {
        sessions = migrated;
        store.set('sessions', sessions);
        store.set('activeSessionId', sessions[0]?.id ?? null);
        store.set('chatHistory', []); // consumed by migration
      }
    }
    return sessions;
  }

  function ensureActiveSession(): { sessions: ChatSession[]; active: ChatSession } {
    let sessions = loadSessions();
    let activeId = resolveActiveId(sessions, (store.get('activeSessionId') ?? null) as string | null);
    if (!activeId) {
      const s = newSession(Date.now(), randomUUID());
      sessions = [s];
      store.set('sessions', sessions);
      activeId = s.id;
    }
    if (activeId !== store.get('activeSessionId')) store.set('activeSessionId', activeId);
    const active = sessions.find((s) => s.id === activeId)!;
    return { sessions, active };
  }

  // get-chat-history → the active session's messages
  ipcMain.handle('get-chat-history', () => {
    return ensureActiveSession().active.messages;
  });

  // save-chat-history → persist into the given session, or the active one when
  // no id is passed; a write for a deleted session is dropped (returns false)
  ipcMain.handle('save-chat-history', (_event, messages: ChatMessage[], sessionId?: string | null) => {
    const { sessions, active } = ensureActiveSession();
    const target = sessionId ? sessions.find((s) => s.id === sessionId) : active;
    if (!target) return false;
    const trimmed = (messages || []).slice(-100);
    const updated = withMessages(target, trimmed, Date.now());
    store.set('sessions', capSessions(sessions.map((s) => (s.id === target.id ? updated : s))));
    return true;
  });

  // append-chat-messages → atomically append to a session pinned at send time
  ipcMain.handle('append-chat-messages', (_event, messages: ChatMessage[], sessionId?: string | null) => {
    const { sessions, active } = ensureActiveSession();
    const target = sessionId ? sessions.find((s) => s.id === sessionId) : active;
    if (!target) return false;
    const combined = [...target.messages, ...(messages || [])].slice(-100);
    const updated = withMessages(target, combined, Date.now());
    store.set('sessions', capSessions(sessions.map((s) => (s.id === target.id ? updated : s))));
    return true;
  });

  // clear-chat-history → empty the active session (keeps the session itself)
  ipcMain.handle('clear-chat-history', () => {
    const { sessions, active } = ensureActiveSession();
    const cleared: ChatSession = { ...active, messages: [], title: 'New chat', updatedAt: Date.now() };
    store.set('sessions', sessions.map((s) => (s.id === active.id ? cleared : s)));
    return true;
  });

  // list-sessions → { sessions: meta[] (newest first), activeId }
  ipcMain.handle('list-sessions', () => {
    const { sessions, active } = ensureActiveSession();
    return {
      sessions: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map(toMeta),
      activeId: active.id,
    };
  });

  // create-session → new empty session, becomes active
  ipcMain.handle('create-session', () => {
    const sessions = loadSessions();
    const s = newSession(Date.now(), randomUUID());
    store.set('sessions', capSessions([s, ...sessions]));
    store.set('activeSessionId', s.id);
    return toMeta(s);
  });

  // switch-session → set active, return that session's messages
  ipcMain.handle('switch-session', (_event, id: string) => {
    const sessions = loadSessions();
    const target = sessions.find((s) => s.id === id);
    if (!target) return null;
    store.set('activeSessionId', id);
    return target.messages;
  });

  // delete-session → remove and resolve a valid active id (creates one if empty)
  ipcMain.handle('delete-session', (_event, id: string) => {
    const sessions = loadSessions().filter((s) => s.id !== id);
    store.set('sessions', sessions);
    store.set('activeSessionId', resolveActiveId(sessions, (store.get('activeSessionId') ?? null) as string | null));
    return { activeId: ensureActiveSession().active.id };
  });

  // rename-session → set a custom title (persists across message updates)
  ipcMain.handle('rename-session', (_event, id: string, title: string) => {
    const sessions = loadSessions().map((s) =>
      s.id === id ? { ...s, title: Array.from((title || '').trim()).slice(0, 60).join('') || s.title, updatedAt: Date.now() } : s,
    );
    store.set('sessions', sessions);
    return true;
  });

  // Check screen capture permission status
  ipcMain.handle('get-screen-capture-permission', () => {
    return getScreenCapturePermissionStatus();
  });

  // Check accessibility permission (legacy)
  ipcMain.handle('check-accessibility-permission', (_event, prompt: boolean = false) => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.isTrustedAccessibilityClient(false);
  });

  // Permission system — inline panel APIs
  ipcMain.handle('get-permission-statuses', () => {
    return getAllPermissionStatuses();
  });

  ipcMain.handle('request-permission', async (_event, type: PermissionType) => {
    const granted = await requestPermission(type);
    return { granted, needsRestart: needsRestart(type) };
  });

  ipcMain.handle('open-permission-settings', (_event, type: PermissionType) => {
    openPermissionSettings(type);
  });

  ipcMain.handle('start-permission-polling', (_event, type: PermissionType) => {
    startPolling(type, () => {
      // Notify all windows when permission is granted
      const { BrowserWindow: BW } = require('electron');
      for (const win of BW.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('permission-status-changed', {
            type,
            status: 'granted',
            needsRestart: needsRestart(type),
          });
        }
      }
      // Restart watchers if accessibility was just granted
      if (type === 'accessibility') watchers?.restart();
    });
  });

  ipcMain.handle('stop-permission-polling', (_event, type: PermissionType) => {
    stopPolling(type);
  });

  // Re-check permissions on window focus
  app.on('browser-window-focus', () => {
    const statuses = getAllPermissionStatuses();
    const { BrowserWindow: BW } = require('electron');
    for (const win of BW.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('permission-statuses-updated', statuses);
      }
    }
  });

  // Screen capture
  ipcMain.handle('capture-screen', async () => {
    await playPetCameraSnapAnimationBeforeCapture();
    return await captureScreen();
  });

  // Build chat payload with history and optional screen context
  const buildClawbotChatPayload = async (message: string, includeScreen?: boolean) => {
    const history = ensureActiveSession().active.messages
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));

    const context = await getScreenContext();
    let fullMessage = message;

    const mentionsScreen = /screen|cursor|mouse|look|where|point|here|there|this/i.test(message);
    if (includeScreen || mentionsScreen) {
      const screenCapture = await captureScreenWithContext();
      if (screenCapture) {
        fullMessage = `[Screen Context: Cursor at (${screenCapture.cursor.x}, ${screenCapture.cursor.y}), Screen size: ${screenCapture.screenSize.width}x${screenCapture.screenSize.height}, Pet at (${context.petPosition.x}, ${context.petPosition.y})]\n\n${message}`;
      }
    }

    // Inject browser URL context if available and enabled
    if (store.get('watch.browserUrl') && lastBrowserContext) {
      const browserPrefix = `[Browser: ${lastBrowserContext.domain} | Title: ${lastBrowserContext.title}]`;
      fullMessage = fullMessage.startsWith('[Screen Context:')
        ? fullMessage.replace(']\n\n', ` | ${browserPrefix}]\n\n`)
        : `${browserPrefix}\n\n${fullMessage}`;
    }

    return { history, fullMessage };
  };

  // Show final response as a speech bubble on the pet when appropriate
  const maybeShowPetResponse = (responseText?: string, quickReplies?: string[], context?: { userInput?: string; toolCall?: { tool: string | null; args?: Record<string, unknown> } }) => {
    const assistantWindow = getAssistantWindow();
    const chatbarWindow = getChatbarWindow();
    const petWindow = getPetWindow();
    const assistantActive = assistantWindow && assistantWindow.isVisible();
    const chatbarActive = chatbarWindow && chatbarWindow.isVisible();
    if (responseText && !responseText.includes('error') && petWindow && !assistantActive && !chatbarActive && !tutorialManager?.getStatus().isActive) {
      petWindow.webContents.send('chat-popup', {
        id: randomUUID(),
        text: responseText,
        trigger: 'proactive',
        quickReplies: quickReplies && quickReplies.length ? quickReplies : ['Thanks!', 'Not now'],
        userInput: context?.userInput,
        toolCall: context?.toolCall,
      });
    }
  };

  // Send message to ClawBot (with optional screen context)
  ipcMain.handle('send-to-clawbot', async (_event, message: string, includeScreen?: boolean) => {
    if (!chatProvider) return { error: 'ChatProvider not initialized' };

    // Intercept feedback submissions — send to proxy, don't route through chat
    if (message.startsWith('{"__feedback":true')) {
      try {
        const feedback = JSON.parse(message);
        delete feedback.__feedback;
        feedback.appVersion = app.getVersion();
        feedback.timestamp = new Date().toISOString();
        if (lastChatContext) {
          feedback.userInput = feedback.userInput || lastChatContext.userInput;
          feedback.toolCall = feedback.toolCall || lastChatContext.toolCall;
          feedback.modelOutput = feedback.modelOutput || lastChatContext.modelOutput;
        }
        const proxyUrl = store.get('clawbot').url;
        const feedbackBody = JSON.stringify(feedback);
        const deviceId = store.get('clawbot').deviceId || 'unknown';
        fetch(`${proxyUrl}/v1/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(feedbackBody, deviceId) },
          body: feedbackBody,
        }).then(r => {
          if (!r.ok) console.error(`[Feedback] ${r.status} ${r.statusText}`);
        }).catch(err => console.error('[Feedback] Error:', err));
      } catch { /* malformed feedback, ignore */ }
      return { type: 'message', text: '' };
    }

    // Intercept "Open Settings" quick reply — open the pane for the last denied permission
    if (message.trim().toLowerCase() === 'open settings') {
      const perm = lastDeniedPermission || 'accessibility';
      await requestPermission(perm as PermissionType);
      const reply = { type: 'message' as const, text: 'I opened System Settings for you — toggle Clawster ON and try again!', quickReplies: ['Thanks!'] };
      maybeShowPetResponse(reply.text, reply.quickReplies);
      return reply;
    }

    logEvent('chat_sent', { includeScreen: !!includeScreen });
    resetInteractionTimer();

    const { history, fullMessage } = await buildClawbotChatPayload(message, includeScreen);

    const response = await chatProvider.chat(fullMessage, history);

    // Track which permission was denied so "Open Settings" opens the right pane
    if (response.quickReplies?.includes('Open Settings') && response.text) {
      if (response.text.includes('Screen Recording')) lastDeniedPermission = 'screen-recording';
      else if (response.text.includes('Microphone')) lastDeniedPermission = 'microphone';
      else lastDeniedPermission = 'accessibility';
    }

    // Handle any actions in the response
    if (response.action?.payload) {
      await executePetAction(response.action.payload as PetAction);
    }

    lastChatContext = { userInput: message, toolCall: response.toolCall, modelOutput: response.text || '' };
    maybeShowPetResponse(response.text, response.quickReplies, { userInput: message, toolCall: response.toolCall });

    return response;
  });

  // Start streaming a message to ClawBot and emit chunk/end/error events
  ipcMain.handle('start-clawbot-stream', async (event, message: string, includeScreen?: boolean) => {
    const chatProviderClient = chatProvider;
    if (!chatProviderClient) return { error: 'ChatProvider not initialized' };

    resetInteractionTimer();

    const requestId = randomUUID();
    const sender = event.sender;
    const chatbarWindow = getChatbarWindow();
    const isChatbarRequest = Boolean(
      chatbarWindow &&
      !chatbarWindow.isDestroyed() &&
      chatbarWindow.webContents.id === sender.id
    );

    const runStream = async () => {
      try {
        const { history, fullMessage } = await buildClawbotChatPayload(message, includeScreen);
        const response = await chatProviderClient.chatStream(fullMessage, history, {
          onDelta: (delta, text) => {
            if (!sender.isDestroyed()) {
              sender.send('clawbot-stream-chunk', { requestId, delta, text });
            }
          },
        });

        if (response.action?.payload) {
          await executePetAction(response.action.payload as PetAction);
        }

        lastChatContext = { userInput: message, toolCall: response.toolCall, modelOutput: response.text || '' };
        if (!isChatbarRequest) {
          maybeShowPetResponse(response.text, response.quickReplies, { userInput: message, toolCall: response.toolCall });
        }

        if (!sender.isDestroyed()) {
          sender.send('clawbot-stream-end', { requestId, response });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Failed to stream from ClawBot:', error);
        if (!sender.isDestroyed()) {
          sender.send('clawbot-stream-error', { requestId, error: errorMessage });
        }
      }
    };

    void runStream();
    return { requestId };
  });

  // Speech recognition - check permissions
  ipcMain.handle('speech-permission-status', async () => {
    if (process.platform !== 'darwin') {
      return { mic: 'denied', speech: 'denied' };
    }

    const micStatus = systemPreferences.getMediaAccessStatus('microphone');

    try {
      const helperPath = getSpeechHelperPath();
      const { stdout } = await execFileAsync(helperPath, ['--check-permissions']);
      const result = JSON.parse(stdout.trim());
      return { mic: micStatus, speech: result.speech || 'not-determined' };
    } catch {
      return { mic: micStatus, speech: 'not-determined' };
    }
  });

  // Speech recognition - start recording
  ipcMain.handle('speech-start', async (event): Promise<{ success: boolean; error?: string }> => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Speech recognition is only available on macOS' };
    }

    if (isSpeechSessionActive() || isSpeechStartPending()) {
      return { success: false, error: 'Already recording' };
    }

    // Check and request mic permission
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      if (!granted) {
        return { success: false, error: 'Microphone permission denied. Please enable in System Settings > Privacy & Security > Microphone.' };
      }
    } else if (micStatus !== 'granted') {
      return { success: false, error: 'Microphone permission denied. Please enable in System Settings > Privacy & Security > Microphone.' };
    }

    const sender = event.sender;
    const startSequence = nextSpeechStartSequence();
    setSpeechSender(sender);
    setSpeechSessionActive(true);
    setSpeechStartPending(true);

    try {
      const helper = await ensureSpeechHelper();
      const startCancelled = !isSpeechSessionActive() || !isSpeechStartPending() || getSpeechStartSequence() !== startSequence;
      if (startCancelled) {
        if (getSpeechStartSequence() === startSequence && !isSpeechSessionActive()) {
          setSpeechSender(null);
        }
        return { success: false, error: 'Speech recognition start cancelled' };
      }
      if (!helper.stdin || helper.stdin.destroyed) {
        throw new Error('Speech helper is not available');
      }
      setSpeechStartPending(false);
      helper.stdin.write('start\n');
      return { success: true };
    } catch (error) {
      if (getSpeechStartSequence() === startSequence) {
        setSpeechStartPending(false);
        setSpeechSessionActive(false);
        setSpeechSender(null);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start speech recognition',
      };
    }
  });

  // Speech recognition - stop recording
  ipcMain.handle('speech-stop', async () => {
    const activeSpeechProcess = getSpeechProcess();
    const shouldStop = Boolean(isSpeechSessionActive() || isSpeechStartPending());
    if (isSpeechStartPending()) {
      setSpeechStartPending(false);
      setSpeechSessionActive(false);
    }
    if (activeSpeechProcess && shouldStop) {
      activeSpeechProcess.stdin?.write('stop\n');
    }
  });

  // Get screen context (cursor position, pet position, etc.)
  ipcMain.handle('get-screen-context', async () => {
    return await getScreenContext();
  });

  // Capture screen with context
  ipcMain.handle('capture-screen-with-context', async () => {
    await playPetCameraSnapAnimationBeforeCapture();
    return await captureScreenWithContext();
  });

  // Execute pet action directly
  ipcMain.handle('execute-pet-action', async (_event, action: PetAction) => {
    await executePetAction(action);
    if (action.type === 'set_mood') trackPetInteraction('mood_change');
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
    if (chatProvider) {
      return chatProvider.getConnectionStatus();
    }
    return { connected: false, error: 'Not initialized' };
  });

  // Copy text to clipboard
  ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
  });

  // Forward mouth shape from PetChat to Pet window
  ipcMain.on('pet-mouth-shape', (_event, shape: string | null) => {
    const petWindow = getPetWindow();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet-mouth-shape', shape);
    }
  });

  ipcMain.on('pet-drag', (_event, deltaX: number, deltaY: number) => {
    logEvent('pet_dragged');
    trackPetInteraction('drag');
    const petWindow = getPetWindow();
    if (petWindow) {
      const [x, y] = petWindow.getPosition();
      const newX = x + deltaX;
      const newY = y + deltaY;
      petWindow.setPosition(newX, newY);
      store.set('pet.position', { x: newX, y: newY });
      updatePetChatPosition();
      updateAssistantPosition();
      getPetContextMenuWindow()?.hide();
      resetInteractionTimer();
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

  // Resize pet chat popup to match rendered content
  ipcMain.on('resize-pet-chat', (_event, width: number, height: number) => {
    resizePetChatToContent(width, height);
  });

  // Reset pet chat inactivity timer when user interacts with the popup
  ipcMain.on('pet-chat-interacted', () => {
    const petChatWindow = getPetChatWindow();
    if (petChatWindow && !petChatWindow.isDestroyed() && petChatWindow.isVisible()) {
      schedulePetChatAutoHide();
    }
  });

  // Forward pet chat reply to pet window
  ipcMain.on('pet-chat-reply', (_event, reply: string) => {
    getPetWindow()?.webContents.send('pet-chat-reply', reply);
  });

  // Pet movement (legacy API)
  ipcMain.handle('pet-move-to', (_event, x: number, y: number, duration?: number) => {
    animateMoveTo(x, y, duration ?? 1000);
  });

  ipcMain.handle('get-cursor-position', () => {
    return screen.getCursorScreenPoint();
  });

  ipcMain.handle('get-pet-position', () => {
    return getPetWindow()?.getPosition() ?? [0, 0];
  });

  // Pet was clicked
  ipcMain.on('pet-clicked', () => {
    logEvent('pet_clicked');
    trackPetInteraction('click');
    resetInteractionTimer();
  });

  // Chat sync - broadcast to all windows when chat history changes
  ipcMain.on('chat-sync', () => {
    const assistantWindow = getAssistantWindow();
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.webContents.send('chat-sync');
    }
    const chatbarWindow = getChatbarWindow();
    if (chatbarWindow && !chatbarWindow.isDestroyed()) {
      chatbarWindow.webContents.send('chat-sync');
    }
  });

  // Onboarding handlers
  ipcMain.handle('onboarding-skip', () => {
    store.set('onboarding.skipped', true);
    logEvent('onboarding_skipped');
    closeOnboardingAndStartApp();
    return true;
  });

  // Reset onboarding (for testing)
  ipcMain.handle('reset-onboarding', () => {
    resetOnboardingState();
    store.set('tutorial.completedAt', null);
    store.set('tutorial.lastStep', 0);
    store.set('tutorial.wasInterrupted', false);
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('onboarding-complete', (_event, data: {
    launchOnStartup: boolean;
    hotkeyOpenChat: string;
    personalityPreset: PresetId;
  }) => {
    logEvent('onboarding_completed');
    store.set('onboarding.completed', true);
    store.set('tutorial.completedAt', null);
    store.set('tutorial.lastStep', 0);
    store.set('tutorial.wasInterrupted', false);
    // Apply the chosen "vibe" — no raw markdown editing during onboarding.
    const preset = isPresetId(data.personalityPreset) ? data.personalityPreset : DEFAULT_PRESET;
    store.set('personality.preset', preset);
    applyPreset(preset);
    // No upfront permissions: watching stays off until the user opts in from Settings.
    store.set('watch.activeApp', false);
    store.set('watch.sendWindowTitles', false);
    store.set('hotkeys.openChat', data.hotkeyOpenChat);
    setLaunchOnStartup(data.launchOnStartup);
    closeOnboardingAndStartApp();
    return true;
  });

  // Active personality (the user-chosen preset's files, or the bundled default)
  ipcMain.handle('get-default-personality', () => {
    return getActivePersonality();
  });

  // Personality preset picker (onboarding + Settings)
  ipcMain.handle('get-personality-presets', () => PRESETS);

  ipcMain.handle('get-personality-preset', () => {
    return store.get('personality.preset') as string;
  });

  ipcMain.handle('set-personality-preset', (_event, id: string) => {
    if (!isPresetId(id)) return { ok: false };
    store.set('personality.preset', id);
    const ok = applyPreset(id);
    return { ok };
  });

  // Power-user escape hatch: reveal the active personality files for raw editing.
  ipcMain.handle('open-personality-folder', () => {
    ensureActivePersonality((store.get('personality.preset') as PresetId) || DEFAULT_PRESET);
    shell.openPath(activePersonalityDir());
    return true;
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
    hidePetChat();
    tutorialManager.resume();
  });

  ipcMain.on('tutorial-start-over', () => {
    hidePetChat();
    tutorialManager.startOver();
  });

  ipcMain.on('tutorial-open-panel', () => {
    tutorialManager.handleOpenPanelClicked();
  });

  ipcMain.handle('replay-tutorial', () => {
    hidePetChat();
    tutorialManager.replay();
    return true;
  });

  ipcMain.handle('get-tutorial-status', () => {
    return tutorialManager.getStatus();
  });
}

// Register global hotkeys from store
function registerHotkeys() {
  globalShortcut.unregisterAll();

  const hotkeyOpenAssistant = store.get('hotkeys.openAssistant') as string || 'CommandOrControl+Shift+A';
  const hotkeyOpenChat = store.get('hotkeys.openChat') as string || 'CommandOrControl+Shift+Space';
  const hotkeyCaptureScreen = store.get('hotkeys.captureScreen') as string || 'CommandOrControl+Shift+/';

  globalShortcut.register(hotkeyOpenAssistant, () => {
    tutorialManager.handleHotkeyPressed('openAssistant');
    toggleAssistantWindow();
  });
  console.log(`[Hotkeys] Registered open assistant: ${hotkeyOpenAssistant}`);

  globalShortcut.register(hotkeyOpenChat, () => {
    tutorialManager.handleHotkeyPressed('openChat');
    resetInteractionTimer();
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
function broadcastUpdateStatus(payload: { state: string; version?: string; percent?: number }) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update-status', payload);
  }
}

function setupAutoUpdater() {
  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

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
    broadcastUpdateStatus({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No updates available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
    broadcastUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    broadcastUpdateStatus({ state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error);
    broadcastUpdateStatus({ state: 'error' });
  });

  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000);
}

// Setup system tray
function setupTray() {
  const iconPath = isDev
    ? path.join(__dirname, '../../assets/tray-icon.png')
    : path.join(process.resourcesPath, 'assets/tray-icon.png');

  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      trayIcon.setTemplateImage(true);
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Clawster');

  function buildTrayMenu() {
    const petWindow = getPetWindow();
    const isVisible = petWindow?.isVisible() ?? false;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: isVisible ? 'Hide Clawster' : 'Show Clawster',
        click: () => {
          const win = getPetWindow();
          if (!win) return;
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
          buildTrayMenu();
        },
      },
      {
        label: 'Open Assistant',
        click: () => {
          createAssistantWindow();
        },
      },
      {
        label: 'Settings',
        click: () => {
          createAssistantWindow();
          const assistantWindow = getAssistantWindow();
          if (!assistantWindow) return;

          if (assistantWindow.webContents.isLoading()) {
            assistantWindow.webContents.once('did-finish-load', () => {
              getAssistantWindow()?.webContents.send('switch-to-settings');
            });
          } else {
            assistantWindow.webContents.send('switch-to-settings');
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
          resetOnboardingState();
          store.set('tutorial.completedAt', null);
          store.set('tutorial.lastStep', 0);
          store.set('tutorial.wasInterrupted', false);
          app.relaunch();
          app.exit(0);
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

    tray!.setContextMenu(contextMenu);
  }

  buildTrayMenu();

  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      getPetWindow()?.show();
      getPetWindow()?.focus();
    });
  }
}

// App lifecycle
app.whenReady().then(async () => {
  initModules();
  setupIPC();
  setupAutoUpdater();
  setupTray();

  // Check onboarding status
  const onboardingCompleted = store.get('onboarding.completed') as boolean;
  const onboardingSkipped = store.get('onboarding.skipped') as boolean;

  console.log('[Onboarding] Status check:', { onboardingCompleted, onboardingSkipped });

  if (!onboardingCompleted && !onboardingSkipped) {
    console.log('[Onboarding] Showing onboarding window...');
    await createOnboardingWindow();
    console.log('[Onboarding] Window created');
  } else {
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
  shutdownAnalytics();
  globalShortcut.unregisterAll();
  const speechProcess = getSpeechProcess();
  if (speechProcess) {
    setSpeechProcessExitExpected(true);
    speechProcess.stdin?.end('quit\n');
  }
  watchers?.stop();
  stopIdleBehaviors();
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }
  stopAttentionSeeker();
  clearMoveAnimation();
  tutorialManager.destroy();
});
