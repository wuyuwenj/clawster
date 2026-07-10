import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type ListenerCleanup = () => void;

interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

function onIpc<T>(channel: string, callback: (data: T) => void): ListenerCleanup {
  const listener = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

function onIpcNoArgs(channel: string, callback: () => void): ListenerCleanup {
  const listener = () => callback();
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('clawster', {
  // Window controls
  toggleAssistant: () => ipcRenderer.send('toggle-assistant'),
  openAssistant: () => ipcRenderer.send('open-assistant'),
  closeAssistant: () => ipcRenderer.send('close-assistant'),
  forcePetSleep: () => ipcRenderer.send('force-pet-sleep'),
  forceActiveAppComment: () => ipcRenderer.invoke('dev-force-active-app-comment'),
  toggleChatbar: () => ipcRenderer.send('toggle-chatbar'),
  closeChatbar: () => ipcRenderer.send('close-chatbar'),
  setChatbarIgnoreMouse: (ignore: boolean) => ipcRenderer.send('chatbar-set-ignore-mouse', ignore),
  toggleScreenshotQuestion: () => ipcRenderer.send('toggle-screenshot-question'),
  closeScreenshotQuestion: () => ipcRenderer.send('close-screenshot-question'),
  askAboutScreen: (question: string, imageDataUrl: string) =>
    ipcRenderer.invoke('ask-about-screen', question, imageDataUrl),

  // Pet dragging
  dragPet: (deltaX: number, deltaY: number) => ipcRenderer.send('pet-drag', deltaX, deltaY),
  petDragTakeOver: () => ipcRenderer.send('pet-drag-take-over'),
  // Pet chat popup
  showPetChat: (message: { id: string; text: string; quickReplies?: string[] }) =>
    ipcRenderer.send('show-pet-chat', message),
  hidePetChat: () => ipcRenderer.send('hide-pet-chat'),
  resizePetChat: (width: number, height: number) => ipcRenderer.send('resize-pet-chat', width, height),
  petChatInteracted: () => ipcRenderer.send('pet-chat-interacted'),
  onPetChatMessage: (callback: (message: { id: string; text: string; quickReplies?: string[] }) => void) => {
    return onIpc('chat-message', callback);
  },
  onPetChatHidden: (callback: () => void) => onIpcNoArgs('pet-chat-hidden', callback),
  petChatReply: (reply: string) => ipcRenderer.send('pet-chat-reply', reply),
  onPetChatReply: (callback: (reply: string) => void) => {
    return onIpc('pet-chat-reply', callback);
  },

  // External actions
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  openPath: (path: string) => ipcRenderer.send('open-path', path),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (key: string, value: unknown) => ipcRenderer.invoke('update-settings', key, value),

  // Chat history
  getChatHistory: () => ipcRenderer.invoke('get-chat-history'),
  saveChatHistory: (messages: unknown[], sessionId?: string) =>
    ipcRenderer.invoke('save-chat-history', messages, sessionId),
  appendChatMessages: (messages: unknown[], sessionId?: string) =>
    ipcRenderer.invoke('append-chat-messages', messages, sessionId),
  clearChatHistory: () => ipcRenderer.invoke('clear-chat-history'),
  // Chat sessions (CLA-33)
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  createSession: () => ipcRenderer.invoke('create-session'),
  switchSession: (id: string) => ipcRenderer.invoke('switch-session', id),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('rename-session', id, title),
  notifyChatSync: () => ipcRenderer.send('chat-sync'),

  // Permissions (inline panel APIs)
  getPermissionStatuses: () => ipcRenderer.invoke('get-permission-statuses'),
  requestPermission: (type: string) => ipcRenderer.invoke('request-permission', type),
  openPermissionSettings: (type: string) => ipcRenderer.invoke('open-permission-settings', type),
  startPermissionPolling: (type: string) => ipcRenderer.invoke('start-permission-polling', type),
  stopPermissionPolling: (type: string) => ipcRenderer.invoke('stop-permission-polling', type),
  onPermissionStatusChanged: (callback: (data: { type: string; status: string; needsRestart: boolean }) => void) => {
    return onIpc('permission-status-changed', callback);
  },
  onPermissionStatusesUpdated: (callback: (statuses: Record<string, string>) => void) => {
    return onIpc('permission-statuses-updated', callback);
  },

  // Auto-update
  onUpdateStatus: (callback: (data: { state: string; version?: string; percent?: number }) => void) => {
    return onIpc('update-status', callback);
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureScreenWithContext: () => ipcRenderer.invoke('capture-screen-with-context'),
  getScreenContext: () => ipcRenderer.invoke('get-screen-context'),
  getScreenCapturePermission: () => ipcRenderer.invoke('get-screen-capture-permission'),
  checkAccessibilityPermission: (prompt?: boolean) => ipcRenderer.invoke('check-accessibility-permission', prompt),

  // ClawBot
  sendToClawbot: (message: string, includeScreen?: boolean) =>
    ipcRenderer.invoke('send-to-clawbot', message, includeScreen),
  startClawbotStream: (message: string, includeScreen?: boolean) =>
    ipcRenderer.invoke('start-clawbot-stream', message, includeScreen),
  getClawbotStatus: () => ipcRenderer.invoke('clawbot-status'),
  onConnectionStatusChange: (callback: (status: { connected: boolean; error: string | null }) => void) => {
    return onIpc('clawbot-connection-changed', callback);
  },
  onClawbotStreamChunk: (callback: (data: { requestId: string; delta: string; text: string }) => void) => {
    return onIpc('clawbot-stream-chunk', callback);
  },
  onClawbotStreamEnd: (callback: (data: { requestId: string; response: unknown }) => void) => {
    return onIpc('clawbot-stream-end', callback);
  },
  onClawbotStreamError: (callback: (data: { requestId: string; error: string }) => void) => {
    return onIpc('clawbot-stream-error', callback);
  },

  // Mouth animation (pet talking)
  sendMouthShape: (shape: string | null) => ipcRenderer.send('pet-mouth-shape', shape),
  onMouthShape: (callback: (shape: string | null) => void) => {
    return onIpc('pet-mouth-shape', callback);
  },

  // Speech recognition
  startSpeechRecognition: () => ipcRenderer.invoke('speech-start'),
  stopSpeechRecognition: () => ipcRenderer.invoke('speech-stop'),
  checkSpeechPermission: () => ipcRenderer.invoke('speech-permission-status'),
  onSpeechResult: (callback: (data: { type: 'partial' | 'final'; text: string }) => void) => {
    return onIpc('speech-result', callback);
  },
  onSpeechError: (callback: (data: { type: 'error'; message: string }) => void) => {
    return onIpc('speech-error', callback);
  },

  // Clipboard
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),

  // Pet actions
  executePetAction: (action: { type: string; value?: string; x?: number; y?: number; duration?: number }) =>
    ipcRenderer.invoke('execute-pet-action', action),
  movePetTo: (x: number, y: number, duration?: number) =>
    ipcRenderer.invoke('move-pet-to', x, y, duration),
  movePetToCursor: () => ipcRenderer.invoke('move-pet-to-cursor'),
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  getPetPosition: () => ipcRenderer.invoke('get-pet-position'),

  // Events from main process
  onActivityEvent: (callback: (event: unknown) => void) => {
    ipcRenderer.on('activity-event', (_event, data) => callback(data));
  },
  onClawbotSuggestion: (callback: (data: unknown) => void) => {
    ipcRenderer.on('clawbot-suggestion', (_event, data) => callback(data));
  },
  onClawbotMood: (callback: (data: unknown) => void) => {
    ipcRenderer.on('clawbot-mood', (_event, data) => callback(data));
  },
  onChatPopup: (callback: (data: unknown) => void) => {
    ipcRenderer.on('chat-popup', (_event, data) => callback(data));
  },
  onPetMoving: (callback: (data: { moving: boolean }) => void) => {
    ipcRenderer.on('pet-moving', (_event, data) => callback(data));
  },
  onPetCameraSnap: (callback: (data: { captureAtMs: number; durationMs: number; flashDurationMs: number }) => void) => {
    ipcRenderer.on('pet-camera-snap', (_event, data) => callback(data));
  },
  onPetTransparentSleepChanged: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('pet-transparent-sleep-changed', (_event, enabled) => callback(Boolean(enabled)));
  },
  onPetMutedChanged: (callback: (muted: boolean) => void) => {
    ipcRenderer.on('pet-muted-changed', (_event, muted) => callback(Boolean(muted)));
  },
  onDevShowPetModeOverlayChanged: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('dev-show-pet-mode-overlay-changed', (_event, enabled) => callback(Boolean(enabled)));
  },
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => {
    ipcRenderer.on('idle-behavior', (_event, data) => callback(data));
  },
  onPetUiVisibility: (callback: (data: { chatbarOpen: boolean; petChatOpen: boolean; assistantOpen: boolean }) => void) => {
    ipcRenderer.on('pet-ui-visibility', (_event, data) => callback(data));
  },
  onChatSync: (callback: () => void) => {
    return onIpcNoArgs('chat-sync', callback);
  },
  onSwitchToChat: (callback: () => void) => {
    return onIpcNoArgs('switch-to-chat', callback);
  },
  onSwitchToSettings: (callback: () => void) => {
    return onIpcNoArgs('switch-to-settings', callback);
  },

  // Pet interactions
  petClicked: () => ipcRenderer.send('pet-clicked'),
  showPetContextMenu: (x: number, y: number) => ipcRenderer.send('show-pet-context-menu', { x, y }),
  hidePetContextMenu: () => ipcRenderer.send('hide-pet-context-menu'),
  petContextMenuAction: (action: 'chat' | 'settings' | 'workspace' | 'quit') => ipcRenderer.send('pet-context-menu-action', action),

  // Tutorial
  tutorialPetClicked: () => ipcRenderer.send('tutorial-pet-clicked'),
  tutorialNext: () => ipcRenderer.send('tutorial-next'),
  tutorialSkip: () => ipcRenderer.send('tutorial-skip'),
  tutorialResume: () => ipcRenderer.send('tutorial-resume'),
  tutorialStartOver: () => ipcRenderer.send('tutorial-start-over'),
  tutorialOpenPanel: () => ipcRenderer.send('tutorial-open-panel'),
  replayTutorial: () => ipcRenderer.invoke('replay-tutorial'),
  getTutorialStatus: () => ipcRenderer.invoke('get-tutorial-status'),
  onTutorialStep: (callback: (data: { step: number; copy: string; totalSteps: number }) => void) => {
    ipcRenderer.on('tutorial-step', (_event, data) => callback(data));
  },
  onTutorialHint: (callback: (data: { step: number; hintType: string }) => void) => {
    ipcRenderer.on('tutorial-hint', (_event, data) => callback(data));
  },
  onTutorialEnded: (callback: (data: { skipped: boolean }) => void) => {
    ipcRenderer.on('tutorial-ended', (_event, data) => callback(data));
  },
  onTutorialResumePrompt: (callback: () => void) => {
    ipcRenderer.on('tutorial-resume-prompt', () => callback());
  },

  // Onboarding
  onboardingSkip: () => ipcRenderer.invoke('onboarding-skip'),
  onboardingComplete: (data: {
    launchOnStartup: boolean;
    hotkeyOpenChat: string;
    personalityPreset: string;
  }) => ipcRenderer.invoke('onboarding-complete', data),
  getDefaultPersonality: () => ipcRenderer.invoke('get-default-personality'),
  getOnboardingStatus: () => ipcRenderer.invoke('get-onboarding-status'),
  resetOnboarding: () => ipcRenderer.invoke('reset-onboarding'),

  // Personality presets (onboarding + Settings picker)
  getPersonalityPresets: () => ipcRenderer.invoke('get-personality-presets'),
  getPersonalityPreset: () => ipcRenderer.invoke('get-personality-preset'),
  setPersonalityPreset: (id: string) => ipcRenderer.invoke('set-personality-preset', id),
  openPersonalityFolder: () => ipcRenderer.invoke('open-personality-folder'),

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('activity-event');
    ipcRenderer.removeAllListeners('clawbot-suggestion');
    ipcRenderer.removeAllListeners('clawbot-mood');
    ipcRenderer.removeAllListeners('clawbot-connection-changed');
    ipcRenderer.removeAllListeners('clawbot-stream-chunk');
    ipcRenderer.removeAllListeners('clawbot-stream-end');
    ipcRenderer.removeAllListeners('clawbot-stream-error');
    ipcRenderer.removeAllListeners('chat-popup');
    ipcRenderer.removeAllListeners('pet-moving');
    ipcRenderer.removeAllListeners('pet-camera-snap');
    ipcRenderer.removeAllListeners('pet-transparent-sleep-changed');
    ipcRenderer.removeAllListeners('pet-muted-changed');
    ipcRenderer.removeAllListeners('dev-show-pet-mode-overlay-changed');
    ipcRenderer.removeAllListeners('idle-behavior');
    ipcRenderer.removeAllListeners('pet-ui-visibility');
    ipcRenderer.removeAllListeners('chat-sync');
    ipcRenderer.removeAllListeners('switch-to-chat');
    ipcRenderer.removeAllListeners('switch-to-settings');
    ipcRenderer.removeAllListeners('tutorial-step');
    ipcRenderer.removeAllListeners('tutorial-hint');
    ipcRenderer.removeAllListeners('tutorial-ended');
    ipcRenderer.removeAllListeners('tutorial-resume-prompt');
    ipcRenderer.removeAllListeners('speech-result');
    ipcRenderer.removeAllListeners('speech-error');
    ipcRenderer.removeAllListeners('pet-mouth-shape');
    ipcRenderer.removeAllListeners('chat-message');
    ipcRenderer.removeAllListeners('pet-chat-reply');
    ipcRenderer.removeAllListeners('pet-chat-hidden');
  },
});

