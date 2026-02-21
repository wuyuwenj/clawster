import Store from 'electron-store';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
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
  chatHistory: ChatMessage[];
}

const defaults: StoreSchema = {
  clawbot: {
    url: 'http://127.0.0.1:18789',
    token: '',
  },
  watch: {
    activeApp: true,
    sendWindowTitles: false,
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
  chatHistory: [],
};

export function createStore(): Store<StoreSchema> {
  return new Store<StoreSchema>({
    defaults,
    name: 'clawster-config',
  });
}

export type { StoreSchema };
