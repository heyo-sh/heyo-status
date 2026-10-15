/**
 * The single source of truth for themes bundled with Heyo Status.
 *
 * Add a name here and its implementation to `registry.ts` when introducing a
 * new built-in theme. Keeping this module dependency-free lets configuration
 * validation use the same list without loading React components.
 */
export const builtInStatusThemeNames = [
  "slate",
  "fern",
  "onyx",
  "dune",
  "reed",
] as const;

export type BuiltInStatusThemeName = (typeof builtInStatusThemeNames)[number];

/** The theme a page renders with when its configuration names none. */
export const defaultStatusThemeName: BuiltInStatusThemeName = "slate";
