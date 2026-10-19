#!/usr/bin/env bun
/** Test the npm tarballs and Cloudflare projects created from them, not only
 * the workspace examples. Every generated `bun dev` must migrate local D1,
 * serve the page and pick up a theme edit without restarting.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "heyo-status-scaffold-"));
const templates = ["next", "astro", "react-router"] as const;
const selected = process.argv[2];
if (selected && !templates.includes(selected as (typeof templates)[number])) {
  throw new Error(`Unknown scaffold template: ${selected}`);
}
const testedTemplates = templates.filter(
  (template) => !selected || template === selected,
);
let port = 3000; // Framework dev defaults; Wrangler uses 8787.
let browser: Browser | undefined;

try {
  // Opt in for a real browser test of HMR/hydration; the default smoke needs
  // no installed browser. CI opts in after installing Playwright's Chromium.
  if (process.env.HEYO_STATUS_BROWSER_E2E === "1") {
    browser = await chromium.launch({
      executablePath: process.env.HEYO_STATUS_BROWSER_BIN || undefined,
      headless: true,
    });
  }
  const packed = join(temporary, "packed");
  await mkdir(packed);
  const statusVersion = await packageVersion("heyo-status");
  const creatorVersion = await packageVersion("create-heyo-status");
  for (const name of ["heyo-status", "create-heyo-status"]) {
    await run(
      "bun",
      ["pm", "pack", "--destination", packed],
      join(root, "packages", name),
    );
  }

  const harness = join(temporary, "harness");
  await mkdir(harness);
  await writeFile(
    join(harness, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@heyo-sh/create-heyo-status": `file:${join(packed, `heyo-sh-create-heyo-status-${creatorVersion}.tgz`)}`,
      },
    }),
  );
  await run("bun", ["install"], harness);
  const { scaffoldProject } = (await import(
    pathToFileURL(
      join(harness, "node_modules/@heyo-sh/create-heyo-status/dist/index.js"),
    ).href
  )) as typeof import("../packages/create-heyo-status/src/scaffold");
  const statusArchive = join(
    packed,
    `heyo-sh-heyo-status-${statusVersion}.tgz`,
  );
  const workspace = join(temporary, "projects");
  await mkdir(workspace);

  for (const template of testedTemplates) {
    port =
      template === "astro" ? 4321 : template === "react-router" ? 5173 : 3000;
    const { projectPath } = await scaffoldProject({
      cwd: workspace,
      projectName: `audit-${template}`,
      template,
      theme: "slate",
      deployment: "cloudflare",
      database: "d1",
      packageManager: "bun",
      install: false,
      heyoStatusVersion: `file:${statusArchive}`,
    });
    // Allow the smoke test to avoid a developer's existing Vite server without
    // changing the default port in the published starter.
    if (
      template === "react-router" &&
      process.env.HEYO_STATUS_SCAFFOLD_RR_PORT
    ) {
      const alternatePort = Number(process.env.HEYO_STATUS_SCAFFOLD_RR_PORT);
      if (
        !Number.isInteger(alternatePort) ||
        alternatePort < 1 ||
        alternatePort > 65535
      ) {
        throw new Error("HEYO_STATUS_SCAFFOLD_RR_PORT must be a valid port");
      }
      port = alternatePort;
      const packagePath = join(projectPath, "package.json");
      const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
        scripts: { dev: string };
      };
      manifest.scripts.dev = manifest.scripts.dev.replaceAll(
        "5173",
        String(port),
      );
      await writeFile(packagePath, JSON.stringify(manifest, null, 2));
    }
    console.log(`\n▸ published ${template}/Cloudflare`);
    await assertSingleConfig(projectPath, "HEYO_STATUS_D1");
    await run("bun", ["install"], projectPath);
    await run("bun", ["run", "build"], projectPath);

    const log = join(temporary, `${template}.log`);
    await serve(
      projectPath,
      ["run", "dev", ...(template === "astro" ? ["--ignore-lock"] : [])],
      log,
      async (child) => {
        await waitForStatus(child, log);
        await waitForInitialCheck(child, log);
        await assertDevCronGuard();
        await waitForTheme(child, log, "slate");
        await verifyThemeReload(projectPath, template, child, log, browser);
      },
    );
    // Still build and boot the real Worker, not just the framework proxy.
    port = 8787;
    await serve(projectPath, ["run", "start"], log, async (child) => {
      await waitForStatus(child, log);
      await assertProductionCronClosed();
      await waitForTheme(child, log, "fern");
      await run("bunx", ["wrangler", "deploy", "--dry-run"], projectPath);
    });
    console.log(
      `  ✓ ${template}: tarball, automatic local checks, D1, theme reload, Worker, dry-run`,
    );
    port = 3000;
  }

  // Installing packed Vercel starters catches scoped dependency overrides
  // ignored by package managers and database imports that break builds before
  // a PostgreSQL connection exists. Check all three framework templates.
  for (const template of testedTemplates) {
    const { projectPath: vercelProject } = await scaffoldProject({
      cwd: workspace,
      projectName: `audit-${template}-vercel`,
      template,
      theme: "slate",
      deployment: "vercel",
      database: "postgres",
      packageManager: "bun",
      install: false,
      heyoStatusVersion: `file:${statusArchive}`,
    });
    console.log(`\n▸ published ${template}/Vercel`);
    await assertSingleConfig(vercelProject, "connectionString");
    await run("bun", ["install"], vercelProject);
    await assertPatchedRouting(vercelProject);
    await run("bun", ["run", "build"], vercelProject);
    console.log(
      `  ✓ ${template}/Vercel: installed tarball, patched routing, build`,
    );
  }
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}

async function assertSingleConfig(
  project: string,
  databaseMarker: string,
): Promise<void> {
  const config = await readFile(join(project, "heyo-status.config.ts"), "utf8");
  if (
    !config.includes("lazyStatusDatabase") ||
    !config.includes(databaseMarker) ||
    config.includes("DATABASE_SETUP") ||
    config.includes("heyo-status.database") ||
    (await Bun.file(join(project, "heyo-status.database.ts")).exists())
  ) {
    throw new Error(`Database setup is not in the single config: ${project}`);
  }
}

async function assertPatchedRouting(project: string): Promise<void> {
  const lock = Bun.JSONC.parse(
    await readFile(join(project, "bun.lock"), "utf8"),
  ) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  const installed = Object.entries(lock.packages)
    .filter(
      ([name]) => name === "path-to-regexp" || name.endsWith("/path-to-regexp"),
    )
    .map(([, [specifier]]) => specifier);
  if (
    installed.length === 0 ||
    installed.some((name) =>
      /^path-to-regexp@(?:6\.[012]\.|8\.[0-3]\.)/.test(name),
    )
  ) {
    throw new Error(
      `Vulnerable path-to-regexp installed: ${installed.join(", ")}`,
    );
  }
}

async function assertPortAvailable(): Promise<void> {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  await new Promise<void>((done) => server.close(() => done()));
}

async function packageVersion(name: string): Promise<string> {
  const contents = await readFile(
    join(root, "packages", name, "package.json"),
    "utf8",
  );
  return (JSON.parse(contents) as { version: string }).version;
}

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}:\n${stdout}${stderr}`,
    );
  }
}

async function verifyThemeReload(
  project: string,
  template: (typeof templates)[number],
  child: ChildProcess,
  log: string,
  browser?: Browser,
): Promise<void> {
  const page = await browser?.newPage();
  const errors: string[] = [];
  page?.on("pageerror", (error) => errors.push(error.message));
  try {
    const status = page?.locator('main[data-slot="status-page"]');
    if (page && status) {
      const host = template === "next" ? "localhost" : "127.0.0.1";
      await page.emulateMedia({ colorScheme: "light" });
      const response = await page.goto(`http://${host}:${port}/`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok())
        throw new Error(`Browser page returned ${response?.status()}`);
      await status.waitFor();
    }
    const initialWidth = await status?.evaluate(
      (node) => getComputedStyle(node).maxWidth,
    );
    const config = join(project, "heyo-status.config.ts");
    let previous = "slate";
    for (const theme of browser
      ? ["fern", "onyx", "dune", "reed", "fern"]
      : ["fern"]) {
      const original = await readFile(config, "utf8");
      const updated = original.replace(
        `theme: "${previous}"`,
        `theme: "${theme}"`,
      );
      if (original === updated)
        throw new Error(`Cannot change theme in ${config}`);
      await writeFile(config, updated);
      await waitForTheme(child, log, theme);
      if (page && status) {
        // No page.reload(): prove the existing browser tab updates on its own.
        await page.waitForFunction(
          (name) =>
            document
              .querySelector('main[data-slot="status-page"]')
              ?.getAttribute("data-theme") === name,
          theme,
          { timeout: 45_000 },
        );
        if (errors.length)
          throw new Error(
            `Browser hydration/HMR errors: ${errors.join(" | ")}`,
          );
        const width = await status.evaluate(
          (node) => getComputedStyle(node).maxWidth,
        );
        if (theme === "reed" && width === initialWidth)
          throw new Error(`Theme changed in HTML but not in CSS: ${width}`);
      }
      previous = theme;
    }
    if (page) {
      // SSR markup and HMR alone could pass while client hydration is broken.
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
      await page.waitForFunction(
        () => document.documentElement.dataset.mode === "dark",
      );
      if (errors.length)
        throw new Error(`Browser errors: ${errors.join(" | ")}`);
    }
  } catch (error) {
    throw new Error(`${String(error)}\n${await readFile(log, "utf8")}`);
  } finally {
    await page?.close();
  }
}

async function serve(
  project: string,
  args: string[],
  log: string,
  verify: (child: ChildProcess) => Promise<void>,
): Promise<void> {
  await assertPortAvailable();
  const descriptor = openSync(log, "w");
  const child = spawn("bun", args, {
    cwd: project,
    detached: true,
    stdio: ["ignore", descriptor, descriptor],
  });
  try {
    await verify(child);
  } finally {
    await stop(child);
    closeSync(descriptor);
    // Wrangler/Next can release their socket shortly after the parent exits.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await assertPortAvailable();
        break;
      } catch (error) {
        if (attempt === 19) throw error;
        await Bun.sleep(250);
      }
    }
  }
}

async function waitForTheme(
  child: ChildProcess,
  log: string,
  theme: string,
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(5_000),
        headers: { "Cache-Control": "no-cache" },
      });
      if (
        page.ok &&
        (await page.text()).includes(
          `data-slot="status-page" data-theme="${theme}"`,
        )
      )
        return;
    } catch {
      /* dev server may be recompiling */
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Theme ${theme} did not appear without a restart:\n${await readFile(log, "utf8")}`,
  );
}

async function waitForStatus(child: ChildProcess, log: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/heyo-status/status`,
        {
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (response.ok) {
        const body: unknown = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "monitors" in body &&
          Array.isArray(body.monitors)
        ) {
          // An API-only probe misses duplicate React instances in the Worker:
          // /status succeeds, but rendering the SSR page fails with HTTP 500.
          const page = await fetch(`http://127.0.0.1:${port}/`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (!page.ok)
            throw new Error(`Worker SSR page answered ${page.status}`);
          const html = await page.text();
          if (!html.includes('data-slot="status-page"')) {
            throw new Error("Worker SSR page is missing the status-page slot");
          }
          const snapshot = body as {
            activeIncidents: unknown[];
            scheduledMaintenances: unknown[];
          };
          if (
            (snapshot.activeIncidents.length === 0 &&
              !html.includes("No active incidents.")) ||
            (snapshot.scheduledMaintenances.length === 0 &&
              !html.includes("No upcoming maintenance."))
          ) {
            throw new Error(
              "Worker SSR page is missing empty incident or maintenance sections",
            );
          }
          const logo = await fetch(`http://127.0.0.1:${port}/heyo.svg`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (!logo.ok) throw new Error(`Worker logo answered ${logo.status}`);
          return;
        }
      }
    } catch {
      // No listener until build, migrations and Worker initialization finish.
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Generated Worker failed to answer:\n${await readFile(log, "utf8")}`,
  );
}

async function assertDevCronGuard(): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/heyo-status/dev-cron/cron`,
    {
      method: "POST",
      headers: {
        "x-heyo-status-dev-cron": "checks",
        origin: "https://example.com",
      },
    },
  );
  if (response.status !== 403)
    throw new Error(`Expected guarded dev cron, got HTTP ${response.status}`);
}

