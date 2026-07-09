import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PokeReactionTimers } from '../src/renderer/pet/poke-reaction-timers';

describe('poke reaction timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still clears the behavior when a later poke draws a mood', () => {
    const timers = new PokeReactionTimers();
    const clearBehavior = vi.fn();
    const revertMood = vi.fn();

    timers.scheduleBehaviorClear(clearBehavior, 1200);
    vi.advanceTimersByTime(200);
    timers.scheduleMoodRevert(revertMood, 800);

    vi.advanceTimersByTime(1000);

    expect(clearBehavior).toHaveBeenCalledTimes(1);
    expect(revertMood).toHaveBeenCalledTimes(1);
  });

  it('still reverts the mood when a later poke draws a behavior', () => {
    const timers = new PokeReactionTimers();
    const revertMood = vi.fn();
    const clearBehavior = vi.fn();

    timers.scheduleMoodRevert(revertMood, 1500);
    vi.advanceTimersByTime(200);
    timers.scheduleBehaviorClear(clearBehavior, 2000);

    vi.advanceTimersByTime(1300);
    expect(revertMood).toHaveBeenCalledTimes(1);
    expect(clearBehavior).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(clearBehavior).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending cleanup of the same kind rather than running it twice', () => {
    const timers = new PokeReactionTimers();
    const first = vi.fn();
    const second = vi.fn();

    timers.scheduleMoodRevert(first, 1000);
    vi.advanceTimersByTime(500);
    timers.scheduleMoodRevert(second, 1000);
    vi.advanceTimersByTime(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels every pending cleanup so a tantrum is not clobbered', () => {
    const timers = new PokeReactionTimers();
    const revertMood = vi.fn();
    const clearBehavior = vi.fn();

    timers.scheduleMoodRevert(revertMood, 1000);
    timers.scheduleBehaviorClear(clearBehavior, 1200);
    timers.clear();

    vi.advanceTimersByTime(5000);

    expect(revertMood).not.toHaveBeenCalled();
    expect(clearBehavior).not.toHaveBeenCalled();
  });
});
