import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('clawster', {
  // Window controls
  toggleAssistant: () => ipcRenderer.send('toggle-assistant'),
  closeAssistant: () => ipcRenderer.send('close-assistant'),
  toggleChatbar: () => ipcRenderer.send('toggle-chatbar'),
  closeChatbar: () => ipcRenderer.send('close-chatbar'),

  // Pet dragging
  dragPet: (deltaX: number, deltaY: number) => ipcRenderer.send('pet-drag', deltaX, deltaY),

  // External actions
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  openPath: (path: string) => ipcRenderer.send('open-path', path),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (key: string, value: unknown) => ipcRenderer.invoke('update-settings', key, value),

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

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('activity-event');
    ipcRenderer.removeAllListeners('clawbot-suggestion');
    ipcRenderer.removeAllListeners('clawbot-mood');
    ipcRenderer.removeAllListeners('chat-popup');
    ipcRenderer.removeAllListeners('pet-moving');
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

export interface ClawsterAPI {
  toggleAssistant: () => void;
  closeAssistant: () => void;
  toggleChatbar: () => void;
  closeChatbar: () => void;
  dragPet: (deltaX: number, deltaY: number) => void;
  openExternal: (url: string) => void;
  openPath: (path: string) => void;
  getSettings: () => Promise<unknown>;
  updateSettings: (key: string, value: unknown) => Promise<unknown>;
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
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    clawster: ClawsterAPI;
  }
}
