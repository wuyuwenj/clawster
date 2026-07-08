import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnimaleseEngine } from '../src/renderer/utils/animalese';
import { createStore } from '../src/main/store';

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
});
