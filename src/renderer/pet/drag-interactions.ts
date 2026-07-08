export type DragReactionVariant = 'confused-accepts' | 'startled';

export interface DragResistanceState {
  active: boolean;
  startedAt: number;
  startX: number;
  startY: number;
  won: boolean;
}

export interface DragResistanceStep {
  state: DragResistanceState;
  responseScale: number;
  wonNow: boolean;
  displacementPx: number;
}

export const DRAG_RESISTANCE_MAX_MS = 500;
export const DRAG_RESISTANCE_WIN_PX = 50;
export const DRAG_RESISTANCE_SCALE = 0.35;
export const FAST_DRAG_SPEED_PX_PER_MS = 0.8;
export const FAST_DRAG_STARTLED_CHANCE = 0.25;

export function startDragResistance(options: {
  movingAutonomously: boolean;
  startX: number;
  startY: number;
  now: number;
}): DragResistanceState {
  return {
    active: options.movingAutonomously,
    startedAt: options.now,
    startX: options.startX,
    startY: options.startY,
    won: !options.movingAutonomously,
  };
}

export function updateDragResistance(
  state: DragResistanceState,
  options: {
    currentX: number;
    currentY: number;
    now: number;
  }
): DragResistanceStep {
  if (!state.active || state.won) {
    return {
      state,
      responseScale: 1,
      wonNow: false,
      displacementPx: distance(state.startX, state.startY, options.currentX, options.currentY),
    };
  }

  const elapsedMs = Math.max(0, options.now - state.startedAt);
  const displacementPx = distance(state.startX, state.startY, options.currentX, options.currentY);
  const won = elapsedMs >= DRAG_RESISTANCE_MAX_MS || displacementPx >= DRAG_RESISTANCE_WIN_PX;
  const nextState = won ? { ...state, won: true } : state;

  return {
    state: nextState,
    responseScale: won ? 1 : DRAG_RESISTANCE_SCALE,
    wonNow: won,
    displacementPx,
  };
}

export function pickDragReactionVariant(options: {
  dragDistancePx: number;
  elapsedMs: number;
  random?: () => number;
}): DragReactionVariant {
  const elapsed = Math.max(1, options.elapsedMs);
  const speedPxPerMs = options.dragDistancePx / elapsed;
  const random = options.random ?? Math.random;

  if (speedPxPerMs >= FAST_DRAG_SPEED_PX_PER_MS && random() < FAST_DRAG_STARTLED_CHANCE) {
    return 'startled';
  }

  return 'confused-accepts';
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}
