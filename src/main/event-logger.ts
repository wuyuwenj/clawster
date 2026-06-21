import * as fs from 'fs';
import * as path from 'path';
import { clawsterDataDir } from './paths';

const LOG_DIR = path.join(clawsterDataDir(), 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024;

let logPath: string | null = null;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath(): string {
  if (!logPath) {
    const date = new Date().toISOString().slice(0, 10);
    logPath = path.join(LOG_DIR, `events-${date}.jsonl`);
  }
  return logPath;
}

export function logEvent(event: string, data?: Record<string, unknown>): void {
  try {
    ensureLogDir();
    const filePath = getLogPath();

    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_LOG_SIZE) return;
    } catch { /* file doesn't exist yet */ }

    const entry = {
      event,
      ts: Date.now(),
      ...data,
    };
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  } catch {
    // never crash the app for logging
  }

  // Forward to PostHog (lazy import to avoid circular deps)
  try {
    const { trackEvent } = require('./analytics');
    trackEvent(event, data);
  } catch { /* analytics not initialized yet */ }
}

export function getLogDir(): string {
  return LOG_DIR;
}
