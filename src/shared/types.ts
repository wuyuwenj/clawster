// Shared types between main and renderer processes

export interface ActivityEvent {
  type: 'app_focus_changed' | 'file_added' | 'file_changed' | 'file_deleted';
  app?: string;
  title?: string;
  path?: string;
  filename?: string;
  at: number;
}

export interface ClawBotResponse {
  type: 'message' | 'suggestion' | 'action';
  text?: string;
  action?: {
    type: string;
    payload: unknown;
  };
}

export type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited';
