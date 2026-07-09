export type IrritationLevel = 'calm' | 'mildly-annoyed' | 'very-annoyed';
export type IrritationEscalationLevel = Exclude<IrritationLevel, 'calm'>;

export interface ClickIrritationState {
  level: IrritationLevel;
  recentClickTimes: number[];
  lastClickAt: number | null;
}

export interface ClickIrritationResult {
  state: ClickIrritationState;
  changedTo: IrritationEscalationLevel | null;
  reaction: IrritationEscalationLevel | null;
}

export const IRRITATION_CLICK_THRESHOLD = 5;
export const IRRITATION_WINDOW_MS = 3000;
export const IRRITATION_COOLDOWN_MS = 10000;

export const INITIAL_CLICK_IRRITATION_STATE: ClickIrritationState = {
  level: 'calm',
  recentClickTimes: [],
  lastClickAt: null,
};

export function recordPetClick(
  state: ClickIrritationState,
  now: number
): ClickIrritationResult {
  const cooledDown =
    state.lastClickAt !== null && now - state.lastClickAt >= IRRITATION_COOLDOWN_MS;
  const baseState = cooledDown ? INITIAL_CLICK_IRRITATION_STATE : state;
  const recentClickTimes = [
    ...baseState.recentClickTimes.filter((clickAt) => now - clickAt <= IRRITATION_WINDOW_MS),
    now,
  ];

  let level = baseState.level;
  let changedTo: IrritationEscalationLevel | null = null;

  if (recentClickTimes.length >= IRRITATION_CLICK_THRESHOLD) {
    if (baseState.level === 'calm') {
      level = 'mildly-annoyed';
      changedTo = level;
    } else if (baseState.level === 'mildly-annoyed') {
      level = 'very-annoyed';
      changedTo = level;
    }
  }

  return {
    state: {
      level,
      recentClickTimes,
      lastClickAt: now,
    },
    changedTo,
    reaction: level === 'calm' ? null : level,
  };
}
