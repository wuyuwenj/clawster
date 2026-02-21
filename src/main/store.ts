import Store from 'electron-store';

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
};

export function createStore(): Store<StoreSchema> {
  return new Store<StoreSchema>({
    defaults,
    name: 'clawster-config',
  });
}

export type { StoreSchema };
