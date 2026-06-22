import { describe, it, expect, vi, beforeEach } from 'vitest';

// G001: Memory context reaches vision provider system prompt
describe('G001 — memory context wiring', () => {
  it('createProxyVision includes memory context in system prompt', async () => {
    const capturedBodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, opts: { body?: string }) => {
      capturedBodies.push(opts.body || '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'I see a cat' } }] }),
      };
    });

    const { createProxyVision } = await import('../src/main/chat/cloud-provider');
    const vision = createProxyVision('http://localhost:9999', 'test-device');

    vision.setMemoryContext('MEMORY CONTEXT:\n- User likes cats');
    await vision.analyzeScreen('data:image/png;base64,abc', 'What do you see?');

    expect(capturedBodies.length).toBe(1);
    const parsed = JSON.parse(capturedBodies[0]);
    const systemMsg = parsed.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('MEMORY CONTEXT');
    expect(systemMsg.content).toContain('User likes cats');

    vi.unstubAllGlobals();
  });

  it('createProxyVision works without memory context', async () => {
    const capturedBodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, opts: { body?: string }) => {
      capturedBodies.push(opts.body || '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'I see a desktop' } }] }),
      };
    });

    const { createProxyVision } = await import('../src/main/chat/cloud-provider');
    const vision = createProxyVision('http://localhost:9999', 'test-device');

    await vision.analyzeScreen('data:image/png;base64,abc');

    const parsed = JSON.parse(capturedBodies[0]);
    const systemMsg = parsed.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).not.toContain('MEMORY CONTEXT');

    vi.unstubAllGlobals();
  });
});

// G002: 429 handling in analyzeScreen / createProxyVision
describe('G002 — rate limit handling in vision', () => {
  it('createProxyVision returns friendly message on 429', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    const { createProxyVision } = await import('../src/main/chat/cloud-provider');
    const vision = createProxyVision('http://localhost:9999', 'test-device');
    const result = await vision.analyzeScreen('data:image/png;base64,abc', 'What?');

    expect(result.text).toContain('sleepy');
    expect(result.text).not.toContain('offline');

    vi.unstubAllGlobals();
  });

  it('createProxyVision returns generic error on non-429 failure', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }));

    const { createProxyVision } = await import('../src/main/chat/cloud-provider');
    const vision = createProxyVision('http://localhost:9999', 'test-device');
    const result = await vision.analyzeScreen('data:image/png;base64,abc', 'What?');

    expect(result.text).toContain('offline');

    vi.unstubAllGlobals();
  });
});

// G003: Empty vector guard — don't store memories with empty vectors
describe('G003 — empty vector guard', () => {
  it('skips storing emotional memory when embedding returns empty vector', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const dbPath = path.join(os.tmpdir(), `clawster-evg-test-${Date.now()}`);
    const { MemoryManager } = await import('../src/main/chat/memory');

    // Stub fetch to fail (embed returns [])
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });

    const mm = new MemoryManager({ dbPath, proxyUrl: 'http://localhost:9999', deviceId: 'test' });
    await mm.init();

    // Simulate a response with a memory block
    const fakeResponse = `Great to hear!\n\`\`\`memory\n{"memorable": true, "facts": [], "emotional": "User is happy about their new job", "emotions": ["happy"], "people": []}\n\`\`\``;

    await mm.processResponseBackground('I got a new job!', fakeResponse);

    // Check that no emotional memory was stored (embedding failed → empty vector → skipped)
    const db = mm.getDB();
    const memories = await db.getRecentMemories(10);
    expect(memories).toHaveLength(0);

    vi.unstubAllGlobals();
    try { fs.rmSync(dbPath, { recursive: true, force: true }); } catch {}
  });

  it('stores emotional memory when embedding succeeds', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const dbPath = path.join(os.tmpdir(), `clawster-evg-test-${Date.now()}`);
    const { MemoryManager } = await import('../src/main/chat/memory');

    const fakeVector = Array(1536).fill(0).map((_, i) => Math.sin(i));
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: fakeVector }] }),
    }));

    const mm = new MemoryManager({ dbPath, proxyUrl: 'http://localhost:9999', deviceId: 'test' });
    await mm.init();

    const fakeResponse = `Great to hear!\n\`\`\`memory\n{"memorable": true, "facts": [], "emotional": "User is happy about their new job", "emotions": ["happy"], "people": []}\n\`\`\``;

    await mm.processResponseBackground('I got a new job!', fakeResponse);

    const db = mm.getDB();
    const memories = await db.getRecentMemories(10);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].summary).toContain('new job');

    vi.unstubAllGlobals();
    try { fs.rmSync(dbPath, { recursive: true, force: true }); } catch {}
  });
});

// Auto-fix verification: timer returns error on unparseable duration
describe('Auto-fix — timer duration validation', () => {
  it('returns error when duration cannot be parsed', async () => {
    // Mock electron modules
    vi.mock('electron', () => ({
      shell: { openExternal: vi.fn() },
      Notification: vi.fn(),
      BrowserWindow: { getAllWindows: () => [] },
    }));

    const { executeTool } = await import('../src/main/chat/tool-executor');
    const result = await executeTool('set_timer', { duration: 'asdfghjkl' });

    expect(result.handled).toBe(true);
    expect(result.response).toContain("couldn't understand");
  });
});
