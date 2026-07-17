// CLA-59: the chatbar BrowserWindow is reused across summons (toggle hides it,
// a re-summon just calls .show()), so the mount-time `capsuleIn` CSS entrance
// only ever plays on the first summon of an app session. Main notifies the
// renderer on every window show (`chatbar-shown`), and this module restarts
// the entrance in response. Pure logic (no React/Electron imports) so the
// node-environment Vitest suite can cover it.

export interface CapsuleElement {
  style: { animation: string };
  readonly offsetWidth: number;
}

// Restart the capsule's CSS entrance: clear the animation, force a reflow so
// the browser commits the cleared state, then re-apply the stylesheet value.
// Light-theme only — dark has no Tidepool entrance to replay (its mount-time
// animation is a one-time subtle fade, and that existing behavior stays).
export function replayCapsuleEntrance(
  theme: string | undefined,
  el: CapsuleElement | null,
): boolean {
  if (theme !== 'light' || !el) return false;
  el.style.animation = 'none';
  void el.offsetWidth; // flush, or the two writes coalesce and nothing restarts
  el.style.animation = '';
  return true;
}
