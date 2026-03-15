/// <reference types="vite/client" />

// Iconify icon web component
declare namespace JSX {
  interface IntrinsicElements {
    'iconify-icon': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        icon: string;
        width?: string;
        height?: string;
        flip?: string;
        rotate?: string;
      },
      HTMLElement
    >;
  }
}

interface ScreenContext {
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
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

interface RelayAgentStatus {
  state: 'idle' | 'unpaired' | 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'error';
  paired: boolean;
  pairingRequired: boolean;
  relayConnected: boolean;
  credentialStorage: 'encrypted' | 'plaintext' | 'unavailable';
  deviceId: string | null;
  deviceName: string;
  relayAgentId: string | null;
  relayHttpBaseUrl: string;
  relayAgentWebSocketUrl: string;
  lastError: string | null;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
  activeTaskId: string | null;
  activeCommand: string | null;
  activeTaskStartedAt: number | null;
  lastCommand: string | null;
  lastTaskState: 'idle' | 'running' | 'success' | 'error';
  lastTaskResult: string | null;
  lastTaskFinishedAt: number | null;
  pairingChallengeState: 'idle' | 'creating' | 'waiting_for_scan' | 'claimed' | 'exchanging' | 'expired' | 'error';
  pairingChallengeId: string | null;
  pairingChallengeQrDataUrl: string | null;
  pairingChallengeUrl: string | null;
  pairingChallengeExpiresAt: number | null;
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
  error?: 'missing_workspace' | 'path_not_found' | 'outside_workspace' | 'not_directory' | 'open_failed';
}

interface WorkspaceOpenResult {
  success: boolean;
  error?: 'missing_workspace' | 'path_not_found' | 'outside_workspace' | 'not_directory' | 'open_failed';
  message?: string;
}

interface WorkspacePreviewResult {
  success: boolean;
  path: string;
  previewKind?: 'markdown' | 'image' | 'json';
  content?: string;
  error?: 'missing_workspace' | 'path_not_found' | 'outside_workspace' | 'not_directory' | 'open_failed' | 'not_file' | 'unsupported_preview' | 'file_too_large' | 'read_failed';
  message?: string;
}

interface ClawsterAPI {
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
  getScreenContext: () => Promise<unknown>;
  getScreenCapturePermission: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted'>;
  checkAccessibilityPermission: (prompt?: boolean) => Promise<boolean>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  startClawbotStream: (message: string, includeScreen?: boolean) => Promise<{ requestId?: string; error?: string }>;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<{ connected: boolean; error: string | null; gatewayUrl: string }>;
  onConnectionStatusChange: (callback: (status: { connected: boolean; error: string | null; gatewayUrl: string }) => void) => void;
  getRelayAgentStatus: () => Promise<RelayAgentStatus>;
  createRelayAgentPairingChallenge: () => Promise<{ success: boolean; error?: string; status?: RelayAgentStatus }>;
  pairRelayAgent: (pairingCode: string) => Promise<{ success: boolean; error?: string; status?: RelayAgentStatus }>;
  retryRelayAgent: () => Promise<{ success: boolean; error?: string; status?: RelayAgentStatus }>;
  clearRelayAgentPairing: () => Promise<{ success: boolean; error?: string; status?: RelayAgentStatus }>;
  onRelayAgentStatusChange: (callback: (status: RelayAgentStatus) => void) => void;
  onClawbotStreamChunk: (callback: (data: { requestId: string; delta: string; text: string }) => void) => void;
  onClawbotStreamEnd: (callback: (data: { requestId: string; response: unknown }) => void) => void;
  onClawbotStreamError: (callback: (data: { requestId: string; error: string }) => void) => void;
  copyToClipboard: (text: string) => Promise<boolean>;
  executePetAction: (action: unknown) => Promise<void>;
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
  petContextMenuAction: (action: 'chat' | 'settings' | 'workspace') => void;
  removeAllListeners: () => void;
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
  createClawsterWorkspace: (options: {
    identity: string;
    soul: string;
    migrateMemory: boolean;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  validateGateway: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
  getDefaultPersonality: () => Promise<{ identity: string; soul: string }>;
  savePersonality: (workspacePath: string, identity: string, soul: string) => Promise<{ success: boolean; error?: string }>;
  getOnboardingStatus: () => Promise<{ completed: boolean; skipped: boolean }>;
  resetOnboarding: () => Promise<boolean>;
}

interface Window {
  clawster: ClawsterAPI;
}
