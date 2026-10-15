import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchesCronExpression, runCli } from "../src/cli";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

test("check run loads configuration, persists results, and returns a healthy exit code", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok"),
  });
  const directory = await mkdtemp(join(tmpdir(), "heyo-status-cli-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "status.sqlite");
  const configPath = join(directory, "heyo-status.config.ts");
  const dbModuleUrl = new URL("../src/db.ts", import.meta.url).href;

  await writeFile(
    configPath,
    `
      import { sqlite } from ${JSON.stringify(dbModuleUrl)};

      export default {
        database: sqlite(${JSON.stringify(databasePath)}),
        monitors: [{
          name: "Website",
          type: "http",
          url: ${JSON.stringify(`http://localhost:${server.port}`)},
          expectedStatus: [200],
        }],
      };
    `,
  );

  try {
    await expect(
      runCli(["check", "run", "--config", configPath]),
    ).resolves.toBe(0);
    const reader = new Database(databasePath);
    try {
      const row = reader
        .query("SELECT name, type, status, latency_ms FROM status_results")
        .get() as {
        name: string;
        type: string;
        status: number;
        latency_ms: number;
      };

      expect(row).toMatchObject({ name: "Website", type: "http", status: 1 });
      expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    } finally {
      reader.close();
    }
  } finally {
    server.stop(true);
  }
});

test("incident and maintenance commands persist their stage-5 records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heyo-status-cli-stage-5-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "status.sqlite");
  const configPath = join(directory, "heyo-status.config.ts");
  const dbModuleUrl = new URL("../src/db.ts", import.meta.url).href;

  await writeFile(
    configPath,
    `
      import { sqlite } from ${JSON.stringify(dbModuleUrl)};

      export default {
        database: sqlite(${JSON.stringify(databasePath)}),
        monitors: [{
          name: "API",
          type: "http",
          url: "https://api.example.com",
        }],
      };
    `,
  );

  await expect(
    runCli([
      "incident",
      "create",
      "--title",
      "API outage",
      "--severity",
      "major",
      "--monitors",
      "API",
      "--message",
      "Investigating.",
      "--config",
      configPath,
    ]),
  ).resolves.toBe(0);

  const reader = new Database(databasePath);
  try {
    const incident = reader
      .query("SELECT id, status FROM incidents LIMIT 1")
      .get() as { id: string; status: string };
    expect(incident.status).toBe("investigating");

    await expect(
      runCli([
        "incident",
        "update",
        incident.id,
        "--status",
        "identified",
        "--message",
        "Root cause found.",
        "--config",
        configPath,
      ]),
    ).resolves.toBe(0);
    await expect(
      runCli([
        "incident",
        "resolve",
        incident.id,
        "--message",
        "Resolved.",
        "--config",
        configPath,
      ]),
    ).resolves.toBe(0);
    await expect(
      runCli([
        "maintenance",
        "create",
        "--title",
        "Database upgrade",
        "--monitors",
        "API",
        "--start",
        "2030-01-01T02:00:00Z",
        "--end",
        "2030-01-01T04:00:00Z",
        "--config",
        configPath,
      ]),
    ).resolves.toBe(0);

    const totals = reader
      .query(
        `SELECT
          (SELECT COUNT(*) FROM incident_updates) AS updates,
          (SELECT COUNT(*) FROM maintenance_windows) AS maintenance`,
      )
      .get() as { updates: number; maintenance: number };
    expect(totals).toEqual({ updates: 3, maintenance: 1 });
  } finally {
    reader.close();
  }
});

test("db migrate accepts an embedded SQLite configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heyo-status-migrate-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "status.sqlite");
  const configPath = join(directory, "heyo-status.config.ts");
  const dbModuleUrl = new URL("../src/db.ts", import.meta.url).href;

  await writeFile(
    configPath,
    `
      import { sqlite } from ${JSON.stringify(dbModuleUrl)};
      export default { database: sqlite(${JSON.stringify(databasePath)}) };
    `,
  );

  await expect(runCli(["db", "migrate", "--config", configPath])).resolves.toBe(
    0,
  );
  const reader = new Database(databasePath);
  try {
    expect(
      reader
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'status_results'",
        )
        .get(),
    ).toEqual({ name: "status_results" });
  } finally {
    reader.close();
  }
});

/**
 * Every subcommand used to be returned rather than awaited inside the handler,
 * so a rejected promise escaped the command loop: the process printed a stack
 * trace and never reached the `heyo-status failed: ...` exit path.
 */
test("reports a failing command as one message and a non-zero exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heyo-status-failure-"));
  temporaryDirectories.push(directory);
  const configPath = join(directory, "heyo-status.config.ts");
  const dbModuleUrl = new URL("../src/db.ts", import.meta.url).href;

  await writeFile(
    configPath,
    `
      import { lazyStatusDatabase } from ${JSON.stringify(dbModuleUrl)};

      export default {
        database: lazyStatusDatabase(() => {
          throw new Error("Cloudflare D1 is not bound.");
        }),
        monitors: [{ name: "Website", type: "http", url: "https://example.com" }],
      };
    `,
  );

  const errors: string[] = [];
  const consoleError = console.error;
  console.error = (message: unknown) => errors.push(String(message));
  try {
    await expect(
      runCli(["check", "run", "--config", configPath]),
    ).resolves.toBe(1);
    await expect(
      runCli(["incident", "resolve", "--config", configPath]),
    ).resolves.toBe(1);
  } finally {
    console.error = consoleError;
  }

  expect(errors[0]).toBe("heyo-status failed: Cloudflare D1 is not bound.");
  expect(errors[1]).toBe("heyo-status failed: incident id is required.");
});

test("matches the five-field cron expressions used by local development", () => {
  const fivePastMidnight = new Date("2030-01-07T00:05:00.000Z");
  expect(matchesCronExpression("*/5 * * * *", fivePastMidnight)).toBe(true);
  expect(
    matchesCronExpression("*/5 * * * *", new Date("2030-01-07T00:06:00Z")),
  ).toBe(false);
  expect(matchesCronExpression("5 0 * * 1", fivePastMidnight)).toBe(true);
  expect(matchesCronExpression("invalid", fivePastMidnight)).toBe(false);
});

test("db seed persists deterministic uptime history and compacts completed days", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heyo-status-seed-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "status.sqlite");
  const configPath = join(directory, "heyo-status.config.ts");
  const dbModuleUrl = new URL("../src/db.ts", import.meta.url).href;

  await writeFile(
    configPath,
    `
      import { sqlite } from ${JSON.stringify(dbModuleUrl)};

      export default {
        database: sqlite(${JSON.stringify(databasePath)}),
        monitors: [{
          name: "Website",
          type: "http",
          url: "https://example.com",
        }],
      };
    `,
  );

  await expect(
    runCli([
      "db",
      "seed",
      "--uptime",
      "75",
      "--days",
      "2",
      "--config",
      configPath,
    ]),
  ).resolves.toBe(0);

  const reader = new Database(databasePath);
  try {
    const totals = reader
      .query(
        `
          SELECT
            (SELECT COUNT(*) FROM status_results) AS raw_checks,
            (SELECT COUNT(*) FROM status_daily_summaries) AS summary_days,
            (SELECT COALESCE(SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END), 0) FROM status_results) +
              (SELECT COALESCE(SUM(down_checks), 0) FROM status_daily_summaries) AS down_checks
        `,
      )
      .get() as {
      raw_checks: number;
      summary_days: number;
      down_checks: number;
    };

    expect(totals).toEqual({
      raw_checks: 100,
      summary_days: 1,
      down_checks: 50,
    });
  } finally {
    reader.close();
  }
});
