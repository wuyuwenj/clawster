// A poke reaction schedules one of two independent cleanups: reverting the
// mood, or clearing the idle behavior. They need separate slots — a later poke
// that replaces one must not cancel the other, or the reaction that other one
// was going to undo stays on screen forever.
//
// Kept free of React/Electron imports so unit tests can exercise it directly.

type TimerHandle = ReturnType<typeof setTimeout>;

export class PokeReactionTimers {
  private moodRevert: TimerHandle | null = null;
  private behaviorClear: TimerHandle | null = null;

  scheduleMoodRevert(run: () => void, delayMs: number): void {
    if (this.moodRevert !== null) clearTimeout(this.moodRevert);
    this.moodRevert = setTimeout(() => {
      this.moodRevert = null;
      run();
    }, delayMs);
  }

  scheduleBehaviorClear(run: () => void, delayMs: number): void {
    if (this.behaviorClear !== null) clearTimeout(this.behaviorClear);
    this.behaviorClear = setTimeout(() => {
      this.behaviorClear = null;
      run();
    }, delayMs);
  }

  /** Cancel every pending cleanup — used when a tantrum or unmount takes over. */
  clear(): void {
    if (this.moodRevert !== null) {
      clearTimeout(this.moodRevert);
      this.moodRevert = null;
    }
    if (this.behaviorClear !== null) {
      clearTimeout(this.behaviorClear);
      this.behaviorClear = null;
    }
  }
}
