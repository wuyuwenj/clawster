import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { signRequest } from '../src/main/chat/hmac-auth';

const APP_SECRET = 'clawster-v1-2026';

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
