import Store from 'electron-store';
import { clawsterDataDir, isTestDataDir } from './paths';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface OnboardingState {
  completed: boolean;
  skipped: boolean;
}

interface TutorialState {
  version: number;
  completedAt: string | null;  // ISO timestamp
  wasInterrupted: boolean;     // For resume prompt
  lastStep: number;
}

interface StoreSchema {
  clawbot: {
    url: string;
    deviceId?: string;
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
    transparentWhenSleeping: boolean;
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
  tutorial: TutorialState;
  dev: {
    windowBorders: boolean;
    showPetModeOverlay: boolean;
  };
  permissionDeclines: Record<string, number>;
  analytics: {
    enabled: boolean;
  };
}

const defaults: StoreSchema = {
  clawbot: {
    url: 'https://clawster-proxy.clawster-app.workers.dev',
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
    transparentWhenSleeping: false,
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
  },
  tutorial: {
    version: 1,
    completedAt: null,
    wasInterrupted: false,
    lastStep: 0,
  },
  dev: {
    windowBorders: false,
    showPetModeOverlay: false,
  },
  permissionDeclines: {},
  analytics: {
    enabled: true,
  },
};

export function createStore(): Store<StoreSchema> {
  return new Store<StoreSchema>({
    defaults,
    name: 'clawster-config',
    // In test runs (CLAWSTER_DATA_DIR set) keep the config alongside the rest of
    // the isolated data so a fresh directory means a fresh, un-onboarded user.
    ...(isTestDataDir() ? { cwd: clawsterDataDir() } : {}),
  });
}

export type { StoreSchema, OnboardingState, TutorialState };
