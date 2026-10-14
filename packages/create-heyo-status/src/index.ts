#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";

import {
  detectPackageManager,
  packageManagerRunCommand,
} from "./package-manager";
import { projectNameError } from "./project-name";
import { scaffoldProject } from "./scaffold";
import {
  defaultDatabaseFor,
  deploymentDatabaseError,
  deploymentDatabases,
  themes,
  type CreateOptions,
  type Database,
} from "./types";

export {
  detectPackageManager,
  packageManagerField,
  packageManagerRunCommand,
} from "./package-manager";
export { projectNameError } from "./project-name";
export { scaffoldProject } from "./scaffold";
export { mergePackageJson, replacePlaceholders } from "./utils";
export {
  defaultDatabaseFor,
  deploymentDatabaseError,
  deploymentDatabases,
  themes,
} from "./types";
export type * from "./types";

const USAGE = [
  "Usage: create-heyo-status [project-name]",
  "  [--template react-router|next|astro]",
  `  [--theme ${themes.join("|")}]`,
  "  [--deployment cloudflare|vercel|later]",
  "  [--database sqlite|d1|postgres]",
  "  [--package-manager bun|pnpm|npm|yarn]",
  "  [--no-install]",
  "",
  "Cloudflare deploys with D1 and Vercel with PostgreSQL; embedded SQLite is",
  "for local and self-hosted runtimes, so it pairs with --deployment later.",
].join("\n");

const TEMPLATE_OPTIONS = [
  { value: "react-router", label: "React Router" },
  { value: "next", label: "Next.js" },
  { value: "astro", label: "Astro" },
];
const THEME_OPTIONS = [
  { value: "slate", label: "Slate — cards, groups and uptime history" },
  { value: "fern", label: "Fern — one uptime figure per service" },
  { value: "onyx", label: "Onyx — components and an incident timeline" },
  { value: "dune", label: "Dune — a directory of service categories" },
  { value: "reed", label: "Reed — a narrow, minimal single column" },
];
const DEPLOYMENT_OPTIONS = [
  { value: "cloudflare", label: "Cloudflare" },
  { value: "vercel", label: "Vercel" },
  { value: "later", label: "Configure later" },
];
const DATABASE_OPTIONS: Record<Database, { value: string; label: string }> = {
  sqlite: { value: "sqlite", label: "SQLite (embedded)" },
  d1: { value: "d1", label: "Cloudflare D1" },
  postgres: { value: "postgres", label: "PostgreSQL" },
};
const PACKAGE_MANAGER_OPTIONS = [
  { value: "bun", label: "bun" },
  { value: "pnpm", label: "pnpm" },
  { value: "npm", label: "npm" },
  { value: "yarn", label: "yarn" },
];

if (isMainModule()) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  try {
    return realpathSync(entryPoint) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArguments(argv);
  if (parsed.showHelp) {
    p.note(USAGE, "@heyo-sh/create-heyo-status");
    return;
  }
  const options = parsed.interactive
    ? await askQuestions(parsed.options)
    : parsed.options;
  const unsupported = deploymentDatabaseError(
    options.deployment,
    options.database,
  );
  if (unsupported) throw new Error(unsupported);
  const spinner = p.spinner();
  spinner.start("Creating your Heyo Status project");
  try {
    await scaffoldProject(options);
  } catch (error) {
    spinner.stop("Unable to create your status page");
    throw error;
  }
  spinner.stop("Your status page is ready");
  const install = options.install ? "" : `\n${options.packageManager} install`;
  p.note(
    `cd ${options.projectName}${install}\n${packageManagerRunCommand(options.packageManager, "dev")}`,
    "Next steps",
  );
  p.outro("Happy monitoring.");
}

