import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DRAG_RESISTANCE_MAX_MS,
  DRAG_RESISTANCE_SCALE,
  DRAG_RESISTANCE_WIN_PX,
  DRAG_SPEED_SAMPLE_MS,
  DragGesture,
  DragReactionVariant,
  FAST_DRAG_STARTLED_CHANCE,
  ZERO_DRAG_REMAINDER,
  pickDragReactionVariant,
  scaleDragDelta,
} from '../src/renderer/pet/drag-interactions';

const ALWAYS_STARTLE = () => 0;

function pressAt(gesture: DragGesture, options: { x: number; y: number; now: number; moving: boolean }) {
  gesture.press({ x: options.x, y: options.y, now: options.now, movingAutonomously: options.moving });
}

describe('drag resistance (CLA-7)', () => {
  it('does not resist when the lobster is not moving itself', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });

    const update = gesture.move({ x: 108, y: 100, now: 1010 });

    expect(update.startedDragging).toBe(true);
    expect(update.takeOverMoveAnimation).toBe(false);
    expect(update.resisting).toBe(false);
    // Unresisted deltas pass straight through.
    expect(update.moveX).toBe(8);
  });

  it('slows drag response before the user wins', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    gesture.move({ x: 103, y: 100, now: 1000 });

    const update = gesture.move({ x: 120, y: 100, now: 1200 });

    expect(update.resisting).toBe(true);
    expect(update.reaction).toBeNull();
  });

  it('takes the window position over as soon as a resisted drag crosses the threshold', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });

    const crossing = gesture.move({ x: 104, y: 100, now: 1000 });
    expect(crossing.startedDragging).toBe(true);
    expect(crossing.takeOverMoveAnimation).toBe(true);

    // The take-over is a one-shot; later resisted moves must not repeat it.
    expect(gesture.move({ x: 110, y: 100, now: 1100 }).takeOverMoveAnimation).toBe(false);
  });

  it('keeps resisting after the take-over, off the flag latched at mousedown', () => {
    // Cancelling the walk clears the caller's isWalking flag, so the resist
    // window must not be re-derived from it mid-drag.
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    gesture.move({ x: 104, y: 100, now: 1000 });

    expect(gesture.move({ x: 110, y: 100, now: 1100 }).resisting).toBe(true);
    expect(gesture.move({ x: 120, y: 100, now: 1300 }).resisting).toBe(true);
  });

  it('gives in after roughly half a second even when the pointer holds still', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    const crossing = gesture.move({ x: 110, y: 100, now: 1000 });

    // No further mousemove ever arrives: the window has to be scheduled, or the
    // resistTug animation runs for as long as the button is held.
    expect(crossing.resisting).toBe(true);
    expect(crossing.reactionTimerMs).toBe(DRAG_RESISTANCE_MAX_MS);

    const expired = gesture.timeout(1000 + DRAG_RESISTANCE_MAX_MS);
    expect(expired.resisting).toBe(false);
    expect(expired.reaction).not.toBeNull();
    expect(expired.reactionTimerMs).toBeNull();
  });

  it('gives in after about 50px of displacement even before the time threshold', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    gesture.move({ x: 104, y: 100, now: 1000 });

    const update = gesture.move({ x: 100 + DRAG_RESISTANCE_WIN_PX, y: 100, now: 1100 });

    expect(update.resisting).toBe(false);
    expect(update.reaction).toBe('confused-accepts');
  });

  it('nets a real, smaller-than-1:1 displacement across a resisted drag', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 0, y: 0, now: 0, moving: true });

    let movedX = 0;
    for (let i = 1; i <= 10; i += 1) {
      const update = gesture.move({ x: i * 4, y: 0, now: (i - 1) * 10 });
      expect(update.resisting).toBe(true);
      expect(Number.isInteger(update.moveX)).toBe(true);
      movedX += update.moveX;
    }

    // 40px of cursor travel nets 14px of pet travel, sub-pixel remainder carried.
    expect(movedX).toBe(40 * DRAG_RESISTANCE_SCALE);
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

      expect(Number.isInteger(scaled.moveX)).toBe(true);
      expect(Number.isInteger(scaled.moveY)).toBe(true);
    }

    // 20 one-pixel moves at 0.35 response = 7px, not the 0px a naive round gives.
    expect(movedX).toBe(7);
  });
});

