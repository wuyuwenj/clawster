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

  // ClawBot
  sendToClawbot: (message: string) => ipcRenderer.invoke('send-to-clawbot', message),
  getClawbotStatus: () => ipcRenderer.invoke('clawbot-status'),

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

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('activity-event');
    ipcRenderer.removeAllListeners('clawbot-suggestion');
    ipcRenderer.removeAllListeners('clawbot-mood');
  },
});

// TypeScript types for the exposed API
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
  sendToClawbot: (message: string) => Promise<unknown>;
  getClawbotStatus: () => Promise<boolean>;
  onActivityEvent: (callback: (event: unknown) => void) => void;
  onClawbotSuggestion: (callback: (data: unknown) => void) => void;
  onClawbotMood: (callback: (data: unknown) => void) => void;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    clawster: ClawsterAPI;
  }
}
