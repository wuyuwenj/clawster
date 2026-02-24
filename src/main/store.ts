import Store from 'electron-store';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface OnboardingState {
  completed: boolean;
  skipped: boolean;
  workspaceType: 'openclaw' | 'clawster' | null;
  clawsterWorkspacePath: string | null;
  memoryMigrated: boolean;
}

interface StoreSchema {
  clawbot: {
    url: string;
    token: string;
  };
  watch: {
    activeApp: boolean;
    sendWindowTitles: boolean;
    folders: string[];
  };
  pet: {
    position: { x: number; y: number } | null;
    mood: string;
    attentionSeeker: boolean;
  };
  screenCapture: {
    enabled: boolean;
    autoAnalyze: boolean;
  };
  hotkeys: {
    openChat: string;
    captureScreen: string;
    openAssistant: string;
  };
  chatHistory: ChatMessage[];
  onboarding: OnboardingState;
}

const defaults: StoreSchema = {
  clawbot: {
    url: 'http://127.0.0.1:18789',
    token: '',
  },
  watch: {
    activeApp: true,
    sendWindowTitles: true,
    folders: [],
  },
  pet: {
    position: null,
    mood: 'idle',
    attentionSeeker: true,
  },
  screenCapture: {
    enabled: false,
    autoAnalyze: false,
  },
  hotkeys: {
    openChat: 'CommandOrControl+Shift+Space',
    captureScreen: 'CommandOrControl+Shift+/',
    openAssistant: 'CommandOrControl+Shift+A',
  },
  chatHistory: [],
  onboarding: {
    completed: false,
    skipped: false,
    workspaceType: null,
    clawsterWorkspacePath: null,
    memoryMigrated: false,
  },
};

export function createStore(): Store<StoreSchema> {
  return new Store<StoreSchema>({
    defaults,
    name: 'clawster-config',
  });
}

export type { StoreSchema, OnboardingState };
