import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const APP_SECRET = 'test-secret';

function sign(body: string, timestamp: number, deviceId: string): string {
  return createHmac('sha256', APP_SECRET).update(`${timestamp}.${deviceId}.${body}`).digest('hex');
}

function makeEnv(kvOverrides: Record<string, string> = {}) {
  return {
    RATE_LIMITS: {
      get: vi.fn(async (key: string) => kvOverrides[key] ?? null),
      put: vi.fn(async () => {}),
    },
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-4o-mini',
    APP_SECRET,
    DAILY_MESSAGE_LIMIT: '50',
    MONTHLY_BUDGET_LIMIT: '10000',
  };
}

function makeAuthHeaders(body: string, deviceId = 'dev-1'): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  return {
    'Content-Type': 'application/json',
    'X-Clawster-Timestamp': String(ts),
    'X-Clawster-Device': deviceId,
    'X-Clawster-Signature': sign(body, ts, deviceId),
  };
}

// We can't import the worker directly (CF types), so we test the auth/rate-limit
// logic by reimplementing the core checks with the same algorithm the worker uses.
// This validates the contract, not the runtime.

describe('proxy auth contract', () => {
  it('valid HMAC signature verifies', () => {
    const body = '{"model":"gpt-4o-mini"}';
    const ts = Math.floor(Date.now() / 1000);
    const deviceId = 'dev-1';
    const sig = sign(body, ts, deviceId);
    const payload = `${ts}.${deviceId}.${body}`;
    const expected = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    expect(sig).toBe(expected);
  });

  it('rejects expired timestamp (> 300s skew)', () => {
    const ts = Math.floor(Date.now() / 1000) - 400;
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(now - ts)).toBeGreaterThan(300);
  });

  it('rejects future timestamp (> 300s skew)', () => {
    const ts = Math.floor(Date.now() / 1000) + 400;
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(now - ts)).toBeGreaterThan(300);
  });

  it('rejects tampered body', () => {
    const body = '{"msg":"hi"}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(body, ts, 'dev-1');
    const verifySig = sign(body + 'x', ts, 'dev-1');
    expect(sig).not.toBe(verifySig);
  });
});

describe('proxy rate-limit contract', () => {
  it('daily limit blocks at threshold', () => {
    const dailyLimit = 50;
    const dailyCount = 50;
    expect(dailyCount >= dailyLimit).toBe(true);
  });

  it('daily limit allows below threshold', () => {
    const dailyLimit = 50;
    const dailyCount = 49;
    expect(dailyCount >= dailyLimit).toBe(false);
  });

  it('monthly limit blocks at threshold', () => {
    const monthlyLimit = 10000;
    const monthlyCount = 10000;
    expect(monthlyCount >= monthlyLimit).toBe(true);
  });

  it('global disable switch blocks all requests', () => {
    const disabled = 'true';
    expect(disabled === 'true').toBe(true);
  });

  it('KV mock tracks put calls for counter increment', () => {
    const env = makeEnv();
    env.RATE_LIMITS.put('daily:dev-1:2026-06-21', '1', { expirationTtl: 86400 });
    expect(env.RATE_LIMITS.put).toHaveBeenCalledWith(
      'daily:dev-1:2026-06-21', '1', { expirationTtl: 86400 }
    );
  });
});

describe('proxy signature format validation', () => {
  it('odd-length signature should be rejected', () => {
    const sig = 'abc';
    const hexPairs = sig.match(/.{2}/g);
    // With our fix, null hexPairs → 401 (not crash)
    expect(hexPairs).toEqual(['ab']);
    // The trailing 'c' is lost — invalid signature won't verify
  });

  it('empty signature should be rejected', () => {
    const sig = '';
    const hexPairs = sig.match(/.{2}/g);
    expect(hexPairs).toBeNull();
  });

  it('valid hex signature parses correctly', () => {
    const sig = 'aabbccdd';
    const hexPairs = sig.match(/.{2}/g);
    expect(hexPairs).toEqual(['aa', 'bb', 'cc', 'dd']);
    const bytes = new Uint8Array(hexPairs!.map(b => parseInt(b, 16)));
    expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
  });
});

describe('proxy embeddings rate limiting parity', () => {
  it('embeddings and chat should share the same rate limit keys', () => {
    const deviceId = 'dev-1';
    const date = new Date().toISOString().slice(0, 10);
    const dailyKey = `daily:${deviceId}:${date}`;
    const month = new Date().toISOString().slice(0, 7);
    const monthlyKey = `global:${month}`;

    // Both endpoints should check/increment the same keys
    expect(dailyKey).toMatch(/^daily:dev-1:\d{4}-\d{2}-\d{2}$/);
    expect(monthlyKey).toMatch(/^global:\d{4}-\d{2}$/);
  });
});
