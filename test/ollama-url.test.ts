import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_OLLAMA_URL, resolveOllamaUrl, resolveToolBaseUrl } from '../src/main/chat/ollama-url';
import { LocalToolProvider } from '../src/main/chat/local-tool-provider';

describe('CLA-62 — CLAWSTER_OLLAMA_URL resolution order', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to localhost when nothing is set (behavior unchanged)', () => {
    expect(resolveOllamaUrl({})).toBe('http://127.0.0.1:11434');
    expect(resolveToolBaseUrl(true, {})).toBe('http://127.0.0.1:11434');
    expect(resolveToolBaseUrl(false, {})).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_OLLAMA_URL).toBe('http://127.0.0.1:11434');
  });

  it('CLAWSTER_OLLAMA_URL beats the default', () => {
    const env = { CLAWSTER_OLLAMA_URL: 'http://192.168.1.50:11434' };
    expect(resolveOllamaUrl(env)).toBe('http://192.168.1.50:11434');
    expect(resolveToolBaseUrl(true, env)).toBe('http://192.168.1.50:11434');
    expect(resolveToolBaseUrl(false, env)).toBe('http://192.168.1.50:11434');
  });

  it('empty CLAWSTER_OLLAMA_URL falls back to the default', () => {
    expect(resolveOllamaUrl({ CLAWSTER_OLLAMA_URL: '' })).toBe(DEFAULT_OLLAMA_URL);
  });

  it('prod path: FIREWORKS_BASE_URL beats CLAWSTER_OLLAMA_URL', () => {
    const env = {
      CLAWSTER_OLLAMA_URL: 'http://192.168.1.50:11434',
      FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
    };
    expect(resolveToolBaseUrl(false, env)).toBe('https://api.fireworks.ai/inference/v1');
  });

  it('dev path: FIREWORKS_BASE_URL is ignored', () => {
    const env = {
      CLAWSTER_OLLAMA_URL: 'http://192.168.1.50:11434',
      FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
    };
    expect(resolveToolBaseUrl(true, env)).toBe('http://192.168.1.50:11434');
  });

  it('reads process.env by default', () => {
    vi.stubEnv('CLAWSTER_OLLAMA_URL', 'https://ollama.example.trycloudflare.com');
    expect(resolveOllamaUrl()).toBe('https://ollama.example.trycloudflare.com');
    expect(resolveToolBaseUrl(true)).toBe('https://ollama.example.trycloudflare.com');
  });
});

describe('CLA-62 — override plumbing against a stub Ollama server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it('LocalToolProvider requests land on the overridden URL', async () => {
    const hits: string[] = [];
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'stub-model:latest' }] }));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    vi.stubEnv('CLAWSTER_OLLAMA_URL', `http://127.0.0.1:${port}`);
    const provider = new LocalToolProvider('stub-model:latest', resolveToolBaseUrl(true));

    // The constructor's availability check should hit the stub, not :11434.
    await vi.waitFor(() => expect(hits).toContain('/api/tags'));
    await vi.waitFor(() => expect(provider.isAvailable()).toBe(true));
  });
});
