import { createHmac } from 'crypto';

const APP_SECRET = 'clawster-v1-2026';

export function signRequest(body: string, timestamp: number, deviceId: string): string {
  const payload = `${timestamp}.${deviceId}.${body}`;
  return createHmac('sha256', APP_SECRET).update(payload).digest('hex');
}

export function buildAuthHeaders(body: string, deviceId: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signRequest(body, timestamp, deviceId);
  return {
    'X-Clawster-Timestamp': String(timestamp),
    'X-Clawster-Device': deviceId,
    'X-Clawster-Signature': signature,
  };
}
