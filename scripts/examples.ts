#!/usr/bin/env bun
/**
 * Local harness for the six deployment examples.
 *
 * The examples are the projects people copy, but every one of them needs a
 * different database before it renders a single row: the Vercel trio wants a
 * Postgres connection string plus migrations, the Cloudflare trio wants a
 * local D1 state directory. Checking one by hand means six different setups,
 * so nobody checks them and they drift. This script makes one command boot an
 * example with its database ready, and one command walk all six and assert the
 * same contract against each.
 *
 *   bun run example list
 *   bun run example up next-vercel
 *   bun run example smoke
 *   bun run example smoke astro-cloudflare react-router-vercel
 *   bun run example reset
 *
 * No process survives the command. Dev servers are killed with their process
 * group, and a Postgres container this script starts is removed on exit.
 * Local D1 state and databases on an existing Postgres server are retained
 * until `example reset` so repeated runs can test migrations and persistence.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

type DatabaseKind = "postgres" | "d1";

interface Example {
  readonly name: string;
  /** Framework binary in the example's own node_modules/.bin. */
  readonly bin: string;
  readonly database: DatabaseKind;
  /** Fixed port so two examples never fight and links stay memorable. */
  readonly port: number;
  /** Vercel projects expose the scheduler as HTTP cron routes. */
  readonly cronRoutes: boolean;
}

const examples: readonly Example[] = [
  { name: "next-vercel", bin: "next", database: "postgres", port: 4310, cronRoutes: true }, // prettier-ignore
  { name: "next-cloudflare", bin: "next", database: "d1", port: 4311, cronRoutes: false }, // prettier-ignore
  { name: "astro-vercel", bin: "astro", database: "postgres", port: 4312, cronRoutes: true }, // prettier-ignore
  { name: "astro-cloudflare", bin: "astro", database: "d1", port: 4313, cronRoutes: false }, // prettier-ignore
  { name: "react-router-vercel", bin: "react-router", database: "postgres", port: 4314, cronRoutes: true }, // prettier-ignore
  { name: "react-router-cloudflare", bin: "react-router", database: "d1", port: 4315, cronRoutes: false }, // prettier-ignore
];

const repositoryRoot = join(import.meta.dirname, "..");
const examplesRoot = join(repositoryRoot, "examples");
const logDirectory = join(repositoryRoot, ".heyo-playground");

/**
 * Secrets the harness injects. The examples read `HEYO_STATUS_API_TOKEN` and
 * `CRON_SECRET` from the environment, so a local run can exercise the write
 * half of the API that a deployed page keeps closed.
 */
const adminToken = "local-playground-token";
const cronSecret = "local-playground-cron";

/** Container used only when no Postgres is already listening locally. */
const dockerContainer = "heyo-status-playground-postgres";
const dockerPort = 55432;
const dockerPassword = "heyo-status";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
  const positionals = argv.filter((argument) => !argument.startsWith("--"));
  const [command = "list", ...names] = positionals;

  if (command === "list") {
    printList();
    return 0;
  }

  const unknown = names.filter(
    (name) => !examples.some((example) => example.name === name),
  );
  const selected = selectExamples(names);
  if (unknown.length > 0) {
    console.error(
      `Unknown example(s): ${unknown.join(", ")}. Run "bun run example list".`,
    );
    return 1;
  }

  try {
    if (command === "stop") {
      for (const example of selected) {
        const killed = await killPortListeners(example.port);
        console.log(
          killed.length === 0
            ? `  ${example.name}: nothing on port ${example.port}`
            : `  ${example.name}: killed ${killed.join(", ")} on port ${example.port}`,
        );
      }
      if (startedDockerPostgres) await removeDockerPostgres();
      return 0;
    }

    if (command === "reset") {
      for (const example of selected) await resetExample(example);
      if (startedDockerPostgres) await removeDockerPostgres();
      return 0;
    }

    if (!flags.has("--no-build")) await buildPackage();

    if (command === "up") {
      if (names.length !== 1) {
        console.error('"up" takes exactly one example name.');
        return 1;
      }
      return await runExample(selected[0]!, flags);
    }

    if (command === "smoke") {
      return await smokeExamples(selected);
    }

    console.error(`Unknown command: ${command}`);
    printUsage();
    return 1;
  } finally {
    // A container this script started is this script's to clean up; a Postgres
    // that was already running belongs to the machine and is left alone.
    if (startedDockerPostgres && !flags.has("--keep-db")) {
      await removeDockerPostgres();
    }
  }
}

