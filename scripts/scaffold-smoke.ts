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

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "heyo-status-scaffold-"));
const templates = ["next", "astro", "react-router"] as const;
const port = 8787; // Wrangler's default; projects are tested one at a time.

try {
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

  for (const template of templates) {
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
    console.log(`\n▸ published ${template}/Cloudflare`);
    await assertSingleConfig(projectPath, "HEYO_STATUS_D1");
    await run("bun", ["install"], projectPath);
    await run("bun", ["run", "build"], projectPath);

    const log = join(temporary, `${template}.log`);
    await serve(
      projectPath,
      [
        "run",
        "dev",
        "--port",
        String(port),
        ...(template === "astro" ? ["--ignore-lock"] : []),
        ...(template !== "next" ? ["--host", "127.0.0.1"] : []),
      ],
      log,
      async (child) => {
        await waitForStatus(child, log);
        await waitForTheme(child, log, "slate");
        const config = join(projectPath, "heyo-status.config.ts");
        const original = await readFile(config, "utf8");
        await writeFile(
          config,
          original.replace('theme: "slate"', 'theme: "fern"'),
        );
        await waitForTheme(child, log, "fern");
      },
    );
    // Still build and boot the real Worker, not just the framework proxy.
    await serve(projectPath, ["run", "start"], log, async (child) => {
      await waitForStatus(child, log);
      await waitForTheme(child, log, "fern");
      await run("bunx", ["wrangler", "deploy", "--dry-run"], projectPath);
    });
    console.log(`  ✓ ${template}: tarball, D1, theme reload, Worker, dry-run`);
  }

  // Installing packed Vercel starters catches scoped dependency overrides
  // ignored by package managers and database imports that break builds before
  // a PostgreSQL connection exists. Check all three framework templates.
  for (const template of templates) {
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
          if (!(await page.text()).includes('data-slot="status-page"')) {
            throw new Error("Worker SSR page is missing the status-page slot");
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
