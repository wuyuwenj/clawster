import { describe, expect, it } from 'vitest';

import {
  INITIAL_CLICK_IRRITATION_STATE,
  IRRITATION_CLICK_THRESHOLD,
  IRRITATION_COOLDOWN_MS,
  IRRITATION_WINDOW_MS,
  recordPetClick,
} from '../src/renderer/pet/click-irritation';

describe('click irritation state machine (CLA-8)', () => {
  it('stays calm below 5 clicks within 3 seconds', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD - 1; i += 1) {
      const result = recordPetClick(state, 1000 + i * 400);
      state = result.state;
      expect(result.changedTo).toBeNull();
    }

    expect(state.level).toBe('calm');
  });

  it('escalates to mildly annoyed on the fifth rapid click', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;
    let changedTo: string | null = null;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD; i += 1) {
      const result = recordPetClick(state, 1000 + i * 400);
      state = result.state;
      changedTo = result.changedTo;
    }

    expect(state.level).toBe('mildly-annoyed');
    expect(changedTo).toBe('mildly-annoyed');
  });

  it('escalates from mildly annoyed to very annoyed on continued rapid clicking', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD; i += 1) {
      state = recordPetClick(state, 1000 + i * 300).state;
    }

    const result = recordPetClick(state, 1000 + IRRITATION_CLICK_THRESHOLD * 300);

    expect(result.state.level).toBe('very-annoyed');
    expect(result.changedTo).toBe('very-annoyed');
  });

  it('ignores older clicks outside the 3 second rapid-click window', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD - 1; i += 1) {
      state = recordPetClick(state, 1000 + i * 200).state;
    }

    const result = recordPetClick(state, 1000 + IRRITATION_WINDOW_MS + 500);

    expect(result.state.level).toBe('calm');
    expect(result.changedTo).toBeNull();
  });

  it('fully resets on the first click 10 seconds after the last escalation', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 1; i += 1) {
      state = recordPetClick(state, 1000 + i * 300).state;
    }

    expect(state.level).toBe('very-annoyed');

    const result = recordPetClick(state, state.lastEscalationAt! + IRRITATION_COOLDOWN_MS);

    expect(result.state.level).toBe('calm');
    expect(result.reaction).toBeNull();
    expect(result.changedTo).toBeNull();
  });

  it('stays annoyed instead of falling back to a random poke once very annoyed', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 1; i += 1) {
      state = recordPetClick(state, 1000 + i * 300).state;
    }

    expect(state.level).toBe('very-annoyed');

    const result = recordPetClick(state, state.lastEscalationAt! + 300);

    expect(result.changedTo).toBeNull();
    expect(result.reaction).toBe('very-annoyed');
  });

  it('only reports changedTo on the click that escalates the level', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;
    let now = 1000;
    const escalationClicks: number[] = [];

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 3; i += 1) {
      const result = recordPetClick(state, now);
      state = result.state;
      if (result.changedTo !== null) escalationClicks.push(i);
      now += 300;
    }

    expect(escalationClicks).toEqual([IRRITATION_CLICK_THRESHOLD - 1, IRRITATION_CLICK_THRESHOLD]);
  });

  it('decays back to calm when slow isolated clicks never re-escalate', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;
    let now = 1000;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 1; i += 1) {
      state = recordPetClick(state, now).state;
      now += 300;
    }

    expect(state.level).toBe('very-annoyed');
    const escalatedAt = state.lastEscalationAt!;

    // A lone click 9s after the escalation is still inside the cooldown.
    const stillAnnoyed = recordPetClick(state, escalatedAt + 9000);
    expect(stillAnnoyed.reaction).toBe('very-annoyed');
    expect(stillAnnoyed.state.lastEscalationAt).toBe(escalatedAt);
    state = stillAnnoyed.state;

    // The next lone click is past the cooldown measured from the escalation,
    // so poking slowly does not hold the tantrum open forever.
    const calmed = recordPetClick(state, escalatedAt + 18000);
    expect(calmed.state.level).toBe('calm');
    expect(calmed.reaction).toBeNull();
  });

  it('keeps reacting irritated across a short pause in a spam burst', () => {
    let state = INITIAL_CLICK_IRRITATION_STATE;
    let now = 1000;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 1; i += 1) {
      state = recordPetClick(state, now).state;
      now += 300;
    }

    expect(state.level).toBe('very-annoyed');

    // A 4s gap empties the 3s rapid-click window but stays inside the 10s cooldown.
    now += 4000;

    for (let i = 0; i < IRRITATION_CLICK_THRESHOLD + 1; i += 1) {
      const result = recordPetClick(state, now);
      state = result.state;
      now += 300;
      expect(result.reaction).toBe('very-annoyed');
    }
  });

  it('reports no reaction while calm', () => {
    const result = recordPetClick(INITIAL_CLICK_IRRITATION_STATE, 1000);

    expect(result.reaction).toBeNull();
  });
});