function printUsage(): void {
  console.log(
    [
      "",
      "  bun run example list                 show every example and its database",
      "  bun run example up <name>            boot one example with its database ready",
      "  bun run example smoke [name...]      boot each example and assert the API contract",
      "  bun run example reset [name...]      drop the local databases and D1 state",
      "  bun run example stop [name...]       kill anything left on the example ports",
      "",
      "  --no-build   skip rebuilding @heyo-sh/heyo-status first",
      "  --no-seed    (up) do not run an initial check before handing over",
      "  --keep-db    leave a Postgres container this script started running",
      "",
    ].join("\n"),
  );
}

function printList(): void {
  console.log("\n  Deployment examples\n");
  for (const example of examples) {
    const database = example.database === "d1" ? "D1 (local)" : "Postgres";
    console.log(
      `  ${example.name.padEnd(24)} ${database.padEnd(12)} http://localhost:${example.port}`,
    );
  }
  printUsage();
}

function selectExamples(names: string[]): Example[] {
  if (names.length === 0) return [...examples];
  return names
    .map((name) => examples.find((example) => example.name === name))
    .filter((example): example is Example => example !== undefined);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Boots one example and leaves it running until Ctrl-C. */
async function runExample(
  example: Example,
  flags: Set<string>,
): Promise<number> {
  const environment = await prepareDatabase(example);
  const server = await startDevServer(example, environment, "inherit");

  try {
    if (!flags.has("--no-seed")) {
      // A page with no stored results looks broken rather than empty, so the
      // first check runs before the URL is printed.
      await request(example, "POST", "/admin/checks/run");
    }
    const base = `http://localhost:${example.port}`;
    console.log(
      [
        "",
        `  ${example.name} is ready`,
        `    page      ${base}/`,
        `    api       ${base}/api/heyo-status/status`,
        `    admin     curl -X POST -H "Authorization: Bearer ${adminToken}" ${base}/api/heyo-status/admin/checks/run`,
        example.cronRoutes
          ? `    cron      curl -H "Authorization: Bearer ${cronSecret}" ${base}/api/cron/checks`
          : "    cron      Worker scheduled() handler; not reachable over HTTP in dev",
        "",
        "  Ctrl-C to stop.",
        "",
      ].join("\n"),
    );
    await waitForInterrupt();
    return 0;
  } finally {
    await server.stop();
  }
}

/** Walks every selected example and asserts the same contract against each. */
async function smokeExamples(selected: Example[]): Promise<number> {
  const summaries: { name: string; failures: number; duration: number }[] = [];

  for (const example of selected) {
    const startedAt = Date.now();
    console.log(`\n▸ ${example.name} (${example.database})`);
    let failures = 0;
    try {
      const environment = await prepareDatabase(example);
      const logPath = join(logDirectory, `${example.name}.log`);
      const server = await startDevServer(example, environment, logPath);
      try {
        failures = await runChecks(example);
      } finally {
        await server.stop();
      }
      if (failures > 0) console.log(`  server log: ${logPath}`);
    } catch (error) {
      failures = 1;
      console.log(`  ✗ ${errorMessage(error)}`);
    }
    summaries.push({
      name: example.name,
      failures,
      duration: Date.now() - startedAt,
    });
  }

  console.log("\n  Summary\n");
  for (const summary of summaries) {
    const mark = summary.failures === 0 ? "✓" : "✗";
    const detail =
      summary.failures === 0 ? "ok" : `${summary.failures} failed check(s)`;
    console.log(
      `  ${mark} ${summary.name.padEnd(24)} ${detail.padEnd(20)} ${Math.round(summary.duration / 1000)}s`,
    );
  }
  console.log("");

  return summaries.some((summary) => summary.failures > 0) ? 1 : 0;
}

async function resetExample(example: Example): Promise<void> {
  if (example.database === "d1") {
    await rm(join(examplesRoot, example.name, ".wrangler", "state"), {
      recursive: true,
      force: true,
    });
    console.log(`  reset ${example.name}: local D1 state removed`);
    return;
  }

  if (process.env.DATABASE_URL) {
    console.log(`  reset ${example.name}: skipped, DATABASE_URL is yours`);
    return;
  }
  // Reset never starts a server: there is nothing to drop on one that is down.
  const server = await findRunningPostgresServer(example);
  if (!server) {
    console.log(
      `  reset ${example.name}: no Postgres running, nothing to drop`,
    );
    return;
  }
  const client = await connectPostgres(example, `${server}/postgres`);
  try {
    await client.query(
      `DROP DATABASE IF EXISTS "${postgresDatabaseName(example)}" WITH (FORCE)`,
    );
    console.log(`  reset ${example.name}: database dropped`);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

/** Applies migrations and returns the environment the dev server needs. */
async function prepareDatabase(
  example: Example,
): Promise<Record<string, string>> {
  if (example.database === "d1") {
    await applyD1Migrations(example);
    return {};
  }
  const url = await preparePostgres(example);
  return { DATABASE_URL: url };
}

/**
 * Applies the bundled migrations to the Miniflare state directory that every
 * Cloudflare dev proxy (`initOpenNextCloudflareForDev`, `cloudflareDevProxy`,
 * `@astrojs/cloudflare`) reads, so `next|astro|react-router dev` sees a real D1
 * binding without `wrangler dev`.
 */
async function applyD1Migrations(example: Example): Promise<void> {
  const directory = join(examplesRoot, example.name);
  const result = await execute(
    binaryPath(directory, "wrangler"),
    ["d1", "migrations", "apply", "heyo-status", "--local"],
    { cwd: directory, input: "y\n" },
  );
  if (result.code !== 0) {
    throw new Error(`wrangler d1 migrations apply failed:\n${result.output}`);
  }
  console.log("  database: local D1 migrated");
}

async function preparePostgres(example: Example): Promise<string> {
  const url =
    process.env.DATABASE_URL ?? (await createPostgresDatabase(example));
  const directory = join(examplesRoot, example.name);
  const result = await execute("bun", ["run", "db:migrate"], {
    cwd: directory,
    environment: { DATABASE_URL: url },
  });
  if (result.code !== 0) {
    throw new Error(`db:migrate failed:\n${result.output}`);
  }
  console.log(`  database: ${redact(url)} migrated`);
  return url;
}

function postgresDatabaseName(example: Example): string {
  return `heyo_status_${example.name.replaceAll("-", "_")}`;
}

/** Creates a per-example database so one smoke run never reads another's rows. */
async function createPostgresDatabase(example: Example): Promise<string> {
  const server = await resolvePostgresServer(example);
  const name = postgresDatabaseName(example);
  const client = await connectPostgres(example, `${server}/postgres`);
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    // 42P04 is "database already exists", which is the normal second run.
    if ((error as { code?: string }).code !== "42P04") throw error;
  } finally {
    await client.end();
  }
  return `${server}/${name}`;
}

/**
 * Prefers a Postgres that is already listening, because starting a container
 * for a database the machine already runs is the slowest possible way to see
 * a status page — and because a reused server is one this script must not
 * stop afterwards.
 */
async function resolvePostgresServer(example: Example): Promise<string> {
  if (postgresServer) return postgresServer;

  const local = `postgres://${process.env.USER ?? "postgres"}@localhost:5432`;
  if (await canConnect(example, `${local}/postgres`)) {
    console.log(
      "  database: reusing the Postgres already listening on localhost:5432",
    );
    postgresServer = local;
    return local;
  }

  await startDockerPostgres();
  const container = `postgres://postgres:${dockerPassword}@localhost:${dockerPort}`;
  // The container accepts TCP before it finishes initialising the cluster.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canConnect(example, `${container}/postgres`)) {
      postgresServer = container;
      return container;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    "No Postgres available. Start one locally, start Docker, or set DATABASE_URL.",
  );
}

/** Set once a container is started, so only that container is removed later. */
let startedDockerPostgres = false;
/** Resolved once per run; every example then shares the same server. */
let postgresServer: string | undefined;

async function startDockerPostgres(): Promise<void> {
  const running = await execute("docker", [
    "ps",
    "--filter",
    `name=^/${dockerContainer}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (running.code !== 0) {
    throw new Error(
      "No local Postgres and no Docker daemon. Set DATABASE_URL or start one of them.",
    );
  }
  if (running.output.includes(dockerContainer)) {
    console.log(`  database: reusing the ${dockerContainer} container`);
    return;
  }

  console.log("  database: starting a temporary Postgres container…");
  // A stopped container with this name may belong to a different session.
  // Never delete it just to make room for our temporary database.
  const existing = await execute("docker", [
    "ps",
    "--all",
    "--filter",
    `name=^/${dockerContainer}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (existing.code !== 0 || existing.output.trim() === dockerContainer) {
    throw new Error(
      `Container ${dockerContainer} already exists; start or remove it yourself.`,
    );
  }
  const started = await execute("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    dockerContainer,
    "--env",
    `POSTGRES_PASSWORD=${dockerPassword}`,
    "--publish",
    `${dockerPort}:5432`,
    "postgres:17-alpine",
  ]);
  if (started.code !== 0) {
    throw new Error(`Unable to start Docker Postgres:\n${started.output}`);
  }
  startedDockerPostgres = true;
}

/** Finds a reachable Postgres without starting anything. */
async function findRunningPostgresServer(
  example: Example,
): Promise<string | undefined> {
  const candidates = [
    `postgres://${process.env.USER ?? "postgres"}@localhost:5432`,
    `postgres://postgres:${dockerPassword}@localhost:${dockerPort}`,
  ];
  for (const candidate of candidates) {
    if (await canConnect(example, `${candidate}/postgres`)) return candidate;
  }
  return undefined;
}

/** Removes the harness container; a no-op when Docker never ran one. */
async function removeDockerPostgres(): Promise<void> {
  if (!startedDockerPostgres) return;
  const removed = await execute("docker", ["rm", "--force", dockerContainer]);
  if (removed.code === 0 && removed.output.includes(dockerContainer)) {
    console.log(`  database: removed the ${dockerContainer} container`);
  }
  startedDockerPostgres = false;
}

/**
 * `pg` is a dependency of the Vercel examples rather than of this repository,
 * so the driver is resolved from the example that is about to use it.
 */
async function connectPostgres(
  example: Example,
  url: string,
): Promise<{
  query(text: string): Promise<unknown>;
  end(): Promise<void>;
}> {
  const directory = join(examplesRoot, example.name);
  const module = (await import(Bun.resolveSync("pg", directory))) as {
    default?: { Client: new (options: { connectionString: string }) => never };
    Client?: new (options: { connectionString: string }) => never;
  };
  const Client = module.Client ?? module.default?.Client;
  if (!Client) throw new Error("Unable to load the pg driver.");
  const client = new Client({ connectionString: url }) as unknown as {
    connect(): Promise<void>;
    query(text: string): Promise<unknown>;
    end(): Promise<void>;
  };
  await client.connect();
  return client;
}

async function canConnect(example: Example, url: string): Promise<boolean> {
  try {
    const client = await connectPostgres(example, url);
    await client.end();
    return true;
  } catch {
    return false;
  }
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:@/]+):[^@]*@/, "://$1:***@");
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