describe('the drag reaction fires exactly once per gesture (CLA-6)', () => {
  const collect = (updates: Array<{ reaction: DragReactionVariant | null }>) =>
    updates.map((update) => update.reaction).filter(Boolean);

  it('reacts to a short resisted tug released before the resist is won', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });

    const updates = [
      gesture.move({ x: 104, y: 100, now: 1000 }),
      gesture.move({ x: 120, y: 100, now: 1300 }),
      gesture.release(1300),
    ];

    // ~20px over ~300ms never reaches the 50px/500ms win, but the grab must
    // still land a realization animation and its bubble.
    expect(collect(updates)).toEqual(['confused-accepts']);
  });

  it('does not react twice when a won drag is then released', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });

    const updates = [
      gesture.move({ x: 104, y: 100, now: 1000 }),
      gesture.move({ x: 160, y: 100, now: 1200 }),
      gesture.release(1400),
    ];

    expect(collect(updates)).toHaveLength(1);
  });

  it('does not react twice when the resist timer fires after the win', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    gesture.move({ x: 104, y: 100, now: 1000 });
    gesture.move({ x: 160, y: 100, now: 1200 });

    expect(gesture.timeout(1500).reaction).toBeNull();
  });

  it('never reacts to a press that stays under the movement threshold', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });

    const nudge = gesture.move({ x: 101, y: 100, now: 1010 });
    expect(nudge.startedDragging).toBe(false);
    expect(gesture.release(1020).reaction).toBeNull();
  });

  it('holds the variant pick until the speed sample window elapses', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });

    const crossing = gesture.move({ x: 104, y: 100, now: 1000 });
    expect(crossing.reaction).toBeNull();
    expect(crossing.reactionTimerMs).toBe(DRAG_SPEED_SAMPLE_MS);

    expect(gesture.timeout(1000 + DRAG_SPEED_SAMPLE_MS).reaction).not.toBeNull();
  });

  it('stops asking for a timer once the gesture is released', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: true });
    gesture.move({ x: 104, y: 100, now: 1000 });

    expect(gesture.release(1100).reactionTimerMs).toBeNull();
    expect(gesture.timeout(2000)).toEqual(
      expect.objectContaining({ reaction: null, reactionTimerMs: null, resisting: false })
    );
  });
});

describe('drag reaction variant selection (CLA-6)', () => {
  it('reads a normal grab-and-move as confused-accepts', () => {
    const gesture = new DragGesture(ALWAYS_STARTLE);
    pressAt(gesture, { x: 0, y: 0, now: 0, moving: false });
    gesture.move({ x: 4, y: 0, now: 0 });

    // 40px over the 60ms sample window is 0.67px/ms — under the fast threshold.
    expect(gesture.move({ x: 40, y: 0, now: DRAG_SPEED_SAMPLE_MS }).reaction).toBe('confused-accepts');
  });

  it('reads a genuine flick as startled', () => {
    const gesture = new DragGesture(ALWAYS_STARTLE);
    pressAt(gesture, { x: 0, y: 0, now: 0, moving: false });
    gesture.move({ x: 4, y: 0, now: 0 });

    expect(gesture.move({ x: 120, y: 0, now: DRAG_SPEED_SAMPLE_MS }).reaction).toBe('startled');
  });

  it('does not charge button-press dwell against the drag speed', () => {
    const gesture = new DragGesture(ALWAYS_STARTLE);
    pressAt(gesture, { x: 0, y: 0, now: 0, moving: false });

    // Press, hold 300ms, then flick 100px in 60ms. The speed clock starts at the
    // first movement, so this reads as fast rather than 100px/360ms.
    gesture.move({ x: 4, y: 0, now: 300 });
    expect(gesture.move({ x: 104, y: 0, now: 360 }).reaction).toBe('startled');
  });

  it('never startles on a single-frame sample', () => {
    // mousedown and the first mousemove landing in the same millisecond used to
    // read as 3px/ms, which trivially cleared the fast-drag threshold.
    const gesture = new DragGesture(ALWAYS_STARTLE);
    pressAt(gesture, { x: 0, y: 0, now: 1000, moving: false });
    gesture.move({ x: 3, y: 0, now: 1000 });

    expect(gesture.release(1000).reaction).toBe('confused-accepts');
  });

  it('keeps most fast drags on the default realization variant', () => {
    expect(
      pickDragReactionVariant({
        dragDistancePx: 80,
        elapsedMs: 50,
        random: () => FAST_DRAG_STARTLED_CHANCE,
      })
    ).toBe('confused-accepts');
    expect(
      pickDragReactionVariant({
        dragDistancePx: 80,
        elapsedMs: 50,
        random: () => FAST_DRAG_STARTLED_CHANCE - 0.01,
      })
    ).toBe('startled');
  });
});

