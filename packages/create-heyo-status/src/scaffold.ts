import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  packageManagerField,
  packageManagerInstallCommand,
} from "./package-manager";
import { assertProjectName } from "./project-name";
import { deploymentDatabaseError, type CreateOptions } from "./types";
import {
  copyTemplate,
  mergePackageJson,
  readJson,
  replacePlaceholders,
  writeJson,
} from "./utils";

const packageRoot = resolve(import.meta.dirname, "..");

/**
 * Copies a framework template, a database adapter and an optional deployment
 * overlay. The three layers make database credentials and platform files
 * replaceable without forking a framework template.
 */
export async function scaffoldProject(
  options: CreateOptions,
): Promise<{ projectPath: string }> {
  const cwd = options.cwd ?? process.cwd();
  const projectName = assertProjectName(options.projectName);
  // Checked here as well as in the CLI: a programmatic caller must not be able
  // to produce a project that cannot start on its own deployment target.
  const unsupported = deploymentDatabaseError(
    options.deployment,
    options.database,
  );
  if (unsupported) throw new Error(unsupported);
  const projectPath = resolve(cwd, projectName);
  if (existsSync(projectPath)) {
    throw new Error(`Directory already exists: ${projectPath}`);
  }
  // The creator itself runs on Node, and can install with npm/pnpm/Yarn, but
  // the generated CLI and dev scripts execute with Bun. Fail before creating
  // files rather than handing a Node-only user a project that cannot run.
  const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bun.status !== 0) {
    throw new Error(
      "Heyo Status requires Bun to run its CLI and development scripts. Install Bun before creating a project, even when using npm, pnpm or Yarn.",
    );
  }
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(bun.stdout.trim());
  if (
    !version ||
    Number(version[1]) < 1 ||
    (Number(version[1]) === 1 &&
      (Number(version[2]) < 4 ||
        (Number(version[2]) === 4 && Number(version[3]) < 3)))
  ) {
    throw new Error(
      "Heyo Status requires Bun 1.4.3 or newer for secure dependency overrides. Upgrade Bun before creating a project.",
    );
  }

  const placeholders = {
    PROJECT_NAME: projectName,
    PROJECT_TITLE: toTitle(projectName),
    HEYO_STATUS_VERSION: options.heyoStatusVersion ?? "latest",
    PACKAGE_MANAGER: packageManagerField(options.packageManager),
    THEME: options.theme,
    DATABASE: options.database,
  };
  const templatePath = join(packageRoot, "templates", options.template);
  const databasePath = join(packageRoot, "databases", options.database);
  const deploymentPath = join(
    packageRoot,
    "deployments",
    options.deployment,
    options.template,
  );

  await mkdir(projectPath, { recursive: true });
  await copyTemplate(templatePath, projectPath, placeholders);
  await restoreDotfiles(projectPath);
  await copyOverlay(databasePath, projectPath, placeholders);
  if (options.deployment !== "later") {
    await copyOverlay(deploymentPath, projectPath, placeholders);
  }

  const basePackage = await readJson<Record<string, unknown>>(
    join(projectPath, "package.json"),
  );
  const databasePackage = await readOptionalJson(
    join(databasePath, "package.json"),
    placeholders,
  );
  const deploymentPackage =
    options.deployment === "later"
      ? {}
      : await readOptionalJson(
          join(deploymentPath, "package.json"),
          placeholders,
        );
  await writeJson(
    join(projectPath, "package.json"),
    mergePackageJson(
      mergePackageJson(basePackage, databasePackage),
      deploymentPackage,
    ),
  );

  if (options.packageManager === "yarn") {
    await writeFile(
      join(projectPath, ".yarnrc.yml"),
      "nodeLinker: node-modules\n",
    );
  }
  if (options.install) {
    await installDependencies(projectPath, options.packageManager);
  }
  return { projectPath };
}

async function restoreDotfiles(projectPath: string): Promise<void> {
  // Package managers commonly exclude nested .gitignore files from tarballs.
  // Templates ship this asset as `gitignore`, then restore its conventional
  // filename only in the generated project.
  const source = join(projectPath, "gitignore");
  if (existsSync(source)) await rename(source, join(projectPath, ".gitignore"));
}

async function copyOverlay(
  source: string,
  destination: string,
  placeholders: Record<string, string>,
): Promise<void> {
  if (!existsSync(source)) {
    throw new Error(`Generator asset is missing: ${source}`);
  }
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== "package.json")
      .map((entry) =>
        copyTemplate(
          join(source, entry.name),
          join(destination, entry.name),
          placeholders,
        ),
      ),
  );
}

async function readOptionalJson(
  path: string,
  placeholders: Record<string, string>,
): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  // Overlay package fragments are not copied, so replace their placeholders
  // before merging them with the already-rendered base package.json.
  return JSON.parse(
    replacePlaceholders(JSON.stringify(await readJson(path)), placeholders),
  ) as Record<string, unknown>;
}

async function installDependencies(
  projectPath: string,
  packageManager: CreateOptions["packageManager"],
): Promise<void> {
  const command = packageManagerInstallCommand(packageManager);
  const [executable, ...arguments_] = command;
  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn(executable, arguments_, {
      cwd: projectPath,
      stdio: "inherit",
    });
    child.once("error", rejectInstall);
    child.once("close", (exitCode) => {
      if (exitCode === 0) return resolveInstall();
      rejectInstall(
        new Error(`Dependency installation failed with ${command.join(" ")}.`),
      );
    });
  });
}

function toTitle(projectName: string): string {
  return projectName
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}
