// Shared theme bootstrap (CLA-58 Light theme).
//
// Dark is the default look; 'light' opts into Tidepool. The active theme is
// reflected as `data-theme` on <html>, which every surface's CSS keys off of
// (bare :root = dark, :root[data-theme="light"] = Tidepool). Each renderer
// entrypoint calls initTheme() before rendering so the correct theme is applied
// from the persisted setting and stays in sync when it changes live.

export type Theme = 'dark' | 'light';

export function applyTheme(theme: Theme): void {
  const t: Theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
}

// Read the persisted theme, apply it, and subscribe to live changes broadcast
// from the main process. Safe before the preload bridge is ready — defaults to
// dark, which also matches the opaque windows' default backgroundColor, so
// there is no light flash for dark users.
export async function initTheme(): Promise<void> {
  applyTheme('dark');
  try {
    const settings = await (window as any).clawster?.getSettings?.();
    applyTheme(settings?.appearance?.theme === 'light' ? 'light' : 'dark');
  } catch {
    /* keep the dark default */
  }
  (window as any).clawster?.onThemeChanged?.((theme: Theme) => applyTheme(theme));
}
