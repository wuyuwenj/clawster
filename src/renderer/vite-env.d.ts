/// <reference types="vite/client" />

interface ScreenContext {
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
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
  captureScreen: () => Promise<string | null>;
  captureScreenWithContext: () => Promise<ScreenContext | null>;
  getScreenContext: () => Promise<unknown>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
  executePetAction: (action: unknown) => Promise<void>;
  movePetTo: (x: number, y: number, duration?: number) => Promise<void>;
  movePetToCursor: () => Promise<void>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  onChatPopup: (callback: (data: unknown) => void) => void;
  onPetMoving: (callback: (data: { moving: boolean }) => void) => void;
  onIdleBehavior: (callback: (data: { type: string; direction?: string }) => void) => void;
  petClicked: () => void;
  removeAllListeners: () => void;
}

interface Window {
  clawster: ClawsterAPI;
}
