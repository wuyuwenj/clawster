import { describe, it, expect, afterEach } from 'vitest';
import { animalese } from '../src/renderer/utils/animalese';

// CLA-58 audio safety: when window.clawster.audioMuted is true (NODE_ENV=test
// or CLAWSTER_MUTE_AUDIO=1), the Animalese engine must produce NO sound and
// never open an AudioContext, so the e2e/screenshot suite can run on a real
// machine without playing the voice. AudioContext is intentionally undefined in
// this node test environment: if speak() reached audio playback it would throw,
// so a clean resolve proves the mute guard short-circuits before any audio.
describe('animalese audio mute (CLA-58 audio safety)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('speak() resolves silently without opening an AudioContext when muted', async () => {
    (globalThis as { window?: unknown }).window = { clawster: { audioMuted: true } };
    await expect(animalese.speak('hello there, want your notes?')).resolves.toBeUndefined();
  });

  it('stays silent on whitespace/empty text when muted', async () => {
    (globalThis as { window?: unknown }).window = { clawster: { audioMuted: true } };
    await expect(animalese.speak('   ')).resolves.toBeUndefined();
    await expect(animalese.speak('')).resolves.toBeUndefined();
  });
});
