#!/usr/bin/env bun
/** Changesets edits package.json; keep the version embedded in Worker bundles
 * in sync before the version PR is opened (no filesystem at Worker runtime).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = join(import.meta.dirname, "..", "packages", "heyo-status");
const pkg = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
) as {
  version: string;
};
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) {
  throw new Error(
    `Unexpected Heyo Status version: ${JSON.stringify(pkg.version)}`,
  );
}
const path = join(packageRoot, "src", "version.ts");
const current = await readFile(path, "utf8");
const pattern = /export const heyoStatusVersion = "[^"]+";/g;
if ([...current.matchAll(pattern)].length !== 1) {
  throw new Error("Expected exactly one heyoStatusVersion declaration.");
}
await writeFile(
  path,
  current.replace(
    pattern,
    `export const heyoStatusVersion = "${pkg.version}";`,
  ),
);
console.log(`Synced Heyo Status version: ${pkg.version}`);