interface RunningServer {
  stop(): Promise<void>;
}

/** Address a booted example actually answers on, filled in by `waitForServer`. */
const baseUrls = new Map<string, string>();

function baseUrl(example: Example): string {
  return baseUrls.get(example.name) ?? `http://127.0.0.1:${example.port}`;
}

/**
 * Starts the example's own dev command. The process gets its own group so
 * stopping it also stops the compiler workers the frameworks fork, which
 * otherwise keep the port bound and fail the next example in the run.
 */
async function startDevServer(
  example: Example,
  environment: Record<string, string>,
  output: "inherit" | string,
): Promise<RunningServer> {
  const directory = join(examplesRoot, example.name);

  // A leftover server from an earlier run would answer every check with stale
  // code and report a pass, which is worse than any crash this could cause.
  const busy = await portListeners(example.port);
  if (busy.length > 0) {
    throw new Error(
      `port ${example.port} is already in use by pid ${busy.join(", ")}; run "bun run example stop".`,
    );
  }

  // Astro's Cloudflare adapter reads secrets from Worker bindings instead of
  // Node's process.env. Give this local harness its own binding without ever
  // overwriting a user's .dev.vars file.
  const localVars = join(directory, ".dev.vars");
  let createdVars = false;
  if (example.name === "astro-cloudflare") {
    if (existsSync(localVars)) {
      const contents = await readFile(localVars, "utf8");
      if (
        !/HEYO_STATUS_API_TOKEN=["']?local-playground-token["']?(?:\s|$)/m.test(
          contents,
        )
      ) {
        throw new Error(
          `${localVars} already exists; set HEYO_STATUS_API_TOKEN=local-playground-token to run the example harness.`,
        );
      }
    } else {
      await writeFile(localVars, `HEYO_STATUS_API_TOKEN="${adminToken}"\n`);
      createdVars = true;
    }
  }

  let logFile: number | undefined;
  if (output !== "inherit") {
    await mkdir(logDirectory, { recursive: true });
    logFile = openSync(output, "w");
  }

  const child = spawn(
    binaryPath(directory, example.bin),
    [
      "dev",
      "--port",
      String(example.port),
      // Astro 7 auto-backgrounds dev servers inside agent environments;
      // foreground ownership is required for reliable cleanup and smoke checks.
      ...(example.bin === "astro" ? ["--ignore-lock"] : []),
    ],
    {
      cwd: directory,
      detached: true,
      stdio: logFile === undefined ? "inherit" : ["ignore", logFile, logFile],
      env: {
        ...process.env,
        ...environment,
        HEYO_STATUS_API_TOKEN: adminToken,
        CRON_SECRET: cronSecret,
        HEYO_TELEMETRY_DISABLED: "1",
        NODE_ENV: "development",
        BROWSER: "none",
      },
    },
  );

  const server: RunningServer = {
    stop: async () => {
      await stopDevServer(child, example.port);
      if (logFile !== undefined) closeSync(logFile);
      if (createdVars) await rm(localVars, { force: true });
    },
  };

  try {
    await waitForServer(example, child);
  } catch (error) {
    await server.stop();
    const log = output === "inherit" ? "" : `\n${await tail(output, 25)}`;
    throw new Error(`${errorMessage(error)}${log}`);
  }
  return server;
}

