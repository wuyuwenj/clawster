import * as fs from 'fs';
import * as path from 'path';
import { clawsterDataDir } from '../paths';

const LOG_DIR = path.join(clawsterDataDir(), 'interactions');
const MAX_LOG_SIZE = 10 * 1024 * 1024;

let logPath: string | null = null;
let dirEnsured = false;

function getLogPath(): string {
  if (!logPath) {
    if (!dirEnsured) {
      try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
      dirEnsured = true;
    }
    const date = new Date().toISOString().slice(0, 10);
    logPath = path.join(LOG_DIR, `${date}.jsonl`);
  }
  return logPath;
}

export interface InteractionEntry {
  input: string;
  tool: string | null;
  args?: Record<string, unknown>;
  response?: string;
  mood?: string;
  model?: string;
  latencyMs: number;
  ts: number;
}

export function logInteraction(entry: InteractionEntry): void {
  const filePath = getLogPath();
  const line = JSON.stringify(entry) + '\n';
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.size > MAX_LOG_SIZE) return;
    fs.appendFile(filePath, line, () => {});
  });

  try {
    const { trackChatSent } = require('../analytics');
    trackChatSent({
      tool: entry.tool,
      latencyMs: entry.latencyMs,
      model: entry.model || 'unknown',
      mood: entry.mood,
    });
  } catch { /* analytics not initialized yet */ }
}

export function getInteractionLogDir(): string {
  return LOG_DIR;
}
