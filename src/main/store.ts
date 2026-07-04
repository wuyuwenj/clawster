import Store from 'electron-store';
import { clawsterDataDir, isTestDataDir } from './paths';
import type { ChatSession } from './chat/sessions';

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
    browserUrl: boolean;
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
  chatHistory: ChatMessage[]; // legacy — migrated into `sessions` on first access (CLA-33)
  sessions: ChatSession[];
  activeSessionId: string | null;
  onboarding: OnboardingState;
  personality: {
    preset: string;
  };
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
    // Off by default — we never ask for Accessibility upfront. Users opt in
    // from Settings, where the inline permission flow explains why.
    activeApp: false,
    sendWindowTitles: false,
    browserUrl: false,
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
  sessions: [],
  activeSessionId: null,
  onboarding: {
    completed: false,
    skipped: false,
  },
  personality: {
    preset: 'chill',
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
