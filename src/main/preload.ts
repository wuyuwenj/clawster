import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('clawster', {
  // Window controls
  toggleAssistant: () => ipcRenderer.send('toggle-assistant'),
  closeAssistant: () => ipcRenderer.send('close-assistant'),
  toggleChatbar: () => ipcRenderer.send('toggle-chatbar'),
  closeChatbar: () => ipcRenderer.send('close-chatbar'),
  setChatbarIgnoreMouse: (ignore: boolean) => ipcRenderer.send('chatbar-set-ignore-mouse', ignore),
  toggleScreenshotQuestion: () => ipcRenderer.send('toggle-screenshot-question'),
  closeScreenshotQuestion: () => ipcRenderer.send('close-screenshot-question'),
  askAboutScreen: (question: string, imageDataUrl: string) =>
    ipcRenderer.invoke('ask-about-screen', question, imageDataUrl),

  // Pet dragging
  dragPet: (deltaX: number, deltaY: number) => ipcRenderer.send('pet-drag', deltaX, deltaY),
  // Pet chat popup
  showPetChat: (message: { id: string; text: string; quickReplies?: string[] }) =>
    ipcRenderer.send('show-pet-chat', message),
  hidePetChat: () => ipcRenderer.send('hide-pet-chat'),
  onPetChatMessage: (callback: (message: { id: string; text: string; quickReplies?: string[] }) => void) => {
    ipcRenderer.on('chat-message', (_event, message) => callback(message));
  },
  petChatReply: (reply: string) => ipcRenderer.send('pet-chat-reply', reply),
  onPetChatReply: (callback: (reply: string) => void) => {
    ipcRenderer.on('pet-chat-reply', (_event, reply) => callback(reply));
  },

  // External actions
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  openPath: (path: string) => ipcRenderer.send('open-path', path),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (key: string, value: unknown) => ipcRenderer.invoke('update-settings', key, value),

  // Chat history
  getChatHistory: () => ipcRenderer.invoke('get-chat-history'),
  saveChatHistory: (messages: unknown[]) => ipcRenderer.invoke('save-chat-history', messages),
  clearChatHistory: () => ipcRenderer.invoke('clear-chat-history'),
  notifyChatSync: () => ipcRenderer.send('chat-sync'),

  // Screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureScreenWithContext: () => ipcRenderer.invoke('capture-screen-with-context'),
  getScreenContext: () => ipcRenderer.invoke('get-screen-context'),

  // ClawBot
  sendToClawbot: (message: string, includeScreen?: boolean) =>
    ipcRenderer.invoke('send-to-clawbot', message, includeScreen),
  getClawbotStatus: () => ipcRenderer.invoke('clawbot-status'),

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
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => {
    ipcRenderer.on('idle-behavior', (_event, data) => callback(data));
  },
  onChatSync: (callback: () => void) => {
    ipcRenderer.on('chat-sync', () => callback());
  },

  // Pet interactions
  petClicked: () => ipcRenderer.send('pet-clicked'),

  // Onboarding
  onboardingSkip: () => ipcRenderer.invoke('onboarding-skip'),
  onboardingComplete: (data: {
    workspaceType: 'openclaw' | 'clawster';
    migrateMemory: boolean;
    gatewayUrl: string;
    gatewayToken: string;
    identity: string;
    soul: string;
    watchFolders: string[];
    watchActiveApp: boolean;
    watchWindowTitles: boolean;
  }) => ipcRenderer.invoke('onboarding-complete', data),
  readOpenClawConfig: () => ipcRenderer.invoke('read-openclaw-config'),
  readOpenClawWorkspace: () => ipcRenderer.invoke('read-openclaw-workspace'),
  createClawsterWorkspace: (options: {
    identity: string;
    soul: string;
    migrateMemory: boolean;
  }) => ipcRenderer.invoke('create-clawster-workspace', options),
  validateGateway: (url: string, token: string) =>
    ipcRenderer.invoke('validate-gateway', url, token),
  getDefaultPersonality: () => ipcRenderer.invoke('get-default-personality'),
  savePersonality: (workspacePath: string, identity: string, soul: string) =>
    ipcRenderer.invoke('save-personality', workspacePath, identity, soul),
  getOnboardingStatus: () => ipcRenderer.invoke('get-onboarding-status'),

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('activity-event');
    ipcRenderer.removeAllListeners('clawbot-suggestion');
    ipcRenderer.removeAllListeners('clawbot-mood');
    ipcRenderer.removeAllListeners('chat-popup');
    ipcRenderer.removeAllListeners('pet-moving');
    ipcRenderer.removeAllListeners('idle-behavior');
    ipcRenderer.removeAllListeners('chat-sync');
  },
});

