import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.clawster', 'logs');

describe('event-logger', () => {
  let logFiles: string[] = [];

  function findTodayLog(): string | null {
    const date = new Date().toISOString().slice(0, 10);
    const logPath = path.join(LOG_DIR, `events-${date}.jsonl`);
    return fs.existsSync(logPath) ? logPath : null;
  }

  beforeEach(() => {
    logFiles = fs.existsSync(LOG_DIR)
      ? fs.readdirSync(LOG_DIR).map(f => path.join(LOG_DIR, f))
      : [];
  });

  afterEach(async () => {
    // Clean up test log entries by removing lines we added
    // (we don't delete the file since other tests may be running)
  });

  it('logEvent writes a JSONL entry to the log file', async () => {
    // Dynamic import to avoid module-level side effects
    const { logEvent } = await import('../src/main/event-logger');

    const testId = `test-${Date.now()}`;
    logEvent('test_event', { testId });

    const logPath = findTodayLog();
    expect(logPath).not.toBeNull();

    const content = fs.readFileSync(logPath!, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLine = JSON.parse(lines[lines.length - 1]);

    expect(lastLine.event).toBe('test_event');
    expect(lastLine.testId).toBe(testId);
    expect(lastLine.ts).toBeTypeOf('number');
  });

  it('logEvent handles missing data gracefully', async () => {
    const { logEvent } = await import('../src/main/event-logger');
    expect(() => logEvent('bare_event')).not.toThrow();
  });

  it('getLogDir returns the expected path', async () => {
    const { getLogDir } = await import('../src/main/event-logger');
    expect(getLogDir()).toBe(LOG_DIR);
  });
});
