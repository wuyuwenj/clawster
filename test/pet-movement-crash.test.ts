import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pet-behaviors.ts and windows.ts both import electron + electron-store at module
// load; stub both so we can drive the pure movement helpers. Never vi.doMock
// (Vitest #4166).
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

import { animateMoveTo, initPetBehaviors, areFiniteCoords } from '../src/main/pet-behaviors';
import { resolvePetStartPosition } from '../src/main/windows';

// A fake pet window recording every setPosition call so we can assert the native
// sink is never handed a non-finite coordinate (which throws in real Electron).
function makeFakeWindow(position: [number, number]) {
  return {
    isDestroyed: () => false,
    getPosition: vi.fn(() => position),
    setPosition: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

function initWith(win: unknown, store: { get: () => unknown; set: (...args: unknown[]) => void }) {
  initPetBehaviors({
    getPetWindow: () => win as never,
    store: store as never,
    isDev: false,
    updatePetChatPosition: () => {},
    updateAssistantPosition: () => {},
  });
}

describe('areFiniteCoords (CLA-56)', () => {
  it('accepts only all-finite coordinate lists', () => {
    expect(areFiniteCoords(0, 0, 100, 200)).toBe(true);
    expect(areFiniteCoords(-5, 42)).toBe(true);
  });

  it('rejects NaN and Infinity', () => {
    expect(areFiniteCoords(0, NaN)).toBe(false);
    expect(areFiniteCoords(NaN, NaN, NaN, NaN)).toBe(false);
    expect(areFiniteCoords(0, 0, Infinity, 0)).toBe(false);
    expect(areFiniteCoords(0, 0, 0, -Infinity)).toBe(false);
  });
});

describe('animateMoveTo — the crash sink (CLA-56)', () => {
  let store: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    store = { get: vi.fn(), set: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses a non-finite target without ever calling setPosition or persisting it', async () => {
    const win = makeFakeWindow([100, 100]);
    initWith(win, store);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await animateMoveTo(NaN, 200, 500);

    expect(win.setPosition).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('refuses when getPosition returns a non-finite start (poisoned window geometry)', async () => {
    const win = makeFakeWindow([NaN, NaN]);
    initWith(win, store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await animateMoveTo(300, 300, 500);

    expect(win.setPosition).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('animates finite coordinates and persists the finite target', async () => {
    const win = makeFakeWindow([0, 0]);
    initWith(win, store);

    const done = animateMoveTo(100, 100, 100);
    await vi.advanceTimersByTimeAsync(120);
    await done;

    expect(win.setPosition).toHaveBeenCalled();
    // Every coordinate handed to the native sink must be finite.
    for (const [x, y] of win.setPosition.mock.calls) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    expect(store.set).toHaveBeenCalledWith('pet.position', { x: 100, y: 100 });
  });
});

describe('resolvePetStartPosition — store-position fallback (CLA-56)', () => {
  const W = 1440;
  const H = 900;
  const PET_W = 120;
  const PET_H = 120;
  const DEFAULT = { x: W - PET_W - 20, y: H - PET_H - 20 };

  it('uses a valid saved position verbatim', () => {
    expect(resolvePetStartPosition({ x: 300, y: 400 }, W, H, PET_W, PET_H)).toEqual({ x: 300, y: 400 });
  });

  it('falls back to the default corner when the position is missing (first run)', () => {
    expect(resolvePetStartPosition(null, W, H, PET_W, PET_H)).toEqual(DEFAULT);
    expect(resolvePetStartPosition(undefined, W, H, PET_W, PET_H)).toEqual(DEFAULT);
  });

  it('falls back when the saved position is malformed or non-finite', () => {
    for (const bad of [
      { x: NaN, y: NaN },
      { x: 100 }, // partial — y undefined
      { x: '100', y: '200' }, // stringified legacy value
      { x: Infinity, y: 0 },
      {},
      'not-an-object',
    ]) {
      expect(resolvePetStartPosition(bad, W, H, PET_W, PET_H)).toEqual(DEFAULT);
    }
  });
});
