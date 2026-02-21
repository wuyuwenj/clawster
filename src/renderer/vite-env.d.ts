/// <reference types="vite/client" />

interface ClawsterAPI {
  toggleAssistant: () => void;
  closeAssistant: () => void;
  dragPet: (deltaX: number, deltaY: number) => void;
  openExternal: (url: string) => void;
  openPath: (path: string) => void;
  getSettings: () => Promise<unknown>;
  updateSettings: (key: string, value: unknown) => Promise<unknown>;
  captureScreen: () => Promise<string | null>;
  sendToClawbot: (message: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  removeAllListeners: () => void;
}

interface Window {
  clawster: ClawsterAPI;
}
