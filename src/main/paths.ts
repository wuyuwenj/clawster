import * as os from 'os';
import * as path from 'path';

// Root directory for all Clawster user data (memory, logs, prefs, interactions,
// HMAC config). Defaults to ~/.clawster, but can be redirected with the
// CLAWSTER_DATA_DIR environment variable so automated tests run against a
// throwaway directory instead of the real user's data.
export function clawsterDataDir(): string {
  return process.env.CLAWSTER_DATA_DIR || path.join(os.homedir(), '.clawster');
}

// True when the app is running against an isolated test data directory.
export function isTestDataDir(): boolean {
  return Boolean(process.env.CLAWSTER_DATA_DIR);
}
