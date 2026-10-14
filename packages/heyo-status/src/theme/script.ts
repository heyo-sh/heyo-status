import type { StatusMode } from "../types";

export const DEFAULT_STATUS_THEME_STORAGE_KEY = "heyo-status-theme";

/**
 * Returns a small, CSP-compatible bootstrap script for the document head.
 * Run it before paint so the configured or persisted colour mode does not
 * briefly render with the wrong palette during hydration.
 *
 * heyo-ui resolves both palettes from one set of tokens through `light-dark()`,
 * which reads `color-scheme`, which in turn is driven by `data-mode`. Writing
 * the attribute is therefore the entire switch: no class list to keep in sync
 * and no inline `color-scheme` that would override a nested preview pane.
 */
export function statusThemeBootstrapScript(
  storageKey: string = DEFAULT_STATUS_THEME_STORAGE_KEY,
  defaultTheme: StatusMode = "system",
): string {
  return `(() => {
  const storageKey = ${JSON.stringify(storageKey)};
  const fallbackTheme = ${JSON.stringify(defaultTheme)};
  const isTheme = (value) => value === "light" || value === "dark" || value === "system";
  const theme = (() => {
    try {
      const value = window.localStorage.getItem(storageKey);
      return isTheme(value) ? value : fallbackTheme;
    } catch { return fallbackTheme; }
  })();
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-mode");
  else root.setAttribute("data-mode", theme);
})();`;
}