// TypeScript types for the exposed API
export interface PetAction {
  type: 'set_mood' | 'move_to' | 'move_to_cursor' | 'snip' | 'wave';
  value?: string;
  x?: number;
  y?: number;
  duration?: number;
}

export interface ScreenContext {
  cursor: { x: number; y: number };
  petPosition: { x: number; y: number };
  screenSize: { width: number; height: number };
  image?: string;
}

export interface OnboardingData {
  launchOnStartup: boolean;
  hotkeyOpenChat: string;
  personalityPreset: string;
}

export interface PersonalityPreset {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
}

export interface ClawsterAPI {
  toggleAssistant: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  forcePetSleep: () => void;
  forceActiveAppComment: () => Promise<boolean>;
  toggleChatbar: () => void;
  closeChatbar: () => void;
  setChatbarIgnoreMouse: (ignore: boolean) => void;
  toggleScreenshotQuestion: () => void;
  closeScreenshotQuestion: () => void;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  dragPet: (deltaX: number, deltaY: number) => void;
  petDragTakeOver: () => void;
  showPetChat: (message: { id: string; text: string; quickReplies?: string[] }) => void;
  hidePetChat: () => void;
  resizePetChat: (width: number, height: number) => void;
  petChatInteracted: () => void;
  onPetChatMessage: (callback: (message: { id: string; text: string; quickReplies?: string[] }) => void) => ListenerCleanup;
  onPetChatHidden: (callback: () => void) => ListenerCleanup;
  petChatReply: (reply: string) => void;
  onPetChatReply: (callback: (reply: string) => void) => ListenerCleanup;
  openExternal: (url: string) => void;
  openPath: (path: string) => void;
  getSettings: () => Promise<unknown>;
  updateSettings: (key: string, value: unknown) => Promise<unknown>;
  getChatHistory: () => Promise<unknown[]>;
  saveChatHistory: (messages: unknown[], sessionId?: string) => Promise<boolean>;
  appendChatMessages: (messages: unknown[], sessionId?: string) => Promise<boolean>;
  clearChatHistory: () => Promise<boolean>;
  listSessions: () => Promise<{ sessions: SessionMeta[]; activeId: string }>;
  createSession: () => Promise<SessionMeta>;
  switchSession: (id: string) => Promise<unknown[] | null>;
  deleteSession: (id: string) => Promise<{ activeId: string }>;
  renameSession: (id: string, title: string) => Promise<boolean>;
  notifyChatSync: () => void;
  captureScreen: () => Promise<string | null>;
  captureScreenWithContext: () => Promise<ScreenContext | null>;
  getScreenContext: () => Promise<ScreenContext>;
  getScreenCapturePermission: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted'>;
  checkAccessibilityPermission: (prompt?: boolean) => Promise<boolean>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  startClawbotStream: (message: string, includeScreen?: boolean) => Promise<{ requestId?: string; error?: string }>;
  getClawbotStatus: () => Promise<{ connected: boolean; error: string | null }>;
  onConnectionStatusChange: (callback: (status: { connected: boolean; error: string | null }) => void) => ListenerCleanup;
  onClawbotStreamChunk: (callback: (data: { requestId: string; delta: string; text: string }) => void) => ListenerCleanup;
  onClawbotStreamEnd: (callback: (data: { requestId: string; response: unknown }) => void) => ListenerCleanup;
  onClawbotStreamError: (callback: (data: { requestId: string; error: string }) => void) => ListenerCleanup;
  sendMouthShape: (shape: string | null) => void;
  onMouthShape: (callback: (shape: string | null) => void) => ListenerCleanup;
  startSpeechRecognition: () => Promise<{ success: boolean; error?: string }>;
  stopSpeechRecognition: () => Promise<void>;
  checkSpeechPermission: () => Promise<{ mic: string; speech: string }>;
  onSpeechResult: (callback: (data: { type: 'partial' | 'final'; text: string }) => void) => ListenerCleanup;
  onSpeechError: (callback: (data: { type: 'error'; message: string }) => void) => ListenerCleanup;
  copyToClipboard: (text: string) => Promise<boolean>;
  executePetAction: (action: PetAction) => Promise<{ completed: boolean }>;
  movePetTo: (x: number, y: number, duration?: number) => Promise<{ completed: boolean }>;
  movePetToCursor: () => Promise<{ completed: boolean }>;
  getCursorPosition: () => Promise<{ x: number; y: number }>;
  getPetPosition: () => Promise<[number, number]>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  onChatPopup: (callback: (data: unknown) => void) => void;
  onPetMoving: (callback: (data: { moving: boolean }) => void) => void;
  onPetCameraSnap: (callback: (data: { captureAtMs: number; durationMs: number; flashDurationMs: number }) => void) => void;
  onPetTransparentSleepChanged: (callback: (enabled: boolean) => void) => void;
  onPetMutedChanged: (callback: (muted: boolean) => void) => void;
  onDevShowPetModeOverlayChanged: (callback: (enabled: boolean) => void) => void;
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  onPetUiVisibility: (callback: (data: { chatbarOpen: boolean; petChatOpen: boolean; assistantOpen: boolean }) => void) => void;
  onChatSync: (callback: () => void) => ListenerCleanup;
  onSwitchToChat: (callback: () => void) => ListenerCleanup;
  onSwitchToSettings: (callback: () => void) => ListenerCleanup;
  petClicked: () => void;
  showPetContextMenu: (x: number, y: number) => void;
  hidePetContextMenu: () => void;
  petContextMenuAction: (action: 'chat' | 'settings' | 'quit') => void;
  // Tutorial
  tutorialPetClicked: () => void;
  tutorialNext: () => void;
  tutorialSkip: () => void;
  tutorialResume: () => void;
  tutorialStartOver: () => void;
  tutorialOpenPanel: () => void;
  replayTutorial: () => Promise<boolean>;
  getTutorialStatus: () => Promise<{ isActive: boolean; currentStep: number | null; completed: boolean }>;
  onTutorialStep: (callback: (data: { step: number; copy: string; totalSteps: number }) => void) => void;
  onTutorialHint: (callback: (data: { step: number; hintType: string }) => void) => void;
  onTutorialEnded: (callback: (data: { skipped: boolean }) => void) => void;
  onTutorialResumePrompt: (callback: () => void) => void;
  // Onboarding
  onboardingSkip: () => Promise<boolean>;
  onboardingComplete: (data: OnboardingData) => Promise<boolean>;
  getDefaultPersonality: () => Promise<{ identity: string; soul: string }>;
  getOnboardingStatus: () => Promise<{ completed: boolean; skipped: boolean }>;
  resetOnboarding: () => Promise<boolean>;
  getPersonalityPresets: () => Promise<PersonalityPreset[]>;
  getPersonalityPreset: () => Promise<string>;
  setPersonalityPreset: (id: string) => Promise<{ ok: boolean }>;
  openPersonalityFolder: () => Promise<boolean>;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    clawster: ClawsterAPI;
  }
}
