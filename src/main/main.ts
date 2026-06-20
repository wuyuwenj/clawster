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
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { autoUpdater } from 'electron-updater';
import { Watchers } from './watchers';
import { LocalToolProvider, ChatRouter, setNotifyCallback, setConfirmCallback, createProxyVision } from './chat';
import { EmotionEngine } from './emotion-engine';
import { createStore } from './store';
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
const tutorialManager = new TutorialManager(store);

const isDev = !app.isPackaged;
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
  windowTitle?: string
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
        prompt = `User is using app name: "${context}". Window title: "${windowTitle?.trim() || '[unavailable]'}". Based on what you know about the user, say something funny that's relevant to the app and/or window title.`;
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

  const personalityDir = isDev
    ? path.join(__dirname, '../../personality')
    : path.join(process.resourcesPath, 'personality');

  let personalityPrompt = '';
  try {
    const identity = fs.readFileSync(path.join(personalityDir, 'IDENTITY.md'), 'utf-8');
    const soul = fs.readFileSync(path.join(personalityDir, 'SOUL.md'), 'utf-8');
    if (identity) personalityPrompt += `\nIDENTITY:\n${identity}`;
    if (soul) personalityPrompt += `\nSOUL:\n${soul}`;
  } catch { /* personality files optional */ }

  const toolModel = new LocalToolProvider();
  chatProvider = new ChatRouter(toolModel);

  // Wire on-demand cloud vision for screen analysis (local model has no vision).
  // No background polling — the proxy is only contacted when the user asks about
  // their screen.
  let deviceId = store.get('clawbot').deviceId;
  if (!deviceId) {
    deviceId = randomUUID();
    store.set('clawbot', { ...store.get('clawbot'), deviceId });
  }
  const proxyUrl = store.get('clawbot').url;
  chatProvider.setVisionProvider(createProxyVision(proxyUrl, deviceId));
  chatProvider.setScreenCapturer(() => captureScreen());

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

      const now = Date.now();
      if (now - lastAppSwitchChat > APP_SWITCH_CHAT_COOLDOWN) {
        lastAppSwitchChat = now;
        if (Math.random() < 0.3) {
          sendChatPopup('app_switch', event.app, event.title);
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
    console.log('[ScreenshotQuestion] ask-about-screen called');
    console.log('[ScreenshotQuestion] Question:', question);
    console.log('[ScreenshotQuestion] Image size:', imageDataUrl?.length || 0, 'chars');

    if (!chatProvider) {
      console.log('[ScreenshotQuestion] ChatProvider not initialized!');
      return { error: 'ChatProvider not initialized' };
    }

    try {
      console.log('[ScreenshotQuestion] Calling analyzeScreen...');
      const response = await chatProvider.analyzeScreen(imageDataUrl, question);
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
      chatProvider?.updateConfig(url);
    }

    if (key === 'pet.transparentWhenSleeping') {
      getPetWindow()?.webContents.send('pet-transparent-sleep-changed', Boolean(value));
    }

    if (key === 'dev.windowBorders') {
      applyDebugWindowBordersToAllWindows();
    }

    if (key === 'dev.showPetModeOverlay') {
      getPetWindow()?.webContents.send('dev-show-pet-mode-overlay-changed', Boolean(value));
    }

    return store.store;
  });

  // Get chat history
  ipcMain.handle('get-chat-history', () => {
    return store.get('chatHistory') || [];
  });

  // Save chat history
  ipcMain.handle('save-chat-history', (_event, messages: unknown[]) => {
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
  ipcMain.handle('get-screen-capture-permission', () => {
    return getScreenCapturePermissionStatus();
  });

  // Check accessibility permission
  ipcMain.handle('check-accessibility-permission', (_event, prompt: boolean = false) => {
    if (process.platform !== 'darwin') {
      return true;
    }
    const result = systemPreferences.isTrustedAccessibilityClient(prompt);
    console.log(`[Accessibility] isTrustedAccessibilityClient(${prompt}) = ${result}`);
    return result;
  });

  // Screen capture
  ipcMain.handle('capture-screen', async () => {
    await playPetCameraSnapAnimationBeforeCapture();
    return await captureScreen();
  });

  // Build chat payload with history and optional screen context
  const buildClawbotChatPayload = async (message: string, includeScreen?: boolean) => {
    const chatHistory = (store.get('chatHistory') || []) as Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>;
    const history = chatHistory
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

    return { history, fullMessage };
  };

  // Show final response as a speech bubble on the pet when appropriate
  const maybeShowPetResponse = (responseText?: string, quickReplies?: string[]) => {
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
      });
    }
  };

  // Send message to ClawBot (with optional screen context)
  ipcMain.handle('send-to-clawbot', async (_event, message: string, includeScreen?: boolean) => {
    if (!chatProvider) return { error: 'ChatProvider not initialized' };

    logEvent('chat_sent', { includeScreen: !!includeScreen });
    resetInteractionTimer();

    const { history, fullMessage } = await buildClawbotChatPayload(message, includeScreen);

    const response = await chatProvider.chat(fullMessage, history);

    // Handle any actions in the response
    if (response.action?.payload) {
      await executePetAction(response.action.payload as PetAction);
    }

    maybeShowPetResponse(response.text, response.quickReplies);

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

        if (!isChatbarRequest) {
          maybeShowPetResponse(response.text, response.quickReplies);
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
    identity: string;
    soul: string;
    watchFolders: string[];
    watchActiveApp: boolean;
    watchWindowTitles: boolean;
    hotkeyOpenChat: string;
    hotkeyCaptureScreen: string;
    hotkeyOpenAssistant: string;
  }) => {
    logEvent('onboarding_completed');
    store.set('onboarding.completed', true);
    store.set('tutorial.completedAt', null);
    store.set('tutorial.lastStep', 0);
    store.set('tutorial.wasInterrupted', false);
    store.set('watch.folders', data.watchFolders);
    store.set('watch.activeApp', data.watchActiveApp);
    store.set('watch.sendWindowTitles', data.watchWindowTitles);
    store.set('hotkeys.openChat', data.hotkeyOpenChat);
    store.set('hotkeys.captureScreen', data.hotkeyCaptureScreen);
    store.set('hotkeys.openAssistant', data.hotkeyOpenAssistant);
    setLaunchOnStartup(data.launchOnStartup);
    closeOnboardingAndStartApp();
    return true;
  });

  // Get default identity and soul from app resources
  ipcMain.handle('get-default-personality', () => {
    try {
      const basePath = isDev
        ? path.join(__dirname, '../../personality')
        : path.join(process.resourcesPath, 'personality');

      const identity = fs.readFileSync(path.join(basePath, 'IDENTITY.md'), 'utf-8');
      const soul = fs.readFileSync(path.join(basePath, 'SOUL.md'), 'utf-8');

      return { identity, soul };
    } catch (error) {
      console.error('Failed to read default personality:', error);
      return { identity: '', soul: '' };
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

  autoUpdater.checkForUpdatesAndNotify();
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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Clawster',
      click: () => {
        getPetWindow()?.show();
        getPetWindow()?.focus();
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
