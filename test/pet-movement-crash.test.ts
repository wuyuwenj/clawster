import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pet-behaviors.ts imports electron + electron-store at module load; stub both so
// we can drive the movement helpers. Never vi.doMock (Vitest #4166).
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

import { animateMoveTo, initPetBehaviors, stopMoveAnimation, areUsableCoords } from '../src/main/pet-behaviors';
import { resolvePetStartPosition, clampPetPosition } from '../src/main/windows';

// Faithful emulation of Electron's native win.setPosition argument conversion
// (gin int32): it rejects any value V8 does not consider an Int32 — NaN,
// ±Infinity, non-integers, and NEGATIVE ZERO (-0 is a heap number, not an SMI).
// Verified live on Electron 28.3.3 (CLA-56 probe):
//   win.setPosition(100, -0)  → TypeError: Error processing argument at index 1, conversion failure from
//   win.setPosition(100, 0)   → OK
function nativeSetPositionValidation(x: number, y: number): void {
  [x, y].forEach((v, i) => {
    if (!Number.isInteger(v) || Object.is(v, -0)) {
      throw new TypeError(`Error processing argument at index ${i}, conversion failure from ${v}`);
    }
  });
}

// A fake pet window whose setPosition enforces the same argument validation as
// the real native sink, recording every accepted call.
function makeFakeWindow(position: [number, number]) {
  let pos: [number, number] = position;
  const calls: [number, number][] = [];
  return {
    calls,
    isDestroyed: () => false,
    getPosition: vi.fn(() => pos),
    setPosition: vi.fn((x: number, y: number) => {
      nativeSetPositionValidation(x, y);
      pos = [x, y];
      calls.push([x, y]);
    }),
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

describe('animateMoveTo — negative-zero crash (CLA-56)', () => {
  let store: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    store = { get: vi.fn(), set: vi.fn() };
  });

  afterEach(() => {
    stopMoveAnimation();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never hands -0 to the native setPosition when y eases across the top screen edge', async () => {
    // Pet parked above the top edge (negative y — an unclamped drag allows this),
    // then animated back on-screen, exactly what AttentionSeeker does. Frames
    // where the eased y lands in [-0.5, 0) make Math.round return -0, which the
    // native setPosition rejects with the index-1 TypeError.
    const win = makeFakeWindow([100, -40]);
    initWith(win, store);

    const move = animateMoveTo(100, 0, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    await move;

    expect(win.calls.length).toBeGreaterThan(0);
    for (const [x, y] of win.calls) {
      expect(Object.is(x, -0)).toBe(false);
      expect(Object.is(y, -0)).toBe(false);
    }
    // The animation completes at the target and persists it.
    expect(win.calls[win.calls.length - 1]).toEqual([100, 0]);
    expect(store.set).toHaveBeenCalledWith('pet.position', { x: 100, y: 0 });
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

  it('refuses when getPosition reports a non-finite start (poisoned window geometry)', async () => {
    const win = makeFakeWindow([NaN, NaN]);
    initWith(win, store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await animateMoveTo(300, 300, 500);

    expect(win.setPosition).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('resolves the superseded promise when a newer animation starts (overlapping seeks)', async () => {
    // seekAttention fires animateMoveTo without awaiting; a second seek used to
    // clear the first animation's timer while orphaning its promise forever.
    const win = makeFakeWindow([0, 0]);
    initWith(win, store);

    let firstSettled = false;
    const first = animateMoveTo(500, 500, 1000).then(() => {
      firstSettled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(firstSettled).toBe(false);

    const second = animateMoveTo(100, 100, 200);
    await first; // resolved by the cancellation, without advancing time
    expect(firstSettled).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    await second;
    expect(win.calls[win.calls.length - 1]).toEqual([100, 100]);
    // Only the second animation's target is persisted.
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith('pet.position', { x: 100, y: 100 });
  });
});

describe('areUsableCoords (CLA-56)', () => {
  it('accepts finite coordinates, including negatives and plain zero', () => {
    expect(areUsableCoords(0, 0, 100, 200)).toBe(true);
    expect(areUsableCoords(-5, 42)).toBe(true);
  });

  it('rejects NaN, Infinity, and negative zero', () => {
    expect(areUsableCoords(0, NaN)).toBe(false);
    expect(areUsableCoords(0, 0, Infinity, 0)).toBe(false);
    expect(areUsableCoords(0, 0, 0, -Infinity)).toBe(false);
    // The live crash value: -0 is finite, so Number.isFinite alone passes it.
    expect(areUsableCoords(100, -0)).toBe(false);
    expect(areUsableCoords(-0, 100)).toBe(false);
  });
});

describe('clampPetPosition — drag clamp, the crash source (CLA-56)', () => {
  const AREA = { x: 0, y: 25, width: 1440, height: 875 }; // macOS menu bar offset
  const PET = 164;

  it('keeps the pet inside the work area on every edge', () => {
    expect(clampPetPosition(-50, -40, PET, PET, AREA)).toEqual({ x: 0, y: 25 });
    expect(clampPetPosition(5000, 5000, PET, PET, AREA)).toEqual({
      x: AREA.x + AREA.width - PET,
      y: AREA.y + AREA.height - PET,
    });
  });

  it('leaves an in-bounds position untouched', () => {
    expect(clampPetPosition(300, 400, PET, PET, AREA)).toEqual({ x: 300, y: 400 });
  });

  it('never returns -0 even when the work area starts at 0', () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    const { x, y } = clampPetPosition(-0, -0, PET, PET, area);
    expect(Object.is(x, -0)).toBe(false);
    expect(Object.is(y, -0)).toBe(false);
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
      { x: Infinity, y: 0 }, // JSON `1e999` parses to Infinity
      {},
      'not-an-object',
    ]) {
      expect(resolvePetStartPosition(bad, W, H, PET_W, PET_H)).toEqual(DEFAULT);
    }
  });

  it('normalizes a saved -0 coordinate', () => {
    const { x, y } = resolvePetStartPosition({ x: -0, y: -0 }, W, H, PET_W, PET_H);
    expect(Object.is(x, -0)).toBe(false);
    expect(Object.is(y, -0)).toBe(false);
  });
});