// TypeScript types for the exposed API
export interface PetAction {
  type: 'set_mood' | 'move_to' | 'move_to_cursor' | 'snip' | 'wave' | 'look_at';
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
  workspaceType: 'openclaw' | 'clawster';
  migrateMemory: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  identity: string;
  soul: string;
  watchFolders: string[];
  watchActiveApp: boolean;
  watchWindowTitles: boolean;
}

export interface OpenClawWorkspace {
  exists: boolean;
  identity: string | null;
  soul: string | null;
  hasMemory: boolean;
}

export interface ClawsterAPI {
  toggleAssistant: () => void;
  closeAssistant: () => void;
  toggleChatbar: () => void;
  closeChatbar: () => void;
  setChatbarIgnoreMouse: (ignore: boolean) => void;
  toggleScreenshotQuestion: () => void;
  closeScreenshotQuestion: () => void;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  dragPet: (deltaX: number, deltaY: number) => void;
  showPetChat: (message: { id: string; text: string; quickReplies?: string[] }) => void;
  hidePetChat: () => void;
  onPetChatMessage: (callback: (message: { id: string; text: string; quickReplies?: string[] }) => void) => void;
  petChatReply: (reply: string) => void;
  onPetChatReply: (callback: (reply: string) => void) => void;
  openExternal: (url: string) => void;
  openPath: (path: string) => void;
  getSettings: () => Promise<unknown>;
  updateSettings: (key: string, value: unknown) => Promise<unknown>;
  getChatHistory: () => Promise<unknown[]>;
  saveChatHistory: (messages: unknown[]) => Promise<boolean>;
  clearChatHistory: () => Promise<boolean>;
  notifyChatSync: () => void;
  captureScreen: () => Promise<string | null>;
  captureScreenWithContext: () => Promise<ScreenContext | null>;
  getScreenContext: () => Promise<ScreenContext>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
  executePetAction: (action: PetAction) => Promise<void>;
  movePetTo: (x: number, y: number, duration?: number) => Promise<void>;
  movePetToCursor: () => Promise<void>;
  getCursorPosition: () => Promise<{ x: number; y: number }>;
  getPetPosition: () => Promise<[number, number]>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  onChatPopup: (callback: (data: unknown) => void) => void;
  onPetMoving: (callback: (data: { moving: boolean }) => void) => void;
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  onChatSync: (callback: () => void) => void;
  petClicked: () => void;
  // Onboarding
  onboardingSkip: () => Promise<boolean>;
  onboardingComplete: (data: OnboardingData) => Promise<boolean>;
  readOpenClawConfig: () => Promise<{ gateway?: { port?: number; auth?: { token?: string } } } | null>;
  readOpenClawWorkspace: () => Promise<OpenClawWorkspace>;
  createClawsterWorkspace: (options: {
    identity: string;
    soul: string;
    migrateMemory: boolean;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  validateGateway: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
  getDefaultPersonality: () => Promise<{ identity: string; soul: string }>;
  savePersonality: (workspacePath: string, identity: string, soul: string) => Promise<{ success: boolean; error?: string }>;
  getOnboardingStatus: () => Promise<{ completed: boolean; skipped: boolean }>;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    clawster: ClawsterAPI;
  }
}
