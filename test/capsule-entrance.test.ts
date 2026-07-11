import { describe, it, expect } from 'vitest';
import { replayCapsuleEntrance, type CapsuleElement } from '../src/renderer/chatbar/capsule-entrance';

// CLA-59: the chatbar window is reused across summons, so the mount-time
// capsuleIn animation only ever plays once. replayCapsuleEntrance restarts it
// on demand (animation:none → reflow → clear), but only in the Light theme —
// dark keeps its existing first-mount-only behavior.

function fakeCapsule() {
  const reads: string[] = [];
  const writes: string[] = [];
  const el: CapsuleElement = {
    style: {
      get animation() {
        return writes[writes.length - 1] ?? '';
      },
      set animation(value: string) {
        writes.push(value);
      },
    },
    get offsetWidth() {
      reads.push(writes[writes.length - 1] ?? '');
      return 0;
    },
  };
  return { el, reads, writes };
}

describe('replayCapsuleEntrance (CLA-59)', () => {
  it('restarts the animation in light: clears it, forces a reflow, then re-applies', () => {
    const { el, reads, writes } = fakeCapsule();
    expect(replayCapsuleEntrance('light', el)).toBe(true);
    // Sequence matters: the reflow read must land between the two writes,
    // otherwise the browser coalesces them and the animation never restarts.
    expect(writes).toEqual(['none', '']);
    expect(reads).toEqual(['none']);
  });

  it('does nothing in dark — dark has no Tidepool entrance to replay', () => {
    const { el, writes } = fakeCapsule();
    expect(replayCapsuleEntrance('dark', el)).toBe(false);
    expect(writes).toEqual([]);
  });

  it('does nothing when the theme is not yet set', () => {
    const { el, writes } = fakeCapsule();
    expect(replayCapsuleEntrance(undefined, el)).toBe(false);
    expect(writes).toEqual([]);
  });

  it('tolerates a missing element', () => {
    expect(replayCapsuleEntrance('light', null)).toBe(false);
  });
});