export function parseArguments(argv: string[]): {
  options: CreateOptions;
  interactive: boolean;
  showHelp: boolean;
} {
  const detected = detectPackageManager();
  const options: CreateOptions = {
    projectName: "",
    template: "react-router",
    theme: "slate",
    deployment: "later",
    database: "sqlite",
    packageManager: detected.name,
    install: true,
  };
  let explicit = false;
  let showHelp = false;
  let explicitDatabase = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("-")) {
      if (options.projectName)
        throw new Error("Only one project name can be provided.");
      options.projectName = argument;
      continue;
    }
    explicit = true;
    const [flag, inlineValue] = argument.split("=", 2);
    const readValue = () => inlineValue ?? argv[++index];
    if (flag === "--template") {
      options.template = readEnum(
        readValue(),
        ["react-router", "next", "astro"] as const,
        "template",
      );
    } else if (flag === "--theme") {
      options.theme = readEnum(readValue(), themes, "theme");
    } else if (flag === "--deployment") {
      options.deployment = readEnum(
        readValue(),
        ["cloudflare", "vercel", "later"] as const,
        "deployment",
      );
    } else if (flag === "--database") {
      explicitDatabase = true;
      options.database = readEnum(
        readValue(),
        ["sqlite", "d1", "postgres"] as const,
        "database",
      );
    } else if (flag === "--package-manager") {
      options.packageManager = readEnum(
        readValue(),
        ["bun", "pnpm", "npm", "yarn"] as const,
        "package manager",
      );
    } else if (flag === "--no-install") {
      if (inlineValue !== undefined)
        throw new Error("--no-install does not accept a value.");
      options.install = false;
    } else if (flag === "--install") {
      if (inlineValue !== undefined)
        throw new Error("--install does not accept a value.");
      options.install = true;
    } else if (flag === "--help" || flag === "-h") {
      showHelp = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  // `--deployment cloudflare` alone must not fall back to the SQLite default,
  // which that target cannot run.
  if (!explicitDatabase) {
    options.database = defaultDatabaseFor(options.deployment);
  }
  // A bare project name only answers the first question. Prompts are skipped
  // by passing flags, which is what makes a run scriptable; naming a project on
  // the command line must not silently choose its framework and database.
  return { options, interactive: !explicit, showHelp };
}

async function askQuestions(defaults: CreateOptions): Promise<CreateOptions> {
  p.intro("Create Heyo Status");
  const projectName =
    defaults.projectName ||
    promptValue(
      await p.text({
        message: "Project name",
        placeholder: "my-status-page",
        defaultValue: "my-status-page",
        validate: projectNameError,
      }),
    );
  const template = await selectValue(
    "Template",
    TEMPLATE_OPTIONS,
    ["react-router", "next", "astro"] as const,
    defaults.template,
  );
  const theme = await selectValue(
    "Theme",
    THEME_OPTIONS,
    themes,
    defaults.theme,
  );
  const deployment = await selectValue(
    "Deployment",
    DEPLOYMENT_OPTIONS,
    ["cloudflare", "vercel", "later"] as const,
    defaults.deployment,
  );
  // Only databases the chosen target can run are offered, so an impossible
  // combination is unreachable rather than rejected after the fact.
  const supported = deploymentDatabases[deployment];
  const database =
    supported.length === 1
      ? supported[0]!
      : await selectValue(
          "Database",
          supported.map((value) => DATABASE_OPTIONS[value]),
          supported,
          supported.includes(defaults.database)
            ? defaults.database
            : defaultDatabaseFor(deployment),
        );
  const packageManager = await selectValue(
    "Package manager",
    PACKAGE_MANAGER_OPTIONS,
    ["bun", "pnpm", "npm", "yarn"] as const,
    defaults.packageManager,
  );
  const install: boolean = promptValue(
    (await p.confirm({
      message: "Install dependencies?",
      initialValue: true,
    })) as boolean | symbol,
  );
  return {
    projectName,
    template,
    theme,
    deployment,
    database,
    packageManager,
    install,
  };
}

async function selectValue<T extends string>(
  message: string,
  options: Array<{ value: string; label: string }>,
  available: readonly T[],
  initialValue: T,
): Promise<T> {
  const answer = promptValue(
    await p.select<string>({ message, options, initialValue }),
  );
  if (isOneOf(answer, available)) return answer;
  throw new Error(`Unsupported ${message.toLowerCase()}: ${answer}`);
}

function promptValue(value: string | symbol): string;
function promptValue(value: boolean | symbol): boolean;
function promptValue(value: string | boolean | symbol): string | boolean {
  if (typeof value !== "symbol") return value;
  if (p.isCancel(value)) {
    p.cancel("Creation cancelled.");
    process.exit(0);
  }
  throw new Error("Prompt did not return a value.");
}

function isOneOf<T extends string>(
  value: string,
  values: readonly T[],
): value is T {
  return values.includes(value as T);
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T {
  if (value && isOneOf(value, allowed)) return value;
  throw new Error(`Use one of ${allowed.join(", ")} for ${label}.`);
}
