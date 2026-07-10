export type DragReactionVariant = 'confused-accepts' | 'startled';

export const DRAG_THRESHOLD_PX = 2;
export const DRAG_RESISTANCE_MAX_MS = 500;
export const DRAG_RESISTANCE_WIN_PX = 50;
export const DRAG_RESISTANCE_SCALE = 0.35;
export const FAST_DRAG_SPEED_PX_PER_MS = 0.8;
export const FAST_DRAG_STARTLED_CHANCE = 0.25;

// How long a drag must run before its speed is worth reading. A single
// mousemove frame spans ~8-16ms, which turns any grab into a "fast" drag.
export const DRAG_SPEED_SAMPLE_MS = 60;
// A speed reading is only meaningful once the drag has spanned both a real
// slice of time and a real distance.
export const FAST_DRAG_MIN_SAMPLE_MS = 16;
export const FAST_DRAG_MIN_SAMPLE_PX = 24;

export interface DragDeltaRemainder {
  x: number;
  y: number;
}

export interface ScaledDragDelta {
  moveX: number;
  moveY: number;
  remainder: DragDeltaRemainder;
}

export const ZERO_DRAG_REMAINDER: DragDeltaRemainder = { x: 0, y: 0 };

// BrowserWindow.setPosition only accepts integer coordinates; the remainder
// carries the sub-pixel part of a resisted delta into the next mousemove.
export function scaleDragDelta(options: {
  deltaX: number;
  deltaY: number;
  responseScale: number;
  remainder: DragDeltaRemainder;
}): ScaledDragDelta {
  const scaledX = options.deltaX * options.responseScale + options.remainder.x;
  const scaledY = options.deltaY * options.responseScale + options.remainder.y;
  const moveX = Math.round(scaledX);
  const moveY = Math.round(scaledY);

  return {
    moveX,
    moveY,
    remainder: { x: scaledX - moveX, y: scaledY - moveY },
  };
}

export function pickDragReactionVariant(options: {
  dragDistancePx: number;
  elapsedMs: number;
  random?: () => number;
}): DragReactionVariant {
  const random = options.random ?? Math.random;

  if (options.elapsedMs < FAST_DRAG_MIN_SAMPLE_MS || options.dragDistancePx < FAST_DRAG_MIN_SAMPLE_PX) {
    return 'confused-accepts';
  }

  const speedPxPerMs = options.dragDistancePx / options.elapsedMs;
  if (speedPxPerMs >= FAST_DRAG_SPEED_PX_PER_MS && random() < FAST_DRAG_STARTLED_CHANCE) {
    return 'startled';
  }

  return 'confused-accepts';
}

export interface DragGestureUpdate {
  /** Integer window delta to hand to main for this event. */
  moveX: number;
  moveY: number;
  /** True only on the event where the press crossed the movement threshold. */
  startedDragging: boolean;
  /** True on that same event when main's autonomous walk must be cancelled. */
  takeOverMoveAnimation: boolean;
  /** Whether the pet is currently digging its claws in. */
  resisting: boolean;
  /** The one and only drag reaction, emitted on exactly one update. */
  reaction: DragReactionVariant | null;
  /**
   * Delay after which the caller must feed `timeout()` back in, or null when
   * nothing is pending. The caller re-arms its timer on every update.
   */
  reactionTimerMs: number | null;
}

const IDLE_UPDATE: DragGestureUpdate = {
  moveX: 0,
  moveY: 0,
  startedDragging: false,
  takeOverMoveAnimation: false,
  resisting: false,
  reaction: null,
  reactionTimerMs: null,
};

type DragPhase = 'idle' | 'pressed' | 'dragging' | 'released';

/**
 * The whole pointer gesture for CLA-6/CLA-7: the movement threshold, the
 * resistance window a wandering pet puts up, the sub-pixel delta accumulator,
 * and the single drag reaction.
 *
 * The reaction fires exactly once per gesture, on whichever comes first: the
 * resistance resolving (with a readable speed sample), or the release. The
 * resistance window is driven by a deadline the caller schedules rather than
 * by pointer events, so a press that crosses the threshold and then holds
 * still still resolves on time.
 */
export class DragGesture {
  private phase: DragPhase = 'idle';
  private pressX = 0;
  private pressY = 0;
  private lastX = 0;
  private lastY = 0;
  private movingAutonomously = false;
  private dragStartedAt = 0;
  private resistWon = true;
  private reactionFlushed = true;
  private remainder: DragDeltaRemainder = ZERO_DRAG_REMAINDER;
  private sampleDistancePx = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  get isActive(): boolean {
    return this.phase === 'pressed' || this.phase === 'dragging';
  }

