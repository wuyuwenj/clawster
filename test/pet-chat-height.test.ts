import { describe, it, expect, vi } from 'vitest';

// windows.ts imports electron + electron-store at module load; stub both so we
// can import the pure helper. Never vi.doMock (Vitest #4166).
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), on: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1440, height: 900 } })),
    getDisplayNearestPoint: vi.fn(),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
  },
}));
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn() })),
}));

import { computePetChatMaxHeight } from '../src/main/windows';

// CLA-16: the bubble grows upward from the pet, so its max height is the space
// above the pet — not a fixed 420 — bounded by 80% of the display.
describe('computePetChatMaxHeight (CLA-16)', () => {
  const AREA_Y = 0;
  const AREA_H = 1080;
  const CEILING = Math.round(AREA_H * 0.8); // 864

  it('grows above the base 420 cap when the pet sits low', () => {
    expect(computePetChatMaxHeight(900, AREA_Y, AREA_H)).toBeGreaterThan(420);
  });

  it('never exceeds 80% of the display height', () => {
    expect(computePetChatMaxHeight(5000, AREA_Y, AREA_H)).toBe(CEILING);
  });

  it('never drops below the base 420 cap when the pet is near the top', () => {
    expect(computePetChatMaxHeight(100, AREA_Y, AREA_H)).toBe(420);
  });

  it('is bounded by the space above the pet (petY=500 → 590)', () => {
    expect(computePetChatMaxHeight(500, AREA_Y, AREA_H)).toBe(590);
  });

  it('respects a non-zero work-area top like a menu bar', () => {
    // areaY=25, petY=800 → spaceAbovePet=865, ceiling=864 → 864
    expect(computePetChatMaxHeight(800, 25, AREA_H)).toBe(CEILING);
  });

  it('is always at least the base cap', () => {
    for (const petY of [0, 50, 100, 300, 700, 1000]) {
      expect(computePetChatMaxHeight(petY, AREA_Y, AREA_H)).toBeGreaterThanOrEqual(420);
    }
  });
});
