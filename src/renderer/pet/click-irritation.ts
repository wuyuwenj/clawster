export type IrritationLevel = 'calm' | 'mildly-annoyed' | 'very-annoyed';
export type IrritationEscalationLevel = Exclude<IrritationLevel, 'calm'>;

export interface ClickIrritationState {
  level: IrritationLevel;
  recentClickTimes: number[];
  lastEscalationAt: number | null;
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
  lastEscalationAt: null,
};

export function recordPetClick(
  state: ClickIrritationState,
  now: number
): ClickIrritationResult {
  // Irritation builds from rapid clicking and cools once the rapid clicking
  // stops, so the cooldown is measured from the last escalation rather than
  // the last click — otherwise slow, isolated poking would hold the tantrum
  // open forever.
  const cooledDown =
    state.lastEscalationAt !== null && now - state.lastEscalationAt >= IRRITATION_COOLDOWN_MS;
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
      lastEscalationAt: changedTo !== null ? now : baseState.lastEscalationAt,
    },
    changedTo,
    reaction: level === 'calm' ? null : level,
  };
}
