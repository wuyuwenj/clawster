import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  compareBuffers,
  assertVisiblyDiffers,
  assertVisiblyMatches,
  VisualDiffError,
} from '../e2e/visual-diff';

// CLA-57: proves the shared visual-diff helper does its one job — a UI test
// can't "pass" on a programmatic flag while the rendered pixels are unchanged
// (the CLA-27 false pass), yet a genuine visible change is accepted. Pure PNG
// buffers, no browser, so it's deterministic and audio-safe.

const W = 80;
const H = 80;

function solid(rgba: [number, number, number, number], width = W, height = H): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i << 2;
    png.data[idx] = rgba[0];
    png.data[idx + 1] = rgba[1];
    png.data[idx + 2] = rgba[2];
    png.data[idx + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

function withBlock(base: Buffer, rect: { x: number; y: number; w: number; h: number }, rgba: [number, number, number, number]): Buffer {
  const png = PNG.sync.read(base);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('visual-diff helper (CLA-57)', () => {
  it('CATCHES a no-op: a test that programmatically passes but nothing rendered differently FAILS the visual diff', () => {
    const rendered = solid(WHITE);

    // A naive UI test: some flag flipped, so the programmatic assertion passes...
    const moodFlippedToCurious = true;
    expect(moodFlippedToCurious).toBe(true); // "passes"

    // ...but the surface rendered identically (before === after). The visual
    // diff must reject this — this is exactly the CLA-27 false pass.
    const beforeBuf = rendered;
    const afterBuf = rendered; // no-op change: identical pixels
    expect(() => assertVisiblyDiffers(beforeBuf, afterBuf)).toThrow(VisualDiffError);
    expect(compareBuffers(beforeBuf, afterBuf).changedFraction).toBe(0);
  });

  it('PASSES on a real visible change (a large block repaints)', () => {
    const before = solid(WHITE);
    const after = withBlock(before, { x: 10, y: 10, w: 40, h: 40 }, BLACK); // 1600/6400 = 25%

    const result = assertVisiblyDiffers(before, after, { minChangedFraction: 0.1 });
    expect(result.changedFraction).toBeGreaterThan(0.1);
  });

  it('MASKS a dynamic region so a change inside it does not register', () => {
    const before = solid(WHITE);
    // Change lives ONLY inside the region we then mask (e.g. an animated clock).
    const after = withBlock(before, { x: 0, y: 0, w: 40, h: 40 }, BLACK);
    const mask = [{ x: 0, y: 0, width: 40, height: 40 }];

    // Unmasked: the change is seen.
    expect(compareBuffers(before, after).changedFraction).toBeGreaterThan(0.1);
    // Masked: the change is excluded → looks unchanged.
    expect(compareBuffers(before, after, { mask }).changedFraction).toBe(0);
    expect(() => assertVisiblyDiffers(before, after, { mask })).toThrow(VisualDiffError);
    expect(() => assertVisiblyMatches(before, after, { mask })).not.toThrow();
  });

  it('THRESHOLDS out sub-pixel / anti-aliasing noise (a tiny uniform colour delta is treated as a match)', () => {
    const before = solid([128, 128, 128, 255]);
    const after = solid([130, 130, 130, 255]); // ~0.8% per-channel drift, like AA/font noise

    expect(compareBuffers(before, after, { threshold: 0.15 }).changedFraction).toBe(0);
    expect(() => assertVisiblyMatches(before, after)).not.toThrow();
    expect(() => assertVisiblyDiffers(before, after)).toThrow(VisualDiffError);
  });

  it('reports a dimension mismatch as a hard error, not a silent diff', () => {
    const a = solid(WHITE, 80, 80);
    const b = solid(WHITE, 80, 81);
    expect(() => compareBuffers(a, b)).toThrow(/dimension mismatch/);
  });
});