  get hasDragged(): boolean {
    return this.phase === 'dragging';
  }

  press(options: { x: number; y: number; now: number; movingAutonomously: boolean }): void {
    this.phase = 'pressed';
    this.pressX = options.x;
    this.pressY = options.y;
    this.lastX = options.x;
    this.lastY = options.y;
    this.movingAutonomously = options.movingAutonomously;
    this.dragStartedAt = options.now;
    this.resistWon = !options.movingAutonomously;
    this.reactionFlushed = false;
    this.remainder = ZERO_DRAG_REMAINDER;
    this.sampleDistancePx = 0;
  }

  move(options: { x: number; y: number; now: number }): DragGestureUpdate {
    if (!this.isActive) return IDLE_UPDATE;

    const deltaX = options.x - this.lastX;
    const deltaY = options.y - this.lastY;
    let startedDragging = false;

    if (this.phase === 'pressed') {
      if (Math.abs(deltaX) <= DRAG_THRESHOLD_PX && Math.abs(deltaY) <= DRAG_THRESHOLD_PX) {
        return IDLE_UPDATE;
      }
      this.phase = 'dragging';
      // The speed clock starts at the first movement, not at the press: button
      // dwell before the flick is not part of how fast the flick was.
      this.dragStartedAt = options.now;
      startedDragging = true;
    }

    const elapsedMs = this.elapsedMs(options.now);
    this.sampleDistancePx = Math.hypot(options.x - this.pressX, options.y - this.pressY);
    if (!this.resistWon && (elapsedMs >= DRAG_RESISTANCE_MAX_MS || this.sampleDistancePx >= DRAG_RESISTANCE_WIN_PX)) {
      this.resistWon = true;
    }

    const scaled = scaleDragDelta({
      deltaX,
      deltaY,
      responseScale: this.resistWon ? 1 : DRAG_RESISTANCE_SCALE,
      remainder: this.remainder,
    });
    this.remainder = scaled.remainder;
    this.lastX = options.x;
    this.lastY = options.y;

    return {
      moveX: scaled.moveX,
      moveY: scaled.moveY,
      startedDragging,
      takeOverMoveAnimation: startedDragging && this.movingAutonomously,
      resisting: this.isResisting,
      reaction: this.flushWhenReady(options.now),
      reactionTimerMs: this.reactionTimerMs(options.now),
    };
  }

  timeout(now: number): DragGestureUpdate {
    if (this.phase !== 'dragging') return IDLE_UPDATE;

    if (!this.resistWon && this.elapsedMs(now) >= DRAG_RESISTANCE_MAX_MS) {
      this.resistWon = true;
    }

    return {
      ...IDLE_UPDATE,
      resisting: this.isResisting,
      reaction: this.flushWhenReady(now),
      reactionTimerMs: this.reactionTimerMs(now),
    };
  }

  release(now: number): DragGestureUpdate {
    const reaction = this.phase === 'dragging' && !this.reactionFlushed ? this.flush(now) : null;
    this.phase = 'released';
    return { ...IDLE_UPDATE, reaction };
  }

  private get isResisting(): boolean {
    return this.phase === 'dragging' && this.movingAutonomously && !this.resistWon;
  }

  private elapsedMs(now: number): number {
    return Math.max(0, now - this.dragStartedAt);
  }

  private flushWhenReady(now: number): DragReactionVariant | null {
    if (this.reactionFlushed || this.phase !== 'dragging') return null;
    if (!this.resistWon || this.elapsedMs(now) < DRAG_SPEED_SAMPLE_MS) return null;
    return this.flush(now);
  }

  private flush(now: number): DragReactionVariant {
    this.reactionFlushed = true;
    return pickDragReactionVariant({
      dragDistancePx: this.sampleDistancePx,
      elapsedMs: Math.max(1, this.elapsedMs(now)),
      random: this.random,
    });
  }

  private reactionTimerMs(now: number): number | null {
    if (this.reactionFlushed || this.phase !== 'dragging') return null;
    const elapsedMs = this.elapsedMs(now);
    const untilSample = Math.max(0, DRAG_SPEED_SAMPLE_MS - elapsedMs);
    const untilResolved = this.resistWon ? 0 : Math.max(0, DRAG_RESISTANCE_MAX_MS - elapsedMs);
    return Math.max(untilSample, untilResolved);
  }
}
