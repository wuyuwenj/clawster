export type IrritationLevel = 'calm' | 'mildly-annoyed' | 'very-annoyed';
export type IrritationEscalationLevel = Exclude<IrritationLevel, 'calm'>;

export interface ClickIrritationState {
  level: IrritationLevel;
  recentClickTimes: number[];
  /** Time of the most recent click that landed inside a rapid burst */
  lastRapidClickAt: number | null;
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
  lastRapidClickAt: null,
};

export function recordPetClick(
  state: ClickIrritationState,
  now: number
): ClickIrritationResult {
  // Irritation builds from rapid clicking and cools once the rapid clicking
  // stops, so the cooldown runs from the last click that was itself part of a
  // rapid burst. Measuring from the last click of any kind would let slow,
  // isolated poking hold the tantrum open forever; measuring from the last
  // escalation would let it expire mid-burst, because escalation stops once
  // the level tops out.
  const previousClickAt =
    state.recentClickTimes.length > 0
      ? state.recentClickTimes[state.recentClickTimes.length - 1]
      : null;
  const isRapidClick = previousClickAt !== null && now - previousClickAt <= IRRITATION_WINDOW_MS;

  const cooledDown =
    state.lastRapidClickAt !== null && now - state.lastRapidClickAt >= IRRITATION_COOLDOWN_MS;
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
      lastRapidClickAt: isRapidClick ? now : baseState.lastRapidClickAt,
    },
    changedTo,
    reaction: level === 'calm' ? null : level,
  };
}
