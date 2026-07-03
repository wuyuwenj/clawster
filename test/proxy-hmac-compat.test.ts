import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

// The app secret is env-driven now (no hardcoded default in hmac-auth, so a
// public repo never ships a working key). Pin one before signRequest is first
// called so the client signer and the mock server verifier share the same key.
process.env.CLAWSTER_APP_SECRET = 'clawster-test-secret';
const APP_SECRET = process.env.CLAWSTER_APP_SECRET;

const { signRequest } = await import('../src/main/chat/hmac-auth');

function serverVerify(body: string, timestamp: number, deviceId: string, clientSignature: string): boolean {
  const payload = `${timestamp}.${deviceId}.${body}`;
  const expected = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  return expected === clientSignature;
}

describe('client-server HMAC compatibility', () => {
  it('client signature matches server verification', () => {
    const body = '{"model":"gpt-4o-mini","messages":[]}';
    const timestamp = 1700000000;
    const deviceId = 'test-device-uuid';

    const clientSig = signRequest(body, timestamp, deviceId);
    const serverValid = serverVerify(body, timestamp, deviceId, clientSig);

    expect(serverValid).toBe(true);
  });

  it('server rejects tampered body', () => {
    const body = '{"model":"gpt-4o-mini","messages":[]}';
    const timestamp = 1700000000;
    const deviceId = 'test-device-uuid';

    const clientSig = signRequest(body, timestamp, deviceId);
    const serverValid = serverVerify(body + 'tampered', timestamp, deviceId, clientSig);

    expect(serverValid).toBe(false);
  });

  it('server rejects wrong device ID', () => {
    const body = '{"msg":"hi"}';
    const timestamp = 1700000000;

    const clientSig = signRequest(body, timestamp, 'real-device');
    const serverValid = serverVerify(body, timestamp, 'spoofed-device', clientSig);

    expect(serverValid).toBe(false);
  });

  it('server rejects replayed request with different timestamp', () => {
    const body = '{"msg":"hi"}';
    const deviceId = 'device-1';

    const clientSig = signRequest(body, 1700000000, deviceId);
    const serverValid = serverVerify(body, 1700000001, deviceId, clientSig);

    expect(serverValid).toBe(false);
  });
});
