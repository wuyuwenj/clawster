import { describe, expect, it } from 'vitest';

import {
  DRAG_RESISTANCE_MAX_MS,
  DRAG_RESISTANCE_SCALE,
  DRAG_RESISTANCE_WIN_PX,
  FAST_DRAG_STARTLED_CHANCE,
  pickDragReactionVariant,
  startDragResistance,
  updateDragResistance,
} from '../src/renderer/pet/drag-interactions';

describe('drag resistance (CLA-7)', () => {
  it('does not resist when the lobster is not moving itself', () => {
    const state = startDragResistance({
      movingAutonomously: false,
      startX: 100,
      startY: 100,
      now: 1000,
    });

    const step = updateDragResistance(state, {
      currentX: 108,
      currentY: 100,
      now: 1010,
    });

    expect(step.state.won).toBe(true);
    expect(step.responseScale).toBe(1);
    expect(step.wonNow).toBe(false);
  });

  it('slows drag response before the user wins', () => {
    const state = startDragResistance({
      movingAutonomously: true,
      startX: 100,
      startY: 100,
      now: 1000,
    });

    const step = updateDragResistance(state, {
      currentX: 120,
      currentY: 100,
      now: 1200,
    });

    expect(step.state.won).toBe(false);
    expect(step.responseScale).toBe(DRAG_RESISTANCE_SCALE);
    expect(step.wonNow).toBe(false);
  });

  it('gives in after roughly half a second of sustained drag', () => {
    const state = startDragResistance({
      movingAutonomously: true,
      startX: 100,
      startY: 100,
      now: 1000,
    });

    const step = updateDragResistance(state, {
      currentX: 120,
      currentY: 100,
      now: 1000 + DRAG_RESISTANCE_MAX_MS,
    });

    expect(step.state.won).toBe(true);
    expect(step.responseScale).toBe(1);
    expect(step.wonNow).toBe(true);
  });

  it('gives in after about 50px of displacement even before the time threshold', () => {
    const state = startDragResistance({
      movingAutonomously: true,
      startX: 100,
      startY: 100,
      now: 1000,
    });

    const step = updateDragResistance(state, {
      currentX: 100 + DRAG_RESISTANCE_WIN_PX,
      currentY: 100,
      now: 1100,
    });

    expect(step.state.won).toBe(true);
    expect(step.responseScale).toBe(1);
    expect(step.wonNow).toBe(true);
  });
});

describe('drag reaction variant selection (CLA-6)', () => {
  it('defaults to confused-accepts for ordinary drags', () => {
    expect(
      pickDragReactionVariant({
        dragDistancePx: 20,
        elapsedMs: 120,
        random: () => 0,
      })
    ).toBe('confused-accepts');
  });

  it('occasionally uses startled for fast drags', () => {
    expect(
      pickDragReactionVariant({
        dragDistancePx: 80,
        elapsedMs: 50,
        random: () => FAST_DRAG_STARTLED_CHANCE - 0.01,
      })
    ).toBe('startled');
  });

  it('keeps most fast drags on the default realization variant', () => {
    expect(
      pickDragReactionVariant({
        dragDistancePx: 80,
        elapsedMs: 50,
        random: () => FAST_DRAG_STARTLED_CHANCE,
      })
    ).toBe('confused-accepts');
  });
});
