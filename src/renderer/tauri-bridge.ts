/**
 * Tauri IPC bridge - replaces Electron preload.ts
 * Provides the same window.clawster API using Tauri invoke() and listen()
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';

// Type imports matching the Electron preload types
interface PetAction {
  type: 'set_mood' | 'move_to' | 'move_to_cursor' | 'snip' | 'wave' | 'look_at';
  value?: string;
  x?: number;
  y?: number;
  duration?: number;
}

interface ScreenContext {
  cursor: { x: number; y: number };
  petPosition: { x: number; y: number };
  screenSize: { width: number; height: number };
  image?: string;
}

interface OnboardingData {
  workspaceType: 'openclaw' | 'clawster';
  migrateMemory: boolean;
  launchOnStartup: boolean;
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
}

interface OpenClawWorkspace {
  exists: boolean;
  identity: string | null;
  soul: string | null;
  hasMemory: boolean;
}

interface CurrentWorkspaceInfo {
  workspaceType: 'openclaw' | 'clawster' | null;
  workspacePath: string | null;
  exists: boolean;
}

interface WorkspaceEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
}

interface WorkspaceDirectoryResult {
  success: boolean;
  currentPath: string;
  entries: WorkspaceEntry[];
  error?: string;
}

interface WorkspaceOpenResult {
  success: boolean;
  error?: string;
  message?: string;
}

interface WorkspacePreviewResult {
  success: boolean;
  path: string;
  previewKind?: 'markdown' | 'image' | 'json';
  content?: string;
  error?: string;
  message?: string;
}

export interface ClawsterAPI {
  toggleAssistant: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  openWorkspaceBrowser: () => void;
  closeWorkspaceBrowser: () => void;
  forcePetSleep: () => void;
  forceActiveAppComment: () => Promise<boolean>;
  toggleChatbar: () => void;
  closeChatbar: () => void;
  setChatbarIgnoreMouse: (ignore: boolean) => void;
  toggleScreenshotQuestion: () => void;
  closeScreenshotQuestion: () => void;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  dragPet: (deltaX: number, deltaY: number) => void;
  showPetChat: (message: { id: string; text: string; quickReplies?: string[] }) => void;
  hidePetChat: () => void;
  resizePetChat: (width: number, height: number) => void;
  petChatInteracted: () => void;
  onPetChatMessage: (callback: (message: { id: string; text: string; quickReplies?: string[] }) => void) => void;
  petChatReply: (reply: string) => void;
  onPetChatReply: (callback: (reply: string) => void) => void;
  openExternal: (url: string) => void;
  openPath: (path: string) => void;
  getCurrentWorkspaceInfo: () => Promise<CurrentWorkspaceInfo>;
  listWorkspaceDirectory: (relativePath?: string) => Promise<WorkspaceDirectoryResult>;
  openWorkspacePath: (relativePath?: string) => Promise<WorkspaceOpenResult>;
  revealWorkspacePath: (relativePath?: string) => Promise<WorkspaceOpenResult>;
  previewWorkspaceFile: (relativePath?: string) => Promise<WorkspacePreviewResult>;
  getSettings: () => Promise<unknown>;
  updateSettings: (key: string, value: unknown) => Promise<unknown>;
  getChatHistory: () => Promise<unknown[]>;
  saveChatHistory: (messages: unknown[]) => Promise<boolean>;
  clearChatHistory: () => Promise<boolean>;
  notifyChatSync: () => void;
  captureScreen: () => Promise<string | null>;
  captureScreenWithContext: () => Promise<ScreenContext | null>;
  getScreenContext: () => Promise<ScreenContext>;
  getScreenCapturePermission: () => Promise<string>;
  checkAccessibilityPermission: (prompt?: boolean) => Promise<boolean>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  startClawbotStream: (message: string, includeScreen?: boolean) => Promise<{ requestId?: string; error?: string }>;
  getClawbotStatus: () => Promise<{ connected: boolean; error: string | null; gatewayUrl: string }>;
  onConnectionStatusChange: (callback: (status: { connected: boolean; error: string | null; gatewayUrl: string }) => void) => void;
  onClawbotStreamChunk: (callback: (data: { requestId: string; delta: string; text: string }) => void) => void;
  onClawbotStreamEnd: (callback: (data: { requestId: string; response: unknown }) => void) => void;
  onClawbotStreamError: (callback: (data: { requestId: string; error: string }) => void) => void;
  copyToClipboard: (text: string) => Promise<boolean>;
  executePetAction: (action: PetAction) => Promise<void>;
  movePetTo: (x: number, y: number, duration?: number) => Promise<void>;
  movePetToCursor: () => Promise<void>;
  getCursorPosition: () => Promise<{ x: number; y: number }>;
  getPetPosition: () => Promise<[number, number]>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  onCronResult: (callback: (data: { jobId: string; jobName: string; status: string; summary: string; timestamp: number }) => void) => void;
  onCronError: (callback: (data: { jobId: string; jobName: string; error: string; timestamp: number }) => void) => void;
  onChatPopup: (callback: (data: unknown) => void) => void;
  onPetMoving: (callback: (data: { moving: boolean }) => void) => void;
  onPetCameraSnap: (callback: (data: { captureAtMs: number; durationMs: number; flashDurationMs: number }) => void) => void;
  onPetTransparentSleepChanged: (callback: (enabled: boolean) => void) => void;
  onDevShowPetModeOverlayChanged: (callback: (enabled: boolean) => void) => void;
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  onChatSync: (callback: () => void) => void;
  onSwitchToChat: (callback: () => void) => void;
  onSwitchToSettings: (callback: () => void) => void;
  petClicked: () => void;
  showPetContextMenu: (x: number, y: number) => void;
  hidePetContextMenu: () => void;
  petContextMenuAction: (action: 'chat' | 'settings' | 'workspace' | 'quit') => void;
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
  readOpenClawConfig: () => Promise<{ gateway?: { port?: number; auth?: { token?: string } } } | null>;
  readOpenClawWorkspace: () => Promise<OpenClawWorkspace>;
  createClawsterWorkspace: (options: { identity: string; soul: string; migrateMemory: boolean }) => Promise<{ success: boolean; path?: string; error?: string }>;
  validateGateway: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
  getDefaultPersonality: () => Promise<{ identity: string; soul: string }>;
  savePersonality: (workspacePath: string, identity: string, soul: string) => Promise<{ success: boolean; error?: string }>;
  getOnboardingStatus: () => Promise<{ completed: boolean; skipped: boolean }>;
  resetOnboarding: () => Promise<boolean>;
  removeAllListeners: () => void;
}

// Store unlisten functions for cleanup
const unlisteners: (() => void)[] = [];

function onEventTracked<T>(event: string, callback: (data: T) => void): void {
  listen<T>(event, (e) => callback(e.payload)).then((unlisten) => {
    unlisteners.push(unlisten);
  });
}

const clawster: ClawsterAPI = {
  // Window controls
  toggleAssistant: () => { invoke('toggle_assistant'); },
  openAssistant: () => { invoke('open_assistant'); },
  closeAssistant: () => { invoke('close_assistant'); },
  openWorkspaceBrowser: () => { invoke('open_workspace_browser'); },
  closeWorkspaceBrowser: () => { invoke('close_workspace_browser'); },
  forcePetSleep: () => { invoke('force_pet_sleep'); },
  forceActiveAppComment: () => invoke('force_active_app_comment'),
  toggleChatbar: () => { invoke('toggle_chatbar'); },
  closeChatbar: () => { invoke('close_chatbar'); },
  setChatbarIgnoreMouse: (ignore) => { invoke('set_chatbar_ignore_mouse', { ignore }); },
  toggleScreenshotQuestion: () => { invoke('toggle_screenshot_question'); },
  closeScreenshotQuestion: () => { invoke('close_screenshot_question'); },
  askAboutScreen: (question, imageDataUrl) => invoke('ask_about_screen', { question, imageDataUrl }),

  // Pet dragging
  dragPet: (deltaX, deltaY) => { invoke('drag_pet', { deltaX, deltaY }); },

  // Pet chat popup
  showPetChat: (message) => { invoke('show_pet_chat', { message }); },
  hidePetChat: () => { invoke('hide_pet_chat'); },
  resizePetChat: (width, height) => { invoke('resize_pet_chat', { width, height }); },
  petChatInteracted: () => { invoke('pet_chat_interacted'); },
  onPetChatMessage: (callback) => { onEventTracked('chat-message', callback); },
  petChatReply: (reply) => { emit('pet-chat-reply', reply); },
  onPetChatReply: (callback) => { onEventTracked('pet-chat-reply', callback); },

  // External actions
  openExternal: (url) => { invoke('open_external', { url }); },
  openPath: (path) => { invoke('open_path', { path }); },
  getCurrentWorkspaceInfo: () => invoke('get_current_workspace_info'),
  listWorkspaceDirectory: (relativePath = '') => invoke('list_workspace_directory', { relativePath }),
  openWorkspacePath: (relativePath = '') => invoke('open_workspace_path', { relativePath }),
  revealWorkspacePath: (relativePath = '') => invoke('reveal_workspace_path', { relativePath }),
  previewWorkspaceFile: (relativePath = '') => invoke('preview_workspace_file', { relativePath }),

  // Settings
  getSettings: () => invoke('get_settings'),
  updateSettings: (key, value) => invoke('update_settings', { key, value }),

  // Chat history
  getChatHistory: () => invoke('get_chat_history'),
  saveChatHistory: (messages) => invoke('save_chat_history', { messages }),
  clearChatHistory: () => invoke('clear_chat_history'),
  notifyChatSync: () => { emit('chat-sync'); },

  // Screen capture
  captureScreen: () => invoke('capture_screen'),
  captureScreenWithContext: () => invoke('capture_screen_with_context'),
  getScreenContext: () => invoke('get_screen_context'),
  getScreenCapturePermission: () => invoke('get_screen_capture_permission'),
  checkAccessibilityPermission: (prompt) => invoke('check_accessibility_permission', { prompt }),

  // ClawBot
  sendToClawbot: (message, includeScreen) => invoke('send_to_clawbot', { message, includeScreen }),
  startClawbotStream: (message, includeScreen) => invoke('start_clawbot_stream', { message, includeScreen }),
  getClawbotStatus: () => invoke('clawbot_status'),
  onConnectionStatusChange: (callback) => { onEventTracked('clawbot-connection-changed', callback); },
  onClawbotStreamChunk: (callback) => { onEventTracked('clawbot-stream-chunk', callback); },
  onClawbotStreamEnd: (callback) => { onEventTracked('clawbot-stream-end', callback); },
  onClawbotStreamError: (callback) => { onEventTracked('clawbot-stream-error', callback); },

  // Clipboard
  copyToClipboard: (text) => invoke('copy_to_clipboard', { text }),

  // Pet actions
  executePetAction: (action) => invoke('execute_pet_action', { action }),
  movePetTo: (x, y, duration) => invoke('move_pet_to', { x, y, duration }),
  movePetToCursor: () => invoke('move_pet_to_cursor'),
  getCursorPosition: () => invoke('get_cursor_position'),
  getPetPosition: () => invoke('get_pet_position'),

  // Events from main process
  onActivityEvent: (callback) => { onEventTracked('activity-event', callback); },
  onClawbotSuggestion: (callback) => { onEventTracked('clawbot-suggestion', callback); },
  onClawbotMood: (callback) => { onEventTracked('clawbot-mood', callback); },
  onCronResult: (callback) => { onEventTracked('cron-result', callback); },
  onCronError: (callback) => { onEventTracked('cron-error', callback); },
  onChatPopup: (callback) => { onEventTracked('chat-popup', callback); },
  onPetMoving: (callback) => { onEventTracked('pet-moving', callback); },
  onPetCameraSnap: (callback) => { onEventTracked('pet-camera-snap', callback); },
  onPetTransparentSleepChanged: (callback) => { onEventTracked('pet-transparent-sleep-changed', callback); },
  onDevShowPetModeOverlayChanged: (callback) => { onEventTracked('dev-show-pet-mode-overlay-changed', callback); },
  onIdleBehavior: (callback) => { onEventTracked('idle-behavior', callback); },
  onChatSync: (callback) => { onEventTracked('chat-sync', callback); },
  onSwitchToChat: (callback) => { onEventTracked('switch-to-chat', callback); },
  onSwitchToSettings: (callback) => { onEventTracked('switch-to-settings', callback); },

  // Pet interactions
  petClicked: () => { invoke('pet_clicked'); },
  showPetContextMenu: (x, y) => { invoke('show_pet_context_menu', { x, y }); },
  hidePetContextMenu: () => { invoke('hide_pet_context_menu'); },
  petContextMenuAction: (action) => { invoke('pet_context_menu_action', { action }); },

  // Tutorial
  tutorialPetClicked: () => { invoke('tutorial_pet_clicked'); },
  tutorialNext: () => { invoke('tutorial_next'); },
  tutorialSkip: () => { invoke('tutorial_skip'); },
  tutorialResume: () => { invoke('tutorial_resume'); },
  tutorialStartOver: () => { invoke('tutorial_start_over'); },
  tutorialOpenPanel: () => { invoke('tutorial_open_panel'); },
  replayTutorial: () => invoke('replay_tutorial'),
  getTutorialStatus: () => invoke('get_tutorial_status'),
  onTutorialStep: (callback) => { onEventTracked('tutorial-step', callback); },
  onTutorialHint: (callback) => { onEventTracked('tutorial-hint', callback); },
  onTutorialEnded: (callback) => { onEventTracked('tutorial-ended', callback); },
  onTutorialResumePrompt: (callback) => { onEventTracked('tutorial-resume-prompt', callback); },

  // Onboarding
  onboardingSkip: () => invoke('onboarding_skip'),
  onboardingComplete: (data) => invoke('onboarding_complete', { data }),
  readOpenClawConfig: () => invoke('read_openclaw_config'),
  readOpenClawWorkspace: () => invoke('read_openclaw_workspace'),
  createClawsterWorkspace: (options) => invoke('create_clawster_workspace', { options }),
  validateGateway: (url, token) => invoke('validate_gateway', { url, token }),
  getDefaultPersonality: () => invoke('get_default_personality'),
  savePersonality: (workspacePath, identity, soul) => invoke('save_personality', { workspacePath, identity, soul }),
  getOnboardingStatus: () => invoke('get_onboarding_status'),
  resetOnboarding: () => invoke('reset_onboarding'),

  // Cleanup
  removeAllListeners: () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
    unlisteners.length = 0;
  },
};

// Expose to window.clawster for compatibility with existing React components
(window as any).clawster = clawster;

export default clawster;
