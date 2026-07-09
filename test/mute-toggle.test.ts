import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  BrowserWindow: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { Notification } from 'electron';
import { AnimaleseEngine } from '../src/renderer/utils/animalese';
import { createStore } from '../src/main/store';
import { executeTool, setMutedProvider } from '../src/main/chat/tool-executor';

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  static oscillatorStarts = 0;

  state = 'running';
  currentTime = 0;
  destination = {};

  constructor() {
    MockAudioContext.instances.push(this);
  }

  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(() => {
        MockAudioContext.oscillatorStarts += 1;
      }),
      stop: vi.fn(),
    };
  }

  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: {
        setValueAtTime: vi.fn(),
      },
      Q: {
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }

  resume() {
    return Promise.resolve();
  }
}

describe('pet mute setting', () => {
  const originalDataDir = process.env.CLAWSTER_DATA_DIR;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawster-muted-test-'));
    process.env.CLAWSTER_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.CLAWSTER_DATA_DIR;
    } else {
      process.env.CLAWSTER_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults to persisted unmuted audio', () => {
    const store = createStore();

    expect(store.get('pet.muted')).toBe(false);
  });
});

describe('Animalese mute gate', () => {
  let getSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockAudioContext.instances = [];
    MockAudioContext.oscillatorStarts = 0;
    getSettings = vi.fn();
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('window', {
      clawster: { getSettings },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function finishSpeech(promise: Promise<void>) {
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await promise;
  }

  it('does not play synthesized audio when muted but still emits mouth animation', async () => {
    getSettings.mockResolvedValue({ pet: { muted: true } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });
    const visemes: Array<string | null> = [];
    engine.onViseme((shape) => visemes.push(shape));

    const speaking = engine.speak('ab');
    await finishSpeech(speaking);

    expect(MockAudioContext.instances).toHaveLength(0);
    expect(MockAudioContext.oscillatorStarts).toBe(0);
    expect(visemes).toEqual([null, 'happy', 'mad', null]);
  });

  it('plays synthesized audio when unmuted', async () => {
    getSettings.mockResolvedValue({ pet: { muted: false } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });

    const speaking = engine.speak('ab');
    await finishSpeech(speaking);

    expect(MockAudioContext.instances).toHaveLength(1);
    expect(MockAudioContext.oscillatorStarts).toBe(2);
  });

  it('goes quiet mid-utterance when mute is pushed from the main process', async () => {
    getSettings.mockResolvedValue({ pet: { muted: false } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });

    const speaking = engine.speak('abcdefghij');
    await vi.advanceTimersByTimeAsync(3);

    const startsBeforeMute = MockAudioContext.oscillatorStarts;
    expect(startsBeforeMute).toBeGreaterThan(0);
    expect(startsBeforeMute).toBeLessThan(10);

    engine.setMuted(true);
    await finishSpeech(speaking);

    expect(MockAudioContext.oscillatorStarts).toBe(startsBeforeMute);
  });

  it('resumes audio mid-utterance when unmuted', async () => {
    getSettings.mockResolvedValue({ pet: { muted: true } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });

    const speaking = engine.speak('abcdefghij');
    await vi.advanceTimersByTimeAsync(3);
    expect(MockAudioContext.oscillatorStarts).toBe(0);

    engine.setMuted(false);
    await finishSpeech(speaking);

    expect(MockAudioContext.oscillatorStarts).toBeGreaterThan(0);
  });

  it('keeps character timing intact while muted', async () => {
    getSettings.mockResolvedValue({ pet: { muted: true } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 100 });
    const visemes: Array<string | null> = [];
    engine.onViseme((shape) => visemes.push(shape));

    const speaking = engine.speak('ab');
    await vi.advanceTimersByTimeAsync(50);

    // A muted letter must still hold the full per-character delay, not race ahead.
    expect(visemes).toEqual([null, 'happy']);

    await finishSpeech(speaking);
    expect(visemes).toEqual([null, 'happy', 'mad', null]);
  });

  it('prefers the live mute state over stale persisted settings', async () => {
    getSettings.mockResolvedValue({ pet: { muted: false } });
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });
    engine.setMuted(true);

    const speaking = engine.speak('ab');
    await finishSpeech(speaking);

    expect(getSettings).not.toHaveBeenCalled();
    expect(MockAudioContext.oscillatorStarts).toBe(0);
  });

  it('discards a stale settings read when mute lands while it is in flight', async () => {
    let resolveSettings: (settings: unknown) => void = () => {};
    getSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      })
    );
    const engine = new AnimaleseEngine();
    engine.configure({ speed: 1 });

    const speaking = engine.speak('abcdefghij');
    await Promise.resolve();

    // Main writes the store before broadcasting, so this snapshot is stale.
    engine.setMuted(true);
    resolveSettings({ pet: { muted: false } });

    await finishSpeech(speaking);

    expect(MockAudioContext.oscillatorStarts).toBe(0);
  });
});

describe('notification mute gate', () => {
  const NotificationMock = vi.mocked(Notification);

  beforeEach(() => {
    NotificationMock.mockClear();
    NotificationMock.mockImplementation(
      () => ({ show: vi.fn() }) as unknown as Notification
    );
  });

  afterEach(() => {
    setMutedProvider(null);
  });

  it('sends notifications silently while muted', async () => {
    setMutedProvider(() => true);

    await executeTool('send_notification', { title: 'Hi', body: 'There' });

    expect(NotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hi', body: 'There', silent: true })
    );
  });

  it('lets notifications make sound while unmuted', async () => {
    setMutedProvider(() => false);

    await executeTool('send_notification', { title: 'Hi', body: 'There' });

    expect(NotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false })
    );
  });

  it('defaults to audible when no mute provider is registered', async () => {
    setMutedProvider(null);

    await executeTool('send_notification', { title: 'Hi', body: 'There' });

    expect(NotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false })
    );
  });

  it('defaults to audible when the mute provider throws', async () => {
    setMutedProvider(() => {
      throw new Error('store unavailable');
    });

    await executeTool('send_notification', { title: 'Hi', body: 'There' });

    expect(NotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false })
    );
  });
});
