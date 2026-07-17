import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
// Type-only import: keeps this module importable from Vitest (node env, no
// Playwright runtime) so the pure comparison logic can be unit-tested.
import type { Page, Locator } from '@playwright/test';

// Shared VISUAL-DIFF verification helper for UI e2e specs (CLA-57).
//
// Why this exists: on CLA-27 an e2e test "passed" on a programmatic assertion
// (the pet's mood flag flipped idle → curious) while the owner viewed the
// screenshots and the rendered sprite looked identical — a false pass. A UI
// change is not done until the PIXELS change (or match an intended baseline),
// so UI specs assert on actual renders through this helper.
//
// Comparison is MASKED + THRESHOLDED, never raw pixel equality:
//   - `threshold` feeds pixelmatch's per-pixel colour-distance tolerance, and
//     anti-aliased pixels are excluded (`includeAA: false`), so font rendering,
//     sub-pixel shifts, and AA fringing do not register as differences.
//   - `mask` zeroes out rectangles (a clock, a cursor, an animated spinner) in
//     BOTH frames before comparing, so dynamic regions can't force a false diff.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualDiffOptions {
  /**
   * pixelmatch per-pixel colour-distance tolerance (0..1). Higher tolerates
   * more anti-aliasing / font / sub-pixel noise before a pixel counts as
   * changed. Default 0.15.
   */
  threshold?: number;
  /**
   * Rectangles (in screenshot pixel coordinates) to EXCLUDE from the
   * comparison — mask animated or non-deterministic regions so they can't
   * produce a false diff (or hide a real one).
   */
  mask?: Rect[];
  /** Directory to write before / after / diff PNGs for human review. */
  evidenceDir?: string;
  /** Filename prefix for the evidence PNGs. Default 'visual-diff'. */
  label?: string;
}

export interface VisualDiffResult {
  changedPixels: number;
  totalPixels: number;
  /** Share of pixels that differ, 0..1. This is what specs assert on. */
  changedFraction: number;
  width: number;
  height: number;
  /** Written only when `evidenceDir` is set. */
  beforePath?: string;
  afterPath?: string;
  diffPath?: string;
}

/** Thrown by the assertion helpers; carries the diff result for debugging. */
export class VisualDiffError extends Error {
  readonly result: VisualDiffResult;
  constructor(message: string, result: VisualDiffResult) {
    super(message);
    this.name = 'VisualDiffError';
    this.result = result;
  }
}

/**
 * Screenshot a surface (a whole Page or a single element Locator). Pass a
 * `savePath` to also persist the raw PNG. Capture the SAME surface at a stable
 * size for before and after — a size change is reported as a hard error, not a
 * diff.
 */
export async function captureSurface(surface: Page | Locator, savePath?: string): Promise<Buffer> {
  if (savePath) {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    return surface.screenshot({ path: savePath });
  }
  return surface.screenshot();
}

function maskRects(png: PNG, rects: Rect[]): void {
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(png.width, Math.ceil(r.x + r.width));
    const y1 = Math.min(png.height, Math.ceil(r.y + r.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (png.width * y + x) << 2;
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      }
    }
  }
}

/**
 * Masked + thresholded comparison of two PNG buffers. Returns the changed-pixel
 * fraction; never throws on a difference (only on a size mismatch). Use the
 * assertion helpers below to turn a fraction into a pass/fail.
 */
export function compareBuffers(
  beforeBuf: Buffer,
  afterBuf: Buffer,
  options: VisualDiffOptions = {},
): VisualDiffResult {
  const { threshold = 0.15, mask = [], evidenceDir, label = 'visual-diff' } = options;
  const before = PNG.sync.read(beforeBuf);
  const after = PNG.sync.read(afterBuf);

  const evidence = evidenceDir
    ? {
        beforePath: path.join(evidenceDir, `${label}-before.png`),
        afterPath: path.join(evidenceDir, `${label}-after.png`),
        diffPath: path.join(evidenceDir, `${label}-diff.png`),
      }
    : undefined;
  if (evidenceDir && evidence) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    // Persist the ORIGINAL frames (pre-mask) so a human reviews the true render.
    // Written before the dimension check so a mismatch still leaves images on disk.
    fs.writeFileSync(evidence.beforePath, beforeBuf);
    fs.writeFileSync(evidence.afterPath, afterBuf);
  }

  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `visual-diff: dimension mismatch — before ${before.width}x${before.height} vs ` +
        `after ${after.width}x${after.height}. Capture the same surface at a stable size.`,
    );
  }

  const { width, height } = before;
  if (mask.length) {
    maskRects(before, mask);
    maskRects(after, mask);
  }

  const diff = new PNG({ width, height });
  const changedPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold,
    includeAA: false,
  });

  const totalPixels = width * height;
  const result: VisualDiffResult = {
    changedPixels,
    totalPixels,
    changedFraction: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    width,
    height,
  };

  if (evidence) {
    result.beforePath = evidence.beforePath;
    result.afterPath = evidence.afterPath;
    result.diffPath = evidence.diffPath;
    // The diff map showing exactly which pixels changed.
    fs.writeFileSync(result.diffPath, PNG.sync.write(diff));
  }

  return result;
}

function evidenceHint(result: VisualDiffResult): string {
  return result.diffPath ? ` Review the render: ${result.afterPath} (diff: ${result.diffPath}).` : '';
}

/**
 * Assert the surface VISIBLY changed. Fails when the changed fraction is at or
 * below `minChangedFraction` (default 0.02) — this is the guard that catches the
 * CLA-27 false pass, where a flag flipped but nothing rendered differently.
 */
export function assertVisiblyDiffers(
  beforeBuf: Buffer,
  afterBuf: Buffer,
  options: VisualDiffOptions & { minChangedFraction?: number } = {},
): VisualDiffResult {
  const minChangedFraction = options.minChangedFraction ?? 0.02;
  const result = compareBuffers(beforeBuf, afterBuf, options);
  if (result.changedFraction <= minChangedFraction) {
    throw new VisualDiffError(
      `Expected the surface to VISIBLY change, but only ${(result.changedFraction * 100).toFixed(2)}% of ` +
        `pixels differ (need > ${(minChangedFraction * 100).toFixed(2)}%). The programmatic state may have ` +
        `flipped while the rendered pixels stayed the same — the CLA-27 false pass.${evidenceHint(result)}`,
      result,
    );
  }
  return result;
}

/**
 * Assert the surface visually MATCHES a baseline. Fails when more than
 * `maxChangedFraction` (default 0.01) of pixels differ — use it to prove a
 * refactor did NOT change the rendered UI, or to pin an intended appearance.
 */
export function assertVisiblyMatches(
  beforeBuf: Buffer,
  afterBuf: Buffer,
  options: VisualDiffOptions & { maxChangedFraction?: number } = {},
): VisualDiffResult {
  const maxChangedFraction = options.maxChangedFraction ?? 0.01;
  const result = compareBuffers(beforeBuf, afterBuf, options);
  if (result.changedFraction > maxChangedFraction) {
    throw new VisualDiffError(
      `Expected the surface to visually MATCH the baseline, but ${(result.changedFraction * 100).toFixed(2)}% of ` +
        `pixels differ (allowed ${(maxChangedFraction * 100).toFixed(2)}%).${evidenceHint(result)}`,
      result,
    );
  }
  return result;
}
