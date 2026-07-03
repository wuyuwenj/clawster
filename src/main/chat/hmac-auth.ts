import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { clawsterDataDir } from '../paths';

function loadSecret(): string {
  if (process.env.CLAWSTER_APP_SECRET) return process.env.CLAWSTER_APP_SECRET;

  try {
    const configPath = join(clawsterDataDir(), 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (typeof config.appSecret === 'string' && config.appSecret) return config.appSecret;
  } catch { /* no config file */ }

  console.error('[HMAC] No CLAWSTER_APP_SECRET set — proxy requests will fail');
  return '';
}

let cachedSecret: string | null = null;
function getSecret(): string {
  if (!cachedSecret) cachedSecret = loadSecret();
  return cachedSecret;
}

export function signRequest(body: string, timestamp: number, deviceId: string): string {
  const payload = `${timestamp}.${deviceId}.${body}`;
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
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
