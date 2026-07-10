export type IrritationLevel = 'calm' | 'mildly-annoyed' | 'very-annoyed';
export type IrritationEscalationLevel = Exclude<IrritationLevel, 'calm'>;

export interface ClickIrritationState {
  level: IrritationLevel;
  recentClickTimes: number[];
  /** Time of the most recent click that was part of a burst (see `isBurstClick`) */
  lastBurstClickAt: number | null;
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
  lastBurstClickAt: null,
};

/**
 * A click is part of a burst when the rolling window it closes holds enough
 * clicks to escalate. Sustaining and escalating therefore read the same
 * evidence: anything too slow to have built the tantrum is too slow to keep it
 * alive, and no cadence between the two can hold Clawster in a permanent one.
 */
function isBurstClick(clickTimesInWindow: number[]): boolean {
  return clickTimesInWindow.length >= IRRITATION_CLICK_THRESHOLD;
}

export function recordPetClick(
  state: ClickIrritationState,
  now: number
): ClickIrritationResult {
  const recentClickTimes = [
    ...state.recentClickTimes.filter((clickAt) => now - clickAt <= IRRITATION_WINDOW_MS),
    now,
  ];
  const burstClick = isBurstClick(recentClickTimes);

  // Irritation builds from rapid clicking and cools once the rapid clicking
  // stops, so the cooldown runs from the last click that was itself part of a
  // burst. Measuring from the last click of any kind would let slow poking hold
  // the tantrum open forever; measuring from the last escalation would let it
  // expire mid-burst, because escalation stops once the level tops out.
  const cooledDown =
    state.lastBurstClickAt !== null && now - state.lastBurstClickAt >= IRRITATION_COOLDOWN_MS;
  const baseLevel: IrritationLevel = cooledDown ? 'calm' : state.level;

  let level = baseLevel;
  let changedTo: IrritationEscalationLevel | null = null;

  if (burstClick) {
    if (baseLevel === 'calm') {
      level = 'mildly-annoyed';
      changedTo = level;
    } else if (baseLevel === 'mildly-annoyed') {
      level = 'very-annoyed';
      changedTo = level;
    }
  }

  return {
    state: {
      level,
      recentClickTimes,
      lastBurstClickAt: burstClick ? now : cooledDown ? null : state.lastBurstClickAt,
    },
    changedTo,
    reaction: level === 'calm' ? null : level,
  };
}
