import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { builtInStatusThemeNames } from "../src/theme/names";

/**
 * A theme's look has to follow `theme` in `heyo-status.config.ts` and nothing
 * else.
 *
 * It did not. Page width and the radius scale were `:root` declarations in
 * five separate stylesheets, so the configured theme picked the React layout
 * while the *imported* stylesheet picked the width. Changing `theme` moved the
 * layout and left the width behind, with nothing to say the page was now half
 * one theme and half another. The tokens are scoped to the `data-theme`
 * attribute the shell publishes, in the one shared stylesheet, and these tests
 * keep them there.
 */
const themeDirectory = join(import.meta.dirname, "..", "src", "theme");

const sharedStylesheet = await readFile(
  join(themeDirectory, "status.css"),
  "utf8",
);

describe("theme tokens", () => {
  test.each([...builtInStatusThemeNames])(
    "%s declares its tokens against its data-theme attribute",
    (theme) => {
      expect(sharedStylesheet).toContain(`[data-theme="${theme}"]`);
    },
  );

  test.each([...builtInStatusThemeNames])(
    "%s resolves a page width from the shared stylesheet alone",
    (theme) => {
      const block = tokenBlock(sharedStylesheet, theme);
      expect(block).toContain("--status-page-max-width:");
    },
  );

  test("the themes do not all resolve to the same width", () => {
    const widths = builtInStatusThemeNames.map((theme) => {
      const block = tokenBlock(sharedStylesheet, theme);
      return /--status-page-max-width:\s*([^;]+);/.exec(block)?.[1]?.trim();
    });

    expect(widths.every((width) => typeof width === "string")).toBe(true);
    // Themes sharing a measure is a design choice, not a fault: slate, fern
    // and onyx deliberately do. What this rules out is all five collapsing to
    // one value, which is what a regression back to a single `:root` token
    // would look like from the outside.
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  test.each([...builtInStatusThemeNames])(
    "the %s stylesheet carries no tokens of its own",
    async (theme) => {
      const stylesheet = await readFile(
        join(themeDirectory, theme, "global.css"),
        "utf8",
      );

      // A `:root` token here would apply to whichever stylesheet an
      // application happened to import, not to the theme it configured.
      expect(stylesheet).not.toContain(":root");
      expect(stylesheet).not.toContain("@theme");
      expect(stylesheet).toContain('@import "../status.css";');
    },
  );
});

/** The declarations between `[data-theme="<name>"] {` and its closing brace. */
function tokenBlock(stylesheet: string, theme: string): string {
  const start = stylesheet.indexOf(`[data-theme="${theme}"]`);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = stylesheet.indexOf("{", start);
  const close = stylesheet.indexOf("}", open);
  return stylesheet.slice(open, close);
}
