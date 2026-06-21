import * as fs from 'fs';
import * as path from 'path';
import { clawsterDataDir } from '../paths';

// Persistent personalization memory. Stores short user facts/preferences the
// user explicitly asked Clawster to remember (e.g. "likes jazz"). Loaded into
// the cloud system prompt and surfaced via the recall_preferences tool.
let prefsPath = path.join(clawsterDataDir(), 'prefs.json');

// Test seam: point persistence at a temp file so tests never touch real prefs.
export function setPreferencesPath(p: string): void {
  prefsPath = p;
}

interface PrefsFile {
  preferences: string[];
}

const MAX_PREFS = 25;

function load(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(prefsPath, 'utf-8')) as PrefsFile;
    return Array.isArray(data.preferences) ? data.preferences.filter(p => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function save(prefs: string[]): void {
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify({ preferences: prefs }, null, 2));
  } catch {
    /* never crash on persistence failure */
  }
}

export function getPreferences(): string[] {
  return load();
}

// Add a preference (deduped case-insensitively, capped to the most recent N).
export function addPreference(text: string): string[] {
  const clean = text.trim();
  if (!clean) return load();
  const prefs = load();
  if (!prefs.some(p => p.toLowerCase() === clean.toLowerCase())) {
    prefs.push(clean);
  }
  const capped = prefs.slice(-MAX_PREFS);
  save(capped);
  return capped;
}

export function clearPreferences(): void {
  save([]);
}

// Render preferences for injection into a system prompt. Empty string when none.
export function buildPreferencesPrompt(): string {
  const prefs = load();
  if (!prefs.length) return '';
  return `\n\nThings the user has asked you to remember:\n${prefs.map(p => `- ${p}`).join('\n')}`;
}
