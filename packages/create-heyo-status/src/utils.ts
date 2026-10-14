import {
  cp,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export function replacePlaceholders(
  source: string,
  values: Record<string, string>,
): string {
  return source.replace(
    /\{\{([A-Z0-9_]+)\}\}|__([A-Z0-9_]+)__/g,
    (
      placeholder,
      mustacheKey: string | undefined,
      tokenKey: string | undefined,
    ) => {
      const key = mustacheKey ?? tokenKey;
      return key ? (values[key] ?? placeholder) : placeholder;
    },
  );
}

/**
 * Deep-merges an overlay package fragment into a rendered template package.
 *
 * A `null` value removes the key instead of writing it. Overlays otherwise
 * could only add or replace entries, which left every project carrying scripts
 * and dependencies its deployment target cannot use.
 */
export function mergePackageJson<T extends Record<string, unknown>>(
  base: T,
  overlay: Record<string, unknown>,
): T {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    const current = merged[key];
    merged[key] =
      isRecord(current) && isRecord(value)
        ? mergePackageJson(current, value)
        : value;
  }
  return merged as T;
}

export async function copyTemplate(
  source: string,
  destination: string,
  placeholders: Record<string, string>,
): Promise<void> {
  await cp(source, destination, { recursive: true, force: true });
  await replacePlaceholdersAtPath(destination, placeholders);
}

async function replacePlaceholdersAtPath(
  path: string,
  values: Record<string, string>,
): Promise<void> {
  if (!(await stat(path)).isDirectory()) {
    const contents = await readFile(path);
    if (!isTextFile(contents)) return;
    const source = contents.toString("utf8");
    if (!source.includes("{{") && !source.includes("__")) return;
    await writeFile(path, replacePlaceholders(source, values));
    return;
  }
  await Promise.all(
    (await readdir(path, { withFileTypes: true })).map((entry) =>
      replacePlaceholdersAtPath(join(path, entry.name), values),
    ),
  );
}

function isTextFile(contents: Buffer): boolean {
  if (contents.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(contents);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