async function assertProductionCronClosed(): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/heyo-status/dev-cron/cron`,
    {
      method: "POST",
      headers: { "x-heyo-status-dev-cron": "checks" },
    },
  );
  if (response.status !== 404)
    throw new Error(`Production cron route returned HTTP ${response.status}`);
}

async function waitForInitialCheck(
  child: ChildProcess,
  log: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/heyo-status/status`,
        {
          signal: AbortSignal.timeout(5_000),
          headers: { "Cache-Control": "no-cache" },
        },
      );
      if (response.ok) {
        const snapshot = (await response.json()) as {
          monitors: Array<{ latestCheckedAt: string | null }>;
        };
        if (snapshot.monitors.some((monitor) => monitor.latestCheckedAt)) {
          const page = await fetch(`http://127.0.0.1:${port}/`);
          if (
            !page.ok ||
            !(await page.text()).includes('data-slot="status-page"')
          ) {
            throw new Error("Page did not render after the initial check");
          }
          return;
        }
      }
    } catch {
      // The initial check may still be running.
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `No automatic check appeared in local D1:\n${await readFile(log, "utf8")}`,
  );
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  const exited = new Promise<void>((done) => {
    if (child.exitCode !== null) return done();
    child.once("exit", () => done());
  });
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already exited */
  }
  await Promise.race([exited, Bun.sleep(5_000)]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
    await exited;
  }
}
