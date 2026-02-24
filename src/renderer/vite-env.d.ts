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

interface ClawsterAPI {
  toggleAssistant: () => void;
  closeAssistant: () => void;
  toggleChatbar: () => void;
  closeChatbar: () => void;
  toggleScreenshotQuestion: () => void;
  closeScreenshotQuestion: () => void;
  dragPet: (deltaX: number, deltaY: number) => void;
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
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
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
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  onChatSync: (callback: () => void) => void;
  petClicked: () => void;
  removeAllListeners: () => void;
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
}

interface Window {
  clawster: ClawsterAPI;
}
