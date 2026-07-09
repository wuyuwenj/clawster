import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DRAG_RESISTANCE_MAX_MS,
  DRAG_RESISTANCE_SCALE,
  DRAG_RESISTANCE_WIN_PX,
  FAST_DRAG_STARTLED_CHANCE,
  ZERO_DRAG_REMAINDER,
  pickDragReactionVariant,
  scaleDragDelta,
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

describe('scaled drag deltas stay integral (CLA-7)', () => {
  it('passes unresisted integer deltas straight through', () => {
    const scaled = scaleDragDelta({
      deltaX: 7,
      deltaY: -3,
      responseScale: 1,
      remainder: ZERO_DRAG_REMAINDER,
    });

    expect(scaled).toEqual({ moveX: 7, moveY: -3, remainder: { x: 0, y: 0 } });
  });

  it('always emits integer deltas while resisting', () => {
    let remainder = ZERO_DRAG_REMAINDER;

    for (let i = 0; i < 10; i += 1) {
      const scaled = scaleDragDelta({
        deltaX: 3,
        deltaY: -5,
        responseScale: DRAG_RESISTANCE_SCALE,
        remainder,
      });
      remainder = scaled.remainder;

      expect(Number.isInteger(scaled.moveX)).toBe(true);
      expect(Number.isInteger(scaled.moveY)).toBe(true);
    }
  });

  it('carries the sub-pixel remainder so slow resisted drags still advance', () => {
    let remainder = ZERO_DRAG_REMAINDER;
    let movedX = 0;

    for (let i = 0; i < 20; i += 1) {
      const scaled = scaleDragDelta({
        deltaX: 1,
        deltaY: 0,
        responseScale: DRAG_RESISTANCE_SCALE,
        remainder,
      });
      remainder = scaled.remainder;
      movedX += scaled.moveX;
    }

    // 20 one-pixel moves at 0.35 response = 7px, not the 0px a naive round gives.
    expect(movedX).toBe(7);
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

describe('carried drag pose stylesheet ordering (CLA-6)', () => {
  const css = readFileSync(new URL('../src/renderer/pet/styles.css', import.meta.url), 'utf8');

  // state-dragging is applied *alongside* the mood, idle-behavior, and action
  // classes, and main can push a new mood or action at any moment mid-drag.
  // Equal specificity means the carried pose only wins by being declared last.
  it('declares the drag rules after every mood, idle-behavior, and action rule', () => {
    const dragBlockStart = css.indexOf('.lobster-container.state-dragging {');
    expect(dragBlockStart).toBeGreaterThan(-1);

    const overridable = [
      ...css.matchAll(/^\.lobster-container\.(state-[\w-]+|idle-[\w-]+|action-[\w-]+)/gm),
    ].filter((match) => !match[1].startsWith('state-drag'));
    expect(overridable.length).toBeGreaterThan(0);

    const lastOverridable = overridable[overridable.length - 1];
    expect(dragBlockStart).toBeGreaterThan(lastOverridable.index!);
  });

  it('stops the mood claw animations so the carried pose renders', () => {
    const leftClaw = css.slice(css.indexOf('.lobster-container.state-dragging .left-claw'));
    const rightClaw = css.slice(css.indexOf('.lobster-container.state-dragging .right-claw'));

    expect(leftClaw.slice(0, leftClaw.indexOf('}'))).toContain('animation: none');
    expect(rightClaw.slice(0, rightClaw.indexOf('}'))).toContain('animation: none');
  });
});

describe('drag visuals are suppressed while sleeping (CLA-6)', () => {
  // The Vitest suite runs without a DOM, so the guard is asserted against the
  // component source. A sleeping Clawster must keep its tucked-claw sleep pose:
  // state-dragging carries `animation: none` plus the awake carried transform,
  // and nothing about a drag wakes the pet.
  const pet = readFileSync(new URL('../src/renderer/pet/Pet.tsx', import.meta.url), 'utf8');

  const guardsSleep = (source: string, marker: string): boolean => {
    const markerAt = source.indexOf(marker);
    expect(markerAt).toBeGreaterThan(-1);
    const guardAt = source.lastIndexOf('if (!sleepLockedRef.current) {', markerAt);
    if (guardAt === -1) return false;
    // The guard still has to be open at the marker.
    return !source.slice(guardAt + 'if (!sleepLockedRef.current) {'.length, markerAt).includes('}');
  };

  it('never applies the carried pose to a sleeping pet', () => {
    expect(guardsSleep(pet, 'dragging: true')).toBe(true);
  });

  it('never applies the resist tug to a sleeping pet', () => {
    const resistingAt = pet.indexOf('const resisting =');
    expect(resistingAt).toBeGreaterThan(-1);

    const expression = pet.slice(resistingAt, pet.indexOf(';', resistingAt));
    expect(expression).toContain('!sleepLockedRef.current');
  });

  it('never starts a drag reaction or its bubble while sleeping', () => {
    const reactionAt = pet.indexOf('const startDragReaction = useCallback(');
    expect(reactionAt).toBeGreaterThan(-1);

    const body = pet.slice(reactionAt, pet.indexOf('}, [maybeShowEmoteBubble]);', reactionAt));
    expect(body).toContain('if (sleepLockedRef.current) return;');
  });
});