describe('the gesture owns whether a press became a drag (CLA-6)', () => {
  it('reports no drag for a press that stays under the movement threshold', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });
    gesture.move({ x: 101, y: 100, now: 1010 });

    expect(gesture.hasDragged).toBe(false);
    gesture.release(1020);
    expect(gesture.hasDragged).toBe(false);
  });

  it('still reports the drag after release, so the trailing click is not a poke', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });
    gesture.move({ x: 140, y: 100, now: 1050 });

    expect(gesture.hasDragged).toBe(true);
    gesture.release(1100);
    expect(gesture.hasDragged).toBe(true);
  });

  it('clears the drag on the next press', () => {
    const gesture = new DragGesture();
    pressAt(gesture, { x: 100, y: 100, now: 1000, moving: false });
    gesture.move({ x: 140, y: 100, now: 1050 });
    gesture.release(1100);

    pressAt(gesture, { x: 140, y: 100, now: 2000, moving: false });
    expect(gesture.hasDragged).toBe(false);
  });
});

describe('the component defers the whole gesture to the state machine (CLA-6/CLA-7)', () => {
  const pet = readFileSync(new URL('../src/renderer/pet/Pet.tsx', import.meta.url), 'utf8');

  it('drives every pointer event through the gesture', () => {
    expect(pet).toContain('dragGesture.move({');
    expect(pet).toContain('dragGesture.release(');
    expect(pet).toContain('dragGesture.timeout(');
    expect(pet).toContain('dragGesture.press({');
  });

  it('keeps a single source of truth for whether the press became a drag', () => {
    expect(pet).not.toContain('didDragRef');
    expect(pet).toContain('if (dragGesture.hasDragged) return;');
    expect(pet).toContain('if (!dragGesture.hasDragged) {');
  });

  it('schedules the resist window rather than sampling it on mousemove', () => {
    const applyAt = pet.indexOf('const applyDragUpdate = useCallback(');
    const body = pet.slice(applyAt, pet.indexOf('}, [dragGesture, startDragReaction]);', applyAt));

    expect(body).toContain('if (update.reactionTimerMs !== null) {');
    expect(body).toContain('setTimeout(');
    expect(body).toContain('apply(dragGesture.timeout(Date.now()))');
    // The pending timer is replaced, never stacked.
    expect(body).toContain('clearTimeout(dragGestureTimeoutRef.current)');
  });

  it('clears the gesture timer on mousedown and on unmount', () => {
    const mouseDownAt = pet.indexOf('const handleMouseDown = useCallback(');
    const mouseDownBody = pet.slice(mouseDownAt, pet.indexOf('dragGesture.press({', mouseDownAt));
    expect(mouseDownBody).toContain('clearTimeout(dragGestureTimeoutRef.current)');

    const unmountAt = pet.indexOf('window.clawster.removeAllListeners();');
    expect(pet.slice(0, unmountAt)).toContain('if (dragGestureTimeoutRef.current) {');
  });

  it('leaves the realization animation to its own timeout on mouseup', () => {
    const mouseUpAt = pet.indexOf('const handleDocumentMouseUp = () => {');
    const body = pet.slice(mouseUpAt, pet.indexOf('};', mouseUpAt));

    expect(body).toContain('dragging: false, resisting: false');
    expect(body).not.toContain('reaction: null');
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
