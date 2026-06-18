import { describe, it, expect } from 'vitest';
import { signRequest, buildAuthHeaders } from '../src/main/chat/hmac-auth';

describe('signRequest', () => {
  it('produces a hex string', () => {
    const sig = signRequest('{"msg":"hello"}', 1700000000, 'device-123');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different signatures for different bodies', () => {
    const sig1 = signRequest('body1', 1700000000, 'device-123');
    const sig2 = signRequest('body2', 1700000000, 'device-123');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different timestamps', () => {
    const sig1 = signRequest('body', 1700000000, 'device-123');
    const sig2 = signRequest('body', 1700000001, 'device-123');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different device IDs', () => {
    const sig1 = signRequest('body', 1700000000, 'device-A');
    const sig2 = signRequest('body', 1700000000, 'device-B');
    expect(sig1).not.toBe(sig2);
  });

  it('is deterministic for the same inputs', () => {
    const sig1 = signRequest('body', 1700000000, 'device-123');
    const sig2 = signRequest('body', 1700000000, 'device-123');
    expect(sig1).toBe(sig2);
  });
});

describe('buildAuthHeaders', () => {
  it('returns all three required headers', () => {
    const headers = buildAuthHeaders('{"test":true}', 'dev-001');
    expect(headers).toHaveProperty('X-Clawster-Timestamp');
    expect(headers).toHaveProperty('X-Clawster-Device');
    expect(headers).toHaveProperty('X-Clawster-Signature');
  });

  it('includes the correct device ID', () => {
    const headers = buildAuthHeaders('body', 'my-device');
    expect(headers['X-Clawster-Device']).toBe('my-device');
  });

  it('timestamp is a recent unix timestamp', () => {
    const headers = buildAuthHeaders('body', 'dev');
    const ts = parseInt(headers['X-Clawster-Timestamp'], 10);
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(now - ts)).toBeLessThan(2);
  });

  it('signature is a valid hex hash', () => {
    const headers = buildAuthHeaders('body', 'dev');
    expect(headers['X-Clawster-Signature']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles empty body', () => {
    const headers = buildAuthHeaders('', 'dev');
    expect(headers['X-Clawster-Signature']).toMatch(/^[a-f0-9]{64}$/);
  });
});
