import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DRAG_RESISTANCE_MAX_MS,
  DRAG_RESISTANCE_SCALE,
  DRAG_RESISTANCE_WIN_PX,
  DRAG_SPEED_SAMPLE_MS,
  FAST_DRAG_STARTLED_CHANCE,
  ZERO_DRAG_REMAINDER,
  hasDragSpeedSample,
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

  it('reads a normal grab-and-move as confused-accepts', () => {
    // 40px over the 60ms sample window is 0.67px/ms — under the fast threshold.
    expect(
      pickDragReactionVariant({
        dragDistancePx: 40,
        elapsedMs: DRAG_SPEED_SAMPLE_MS,
        random: () => 0,
      })
    ).toBe('confused-accepts');
  });

  it('reads a genuine flick as startled', () => {
    expect(
      pickDragReactionVariant({
        dragDistancePx: 120,
        elapsedMs: DRAG_SPEED_SAMPLE_MS,
        random: () => 0,
      })
    ).toBe('startled');
  });

  it('never startles on a single-frame sample', () => {
    // mousedown and the first mousemove landing in the same millisecond used to
    // read as 3px/ms, which trivially cleared the fast-drag threshold.
    expect(
      pickDragReactionVariant({ dragDistancePx: 3, elapsedMs: 1, random: () => 0 })
    ).toBe('confused-accepts');
    expect(
      pickDragReactionVariant({ dragDistancePx: 15, elapsedMs: 8, random: () => 0 })
    ).toBe('confused-accepts');
  });

  it('only reports a usable speed sample once the drag spans the sample window', () => {
    expect(hasDragSpeedSample(DRAG_SPEED_SAMPLE_MS - 1)).toBe(false);
    expect(hasDragSpeedSample(DRAG_SPEED_SAMPLE_MS)).toBe(true);
  });
});

describe('drag reaction speed sampling is deferred (CLA-6)', () => {
  const pet = readFileSync(new URL('../src/renderer/pet/Pet.tsx', import.meta.url), 'utf8');

  it('holds the variant pick until the sample window elapses', () => {
    const flipAt = pet.indexOf('didDragRef.current = true;');
    const block = pet.slice(flipAt, pet.indexOf('if (didDragRef.current) {', flipAt));

    expect(block).not.toContain('startDragReaction(');
    expect(block).toContain('dragSpeedPendingRef.current = true');
    expect(block).toContain('setTimeout(flushDragReaction, DRAG_SPEED_SAMPLE_MS)');
  });

  it('flushes the pending reaction when the drag ends before the window elapses', () => {
    const mouseUpAt = pet.indexOf('const handleDocumentMouseUp = () => {');
    expect(mouseUpAt).toBeGreaterThan(-1);

    const body = pet.slice(mouseUpAt, pet.indexOf('};', mouseUpAt));
    expect(body).toContain('flushDragReaction()');
  });
});

describe('resisted drag takes the window position over from main (CLA-7)', () => {
  const pet = readFileSync(new URL('../src/renderer/pet/Pet.tsx', import.meta.url), 'utf8');

  it('signals the take-over as soon as a resisted drag crosses the threshold', () => {
    const flipAt = pet.indexOf('didDragRef.current = true;');
    const block = pet.slice(flipAt, pet.indexOf('if (didDragRef.current) {', flipAt));

    expect(block).toContain('window.clawster.petDragTakeOver()');
    expect(block).toContain('isWalkingRef.current = false');
  });

  it('does not wait for the resist window to be won before stopping the move', () => {
    const wonAt = pet.indexOf('if (resistanceStep.wonNow) {');
    expect(wonAt).toBeGreaterThan(-1);

    const block = pet.slice(wonAt, pet.indexOf('const scaled = scaleDragDelta', wonAt));
    expect(block).not.toContain('petDragTakeOver');
  });

  it('drives the resist window off the latched flag, not the live one', () => {
    // Cancelling the walk clears isWalkingRef, so resistance must read the
    // `active` flag latched at mousedown or the friction disappears.
    const resistingAt = pet.indexOf('const resisting =');
    const expression = pet.slice(resistingAt, pet.indexOf(';', resistingAt));

    expect(expression).toContain('resistanceStep.state.active');
    expect(expression).not.toContain('isWalkingRef');
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