/**
 * Waits for the first successful response and records the address that
 * produced it: Astro binds `localhost`, which on macOS is `::1` only, while
 * Next and Vite bind every interface. Probing both keeps one harness working
 * against all three without a per-framework host flag.
 */
async function waitForServer(
  example: Example,
  child: ChildProcess,
): Promise<void> {
  const candidates = [
    `http://127.0.0.1:${example.port}`,
    `http://[::1]:${example.port}`,
  ];
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${example.name} dev server exited early.`);
    }
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate}/`, {
          signal: AbortSignal.timeout(5_000),
        });
        await response.arrayBuffer();
        if (response.ok) {
          baseUrls.set(example.name, candidate);
          return;
        }
      } catch {
        // Connection refused until the framework finishes its first compile.
      }
    }
    await Bun.sleep(400);
  }
  throw new Error(`${example.name} did not answer on port ${example.port}.`);
}

/**
 * Stops the dev server and everything it forked. The process group covers the
 * normal case; the port is then checked directly, because a framework worker
 * that re-parents itself survives the group signal and would hold the port
 * against the next run.
 */
async function stopDevServer(child: ChildProcess, port: number): Promise<void> {
  if (child.pid !== undefined && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); // prettier-ignore
    signalGroup(child.pid, "SIGTERM");
    const timeout = Bun.sleep(5_000).then(() => "timeout" as const);
    if ((await Promise.race([exited, timeout])) === "timeout") {
      signalGroup(child.pid, "SIGKILL");
    }
  }
  await killPortListeners(port);
}

