import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
}));

import { animateMoveTo, cancelMoveAnimation, initPetBehaviors } from '../src/main/pet-behaviors';
import {
  DRAG_RESISTANCE_SCALE,
  ZERO_DRAG_REMAINDER,
  scaleDragDelta,
} from '../src/renderer/pet/drag-interactions';

function createFakePetWindow(startX: number, startY: number) {
  let position: [number, number] = [startX, startY];
  return {
    isDestroyed: () => false,
    getPosition: () => position,
    setPosition: (x: number, y: number) => {
      position = [x, y];
    },
    webContents: { send: vi.fn() },
  };
}

describe('autonomous move animation cancellation (CLA-7)', () => {
  let petWindow: ReturnType<typeof createFakePetWindow>;
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    petWindow = createFakePetWindow(0, 0);
    stored = {};
    initPetBehaviors({
      getPetWindow: () => petWindow as never,
      store: { set: (key: string, value: unknown) => { stored[key] = value; } } as never,
      isDev: false,
      updatePetChatPosition: () => {},
      updateAssistantPosition: () => {},
    });
  });

  afterEach(() => {
    cancelMoveAnimation();
    vi.useRealTimers();
  });

  it('stops overwriting the window position once the drag takes over', async () => {
    const move = animateMoveTo(500, 500, 1000);

    await vi.advanceTimersByTimeAsync(100);
    const [movedX] = petWindow.getPosition();
    expect(movedX).toBeGreaterThan(0);

    cancelMoveAnimation();
    const positionAtCancel = petWindow.getPosition();

    await vi.advanceTimersByTimeAsync(1000);
    expect(petWindow.getPosition()).toEqual(positionAtCancel);
    await expect(move).resolves.toBeUndefined();
  });

  it('persists the dragged-to position and tells the renderer it stopped walking', async () => {
    const move = animateMoveTo(500, 500, 1000);

    await vi.advanceTimersByTimeAsync(100);
    cancelMoveAnimation();

    const [x, y] = petWindow.getPosition();
    expect(stored['pet.position']).toEqual({ x, y });
    expect(petWindow.webContents.send).toHaveBeenLastCalledWith('pet-moving', { moving: false });
    await move;
  });

  it('is a no-op when no move animation is running', async () => {
    cancelMoveAnimation();

    expect(stored['pet.position']).toBeUndefined();
    expect(petWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('lets the resisted drag deltas accumulate once the take-over fires', async () => {
    const move = animateMoveTo(500, 500, 1000);
    await vi.advanceTimersByTimeAsync(100);

    // The drag crosses the 2px threshold while the pet is still walking.
    cancelMoveAnimation();
    const [startX, startY] = petWindow.getPosition();

    // 10 mousemoves of 4px each, resisted at 0.35, applied the way pet-drag does.
    let remainder = ZERO_DRAG_REMAINDER;
    for (let i = 0; i < 10; i += 1) {
      const scaled = scaleDragDelta({
        deltaX: 4,
        deltaY: 0,
        responseScale: DRAG_RESISTANCE_SCALE,
        remainder,
      });
      remainder = scaled.remainder;
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + scaled.moveX, y + scaled.moveY);
      await vi.advanceTimersByTimeAsync(16);
    }

    // 40px of cursor travel nets 14px of pet travel — real, and under 1:1.
    expect(petWindow.getPosition()).toEqual([startX + 14, startY]);
    await move;
  });

  it('resolves the pending promise when a new move interrupts an old one', async () => {
    const first = animateMoveTo(500, 500, 1000);
    await vi.advanceTimersByTimeAsync(100);

    const second = animateMoveTo(200, 200, 200);
    await expect(first).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(300);
    await expect(second).resolves.toBeUndefined();
    expect(petWindow.getPosition()).toEqual([200, 200]);
  });
});
