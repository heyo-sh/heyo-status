import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { builtInStatusThemeNames } from "../src/theme/names";

const themeDirectory = join("dist", "theme");
const migrationDirectory = join("dist", "db", "migrations");

/**
 * A theme stylesheet lives beside its layout in `src/theme/<name>/global.css`
 * and is published flat as `dist/theme/<name>.css` for backwards compatibility.
 * Consumers import the shared `dist/theme/status.css` instead. The shared base
 * moves up one directory in that move,
 * so its `@import` is rewritten here rather than being wrong in the source.
 */
async function copyThemeStylesheet(
  theme: (typeof builtInStatusThemeNames)[number],
): Promise<void> {
  const stylesheet = await readFile(
    join("src", "theme", theme, "global.css"),
    "utf8",
  );
  await writeFile(
    join(themeDirectory, `${theme}.css`),
    stylesheet.replace('@import "../status.css";', '@import "./status.css";'),
  );
}

await mkdir(themeDirectory, { recursive: true });
await mkdir(migrationDirectory, { recursive: true });
await cp(
  join("src", "theme", "status.css"),
  join(themeDirectory, "status.css"),
);
await Promise.all(builtInStatusThemeNames.map(copyThemeStylesheet));
await cp(join("src", "db", "migrations"), migrationDirectory, {
  recursive: true,
});
