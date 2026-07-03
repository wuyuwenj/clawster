import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Cold boot — Ollama unavailable at startup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function importFresh() {
    vi.resetModules();
    const mod = await import('../src/main/chat/local-tool-provider');
    return mod.LocalToolProvider;
  }

  it('marks unavailable when Ollama is down at startup', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    // Advance through the 3 retry attempts (each waits 1s between retries)
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    expect(provider.isAvailable()).toBe(false);
  });

  it('classify returns null tool when Ollama is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    const result = await provider.classify('open spotify');
    expect(result.tool).toBeNull();
    expect(result.args).toEqual({});
  });

  it('recovers when Ollama becomes available after initial failure', async () => {
    // Phase 1: Ollama is down — all 3 startup checks fail
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }
    expect(provider.isAvailable()).toBe(false);

    // Phase 2: Ollama comes up — the recheck interval should detect it
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'test-model:latest' }] }),
        };
      }
      throw new Error('unexpected');
    });

    // Advance past the recheck interval (30s)
    await vi.advanceTimersByTimeAsync(31_000);

    expect(provider.isAvailable()).toBe(true);
  });

  it('stays unavailable if Ollama never comes up during rechecks', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    // Advance through several recheck intervals — still down
    await vi.advanceTimersByTimeAsync(120_000);

    expect(provider.isAvailable()).toBe(false);
  });

  it('stops rechecking after recovery', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    // Ollama comes up
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'test-model:latest' }] }),
        };
      }
      throw new Error('unexpected');
    });

    await vi.advanceTimersByTimeAsync(31_000);
    expect(provider.isAvailable()).toBe(true);

    const callCountAfterRecovery = fetchMock.mock.calls.length;

    // Advance more — no further recheck calls should happen
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.length).toBe(callCountAfterRecovery);
  });

  it('destroy cancels pending recheck interval', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const LocalToolProvider = await importFresh();
    const provider = new LocalToolProvider('test-model:latest', 'http://127.0.0.1:11434');

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1100);
    }

    const callCountAtDestroy = fetchMock.mock.calls.length;
    provider.destroy();

    // Advance past recheck interval — no new fetch calls
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(callCountAtDestroy);
  });
});
