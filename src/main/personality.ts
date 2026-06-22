import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { clawsterDataDir } from './paths';

// Teen-friendly personality presets. Each maps to a bundled IDENTITY.md + SOUL.md
// pair in personality/presets/. Onboarding (and the Settings picker) pick one;
// the chosen pair is copied to a writable "active" personality dir that the app
// reads at runtime — the bundled personality/ folder is read-only in production.

export type PresetId = 'chill' | 'chaotic' | 'sassy' | 'wholesome';

export interface PresetInfo {
  id: PresetId;
  label: string;
  emoji: string;
  blurb: string;
}

export const PRESETS: PresetInfo[] = [
  { id: 'chill', label: 'Chill', emoji: '😎', blurb: 'Easygoing and calm. Helps without the fuss.' },
  { id: 'chaotic', label: 'Chaotic', emoji: '⚡️', blurb: 'High-energy gremlin. Maximum hype, zero chill.' },
  { id: 'sassy', label: 'Sassy', emoji: '💅', blurb: 'Witty and a little sarcastic. Soft center.' },
  { id: 'wholesome', label: 'Wholesome', emoji: '💛', blurb: 'Warm and encouraging. Your biggest fan.' },
];

export const DEFAULT_PRESET: PresetId = 'chill';

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && PRESETS.some(p => p.id === value);
}

// Read-only bundled personality dir (presets + default IDENTITY/SOUL fallback).
function bundledPersonalityDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'personality')
    : path.join(__dirname, '../../personality');
}

function presetsDir(): string {
  return path.join(bundledPersonalityDir(), 'presets');
}

// Writable location for the active personality the app actually runs with.
export function activePersonalityDir(): string {
  return path.join(clawsterDataDir(), 'personality');
}

function readIfExists(file: string): string | null {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return null; }
}

// Copy a preset's IDENTITY.md + SOUL.md into the active personality dir.
// Returns false if the preset files can't be read (e.g. bad id) — callers keep
// whatever personality was already active.
export function applyPreset(id: PresetId): boolean {
  const identity = readIfExists(path.join(presetsDir(), `${id}.identity.md`));
  const soul = readIfExists(path.join(presetsDir(), `${id}.soul.md`));
  if (identity === null || soul === null) return false;
  try {
    const dir = activePersonalityDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), identity);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), soul);
    return true;
  } catch {
    return false;
  }
}

// The personality the app should run with: the active (user-chosen) files if
// present, else the bundled default (chill).
export function getActivePersonality(): { identity: string; soul: string } {
  const dir = activePersonalityDir();
  const identity = readIfExists(path.join(dir, 'IDENTITY.md'))
    ?? readIfExists(path.join(bundledPersonalityDir(), 'IDENTITY.md'))
    ?? '';
  const soul = readIfExists(path.join(dir, 'SOUL.md'))
    ?? readIfExists(path.join(bundledPersonalityDir(), 'SOUL.md'))
    ?? '';
  return { identity, soul };
}

// Combined system-prompt fragment built from the active personality.
export function getActivePersonalityPrompt(): string {
  const { identity, soul } = getActivePersonality();
  let prompt = '';
  if (identity) prompt += `\nIDENTITY:\n${identity}`;
  if (soul) prompt += `\nSOUL:\n${soul}`;
  return prompt;
}

// Ensure the active personality exists on disk, seeding it from the given preset
// (or the default) the first time. Safe to call on every launch.
export function ensureActivePersonality(preset: PresetId = DEFAULT_PRESET): void {
  const dir = activePersonalityDir();
  const hasActive = fs.existsSync(path.join(dir, 'IDENTITY.md')) && fs.existsSync(path.join(dir, 'SOUL.md'));
  if (!hasActive) applyPreset(isPresetId(preset) ? preset : DEFAULT_PRESET);
}
