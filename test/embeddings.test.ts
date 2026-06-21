import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/main/chat/memory';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('handles 1536-dim vectors', () => {
    const v1 = Array(1536).fill(0).map((_, i) => Math.sin(i));
    const v2 = Array(1536).fill(0).map((_, i) => Math.sin(i));
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0);
  });

  it('distinguishes similar but different vectors', () => {
    const v1 = Array(1536).fill(0).map((_, i) => Math.sin(i));
    const v2 = Array(1536).fill(0).map((_, i) => Math.cos(i));
    const sim = cosineSimilarity(v1, v2);
    expect(sim).toBeGreaterThan(-1);
    expect(sim).toBeLessThan(1);
  });
});