function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, which is the outcome this asked for.
  }
}

/** PIDs listening on a port. Empty when nothing listens or lsof is missing. */
async function portListeners(port: number): Promise<number[]> {
  const result = await execute("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  return result.output
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

/** Frees a port this harness owns, reporting anything that refuses to die. */
async function killPortListeners(port: number): Promise<number[]> {
  const killed = new Set<number>();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const listeners = await portListeners(port);
    if (listeners.length === 0) return [...killed];
    for (const pid of listeners) {
      killed.add(pid);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Exited between the listing and the signal.
      }
    }
    await Bun.sleep(300);
  }
  const remaining = await portListeners(port);
  if (remaining.length > 0) {
    console.log(
      `  ! port ${port} is still held by pid ${remaining.join(", ")}`,
    );
  }
  return [...killed];
}

function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

// ---------------------------------------------------------------------------
// Contract checks
// ---------------------------------------------------------------------------

interface CheckContext {
  incidentId?: string;
}

interface Check {
  readonly name: string;
  readonly run: (example: Example, context: CheckContext) => Promise<void>;
  /** Skips checks that cannot exist on a platform, instead of failing them. */
  readonly when?: (example: Example) => boolean;
}

const checks: readonly Check[] = [
  {
    name: "page renders server-side",
    run: async (example) => {
      const response = await request(example, "GET", "/", { api: false });
      const html = await response.text();
      assert(response.ok, `GET / answered ${response.status}`);
      assert(
        html.includes('data-slot="status-page"'),
        "the rendered page is missing the status-page slot",
      );
      assert(
        html.includes("<title>Acme Status</title>"),
        "the configured title is missing from page metadata",
      );
      assert(html.includes('src="/heyo.svg"'), "the Heyo logo is missing");
      assert(
        html.includes('alt="Acme Status"'),
        "the logo-only header needs an accessible name",
      );
      const logo = await request(example, "GET", "/heyo.svg", { api: false });
      assert(logo.ok, `GET /heyo.svg answered ${logo.status}`);
      assert(
        (await logo.text()).includes('viewBox="0 0 2408 2402"'),
        "the Heyo logo asset is missing",
      );
    },
  },
  {
    name: "liveness probe",
    run: async (example) => {
      const body = await json(await request(example, "GET", "/healthz"));
      assert(body.ok === true, "healthz did not report ok");
    },
  },
  {
    name: "management API refuses an anonymous write",
    run: async (example) => {
      const response = await request(example, "POST", "/admin/checks/run", {
        token: false,
      });
      assert(
        response.status === 401,
        `an unauthenticated write answered ${response.status}, expected 401`,
      );
    },
  },
  {
    name: "checks run and persist",
    run: async (example) => {
      const results = (await json(
        await request(example, "POST", "/admin/checks/run"),
      )) as unknown as { name: string; message: string }[];
      assert(
        Array.isArray(results) && results.length > 0,
        "running checks returned no results",
      );
      assert(
        results.some((result) => result.name === "Website"),
        "the Website monitor did not report a result",
      );
      if (example.database === "postgres") {
        for (const [name, unavailable] of [
          ["Edge network", "TCP monitoring is unavailable"],
          ["TLS certificate", "TLS monitoring is unavailable"],
        ]) {
          const result = results.find((entry) => entry.name === name);
          assert(result, `${name} monitor did not run`);
          assert(
            !result.message.includes(unavailable),
            `${name} monitor loaded a browser shim instead of a Node builtin`,
          );
        }
      }
    },
  },
  {
    name: "snapshot reads the stored result back",
    run: async (example) => {
      const snapshot = await json(await request(example, "GET", "/status"));
      const monitors = snapshot.monitors as { latestStatus: unknown }[];
      assert(monitors.length > 0, "the snapshot lists no monitors");
      assert(
        monitors[0]?.latestStatus !== null,
        "the stored check result did not reach the snapshot",
      );
    },
  },
  {
    name: "summary reports data",
    run: async (example) => {
      const summary = await json(
        await request(example, "GET", "/status/summary"),
      );
      assert(summary.hasData === true, "the summary still reports no data");
    },
  },
  {
    name: "uptime windows",
    run: async (example) => {
      const uptime = await json(
        await request(example, "GET", "/monitors/Website/uptime"),
      );
      assert("24h" in uptime, "the uptime response has no 24h window");
    },
  },
  {
    name: "badge renders",
    run: async (example) => {
      const response = await request(example, "GET", "/badge/Website.svg");
      const svg = await response.text();
      assert(response.ok, `the badge answered ${response.status}`);
      assert(svg.includes("<svg"), "the badge is not an SVG");
    },
  },
  {
    name: "incident is created",
    run: async (example, context) => {
      const response = await request(example, "POST", "/admin/incidents", {
        body: {
          title: "Playground incident",
          severity: "minor",
          affectedMonitors: ["Website"],
          message: "Opened by the local examples harness.",
        },
      });
      const incident = await json(response);
      assert(
        response.status === 201,
        `creating an incident answered ${response.status}`,
      );
      assert(typeof incident.id === "string", "the incident has no id");
      context.incidentId = incident.id as string;
    },
  },
  {
    name: "incident appears in the public list",
    run: async (example, context) => {
      const incidents = (await json(
        await request(example, "GET", "/incidents"),
      )) as unknown as { id: string }[];
      assert(
        incidents.some((incident) => incident.id === context.incidentId),
        "the new incident is missing from /incidents",
      );
    },
  },
  {
    name: "incident appears in the feed",
    run: async (example) => {
      const response = await request(example, "GET", "/rss.xml");
      const feed = await response.text();
      assert(response.ok, `the feed answered ${response.status}`);
      assert(
        feed.includes("Playground incident"),
        "the feed does not list the new incident",
      );
    },
  },
  {
    name: "incident resolves",
    run: async (example, context) => {
      const response = await request(
        example,
        "PATCH",
        `/admin/incidents/${context.incidentId}`,
        {
          body: { status: "resolved", message: "Closed by the harness." },
        },
      );
      const incident = await json(response);
      assert(response.ok, `resolving answered ${response.status}`);
      assert(
        incident.status === "resolved",
        `the incident stayed ${String(incident.status)}`,
      );

      const snapshot = await json(await request(example, "GET", "/status"));
      const active = snapshot.activeIncidents as { id: string }[];
      assert(
        !active.some((candidate) => candidate.id === context.incidentId),
        "the resolved incident still counts as active",
      );
    },
  },
  {
    name: "cron route runs the scheduler",
    when: (example) => example.cronRoutes,
    run: async (example) => {
      const response = await fetch(`${baseUrl(example)}/api/cron/checks`, {
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      await response.arrayBuffer();
      assert(response.ok, `the cron route answered ${response.status}`);
    },
  },
];

async function runChecks(example: Example): Promise<number> {
  const context: CheckContext = {};
  let failures = 0;

  for (const check of checks) {
    if (check.when && !check.when(example)) {
      console.log(`  – ${check.name} (not applicable)`);
      continue;
    }
    try {
      await check.run(example, context);
      console.log(`  ✓ ${check.name}`);
    } catch (error) {
      failures += 1;
      console.log(`  ✗ ${check.name}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

interface RequestOptions {
  body?: unknown;
  token?: boolean;
  api?: boolean;
}

function request(
  example: Example,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const prefix = options.api === false ? "" : "/api/heyo-status";
  const headers: Record<string, string> = {};
  if (options.token !== false) {
    headers.authorization = `Bearer ${adminToken}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return fetch(`${baseUrl(example)}${prefix}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(60_000),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `expected JSON, received ${response.status} ${text.slice(0, 120)}`,
    );
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/**
 * The examples import the built package, not its sources, so a change that is
 * not built is a change the harness would silently fail to test.
 */
async function buildPackage(): Promise<void> {
  console.log("  building @heyo-sh/heyo-status…");
  const result = await execute(
    "bun",
    ["run", "--filter", "@heyo-sh/heyo-status", "build"],
    { cwd: repositoryRoot },
  );
  if (result.code !== 0) {
    throw new Error(`Package build failed:\n${result.output}`);
  }
}

function binaryPath(directory: string, bin: string): string {
  const local = join(directory, "node_modules", ".bin", bin);
  return existsSync(local) ? local : bin;
}

async function execute(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    environment?: Record<string, string>;
  } = {},
): Promise<{ code: number; output: string }> {
  try {
    const child = Bun.spawn([command, ...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...options.environment },
      stdin: options.input ? new TextEncoder().encode(options.input) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, output: `${stdout}${stderr}` };
  } catch (error) {
    return { code: 1, output: errorMessage(error) };
  }
}

async function tail(path: string, lines: number): Promise<string> {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main(process.argv.slice(2));
