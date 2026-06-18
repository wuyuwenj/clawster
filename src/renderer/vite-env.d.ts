/// <reference types="vite/client" />

type ListenerCleanup = () => void;

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
  launchOnStartup: boolean;
  identity: string;
  soul: string;
  watchFolders: string[];
  watchActiveApp: boolean;
  watchWindowTitles: boolean;
  hotkeyOpenChat: string;
  hotkeyCaptureScreen: string;
  hotkeyOpenAssistant: string;
}

interface ClawsterAPI {
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
  dragPet: (deltaX: number, deltaY: number) => void;
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
  getClawbotStatus: () => Promise<{ connected: boolean; error: string | null }>;
  onConnectionStatusChange: (callback: (status: { connected: boolean; error: string | null }) => void) => ListenerCleanup;
  onClawbotStreamChunk: (callback: (data: { requestId: string; delta: string; text: string }) => void) => ListenerCleanup;
  onClawbotStreamEnd: (callback: (data: { requestId: string; response: unknown }) => void) => ListenerCleanup;
  onClawbotStreamError: (callback: (data: { requestId: string; error: string }) => void) => ListenerCleanup;
  sendMouthShape: (shape: string | null) => void;
  onMouthShape: (callback: (shape: string | null) => void) => ListenerCleanup;
  copyToClipboard: (text: string) => Promise<boolean>;
  executePetAction: (action: unknown) => Promise<void>;
  movePetTo: (x: number, y: number, duration?: number) => Promise<void>;
  movePetToCursor: () => Promise<void>;
  getCursorPosition: () => Promise<{ x: number; y: number }>;
  getPetPosition: () => Promise<[number, number]>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  onChatPopup: (callback: (data: unknown) => void) => void;
  onPetMoving: (callback: (data: { moving: boolean }) => void) => void;
  onPetCameraSnap: (callback: (data: { captureAtMs: number; durationMs: number; flashDurationMs: number }) => void) => void;
  onPetTransparentSleepChanged: (callback: (enabled: boolean) => void) => void;
  onDevShowPetModeOverlayChanged: (callback: (enabled: boolean) => void) => void;
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  onChatSync: (callback: () => void) => ListenerCleanup;
  onSwitchToChat: (callback: () => void) => ListenerCleanup;
  onSwitchToSettings: (callback: () => void) => ListenerCleanup;
  petClicked: () => void;
  showPetContextMenu: (x: number, y: number) => void;
  hidePetContextMenu: () => void;
  petContextMenuAction: (action: 'chat' | 'settings' | 'quit') => void;
  removeAllListeners: () => void;
  startSpeechRecognition: () => Promise<{ success: boolean; error?: string }>;
  stopSpeechRecognition: () => Promise<void>;
  checkSpeechPermission: () => Promise<{ mic: string; speech: string }>;
  onSpeechResult: (callback: (data: { type: 'partial' | 'final'; text: string }) => void) => ListenerCleanup;
  onSpeechError: (callback: (data: { type: 'error'; message: string }) => void) => ListenerCleanup;
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
}

interface Window {
  clawster: ClawsterAPI;
}
