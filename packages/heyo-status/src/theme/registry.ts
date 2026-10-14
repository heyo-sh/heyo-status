import type { StatusThemeName } from "../types";
import type { HeyoStatusTheme } from "./contract";
import { duneTheme } from "./dune";
import { fernTheme } from "./fern";
import { onyxTheme } from "./onyx";
import { reedTheme } from "./reed";
import { slateTheme } from "./slate";

const builtInThemes = {
  slate: slateTheme,
  fern: fernTheme,
  onyx: onyxTheme,
  dune: duneTheme,
  reed: reedTheme,
} satisfies Record<StatusThemeName, HeyoStatusTheme>;

/** Resolves a theme that is bundled with the installed Heyo Status version. */
export function resolveStatusTheme(theme: StatusThemeName): HeyoStatusTheme {
  return builtInThemes[theme];
}
