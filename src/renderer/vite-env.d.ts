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
  captureScreen: () => Promise<string | null>;
  captureScreenWithContext: () => Promise<ScreenContext | null>;
  sendToClawbot: (message: string, includeScreen?: boolean) => Promise<unknown>;
  askAboutScreen: (question: string, imageDataUrl: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  removeAllListeners: () => void;
}

interface Window {
  clawster: ClawsterAPI;
}
