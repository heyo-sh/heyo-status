import { describe, expect, test } from "bun:test";

import {
  hasBunSqlite,
  hasNodeSqlite,
  lazyStatusDatabase,
  NodeSqliteStatusDatabase,
  sqlite as createSqlite,
  SQLiteStatusDatabase,
} from "../src/db";
import { heyoStatus } from "../src/config";
import type { CheckResult } from "../src/types";

// These cases assert the Bun/Drizzle implementation itself, so they construct
// it directly instead of going through the runtime-dispatching sqlite() factory.
const sqlite = (file: string) => new SQLiteStatusDatabase({ file });

describe("SQLiteStatusDatabase", () => {
  test("applies the stage-2 migration and persists full check results", async () => {
    const database = sqlite(":memory:");
    try {
      const tables = database.client
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "__heyo_status_migrations",
          "status_daily_summaries",
          "status_results",
        ]),
      );

      const earliest = result(
        "Website",
        "http",
        true,
        "2026-01-01T00:00:00.000Z",
        12,
      );
      const latest = result(
        "Database",
        "tcp",
        false,
        "2026-01-01T00:01:00.000Z",
        8,
      );
      await database.insertCheckResults([latest, earliest]);

      await expect(database.listResults()).resolves.toEqual([earliest, latest]);
      await expect(
        database.listResults({ names: ["Website"] }),
      ).resolves.toEqual([earliest]);
    } finally {
      database.close();
    }
  });

  test("summarizes complete UTC days with downtime and latency aggregates", async () => {
    const database = sqlite(":memory:");
    try {
      await database.insertCheckResults([
        result("API", "http", false, "2026-01-01T00:00:00.000Z", 10),
        result("API", "http", true, "2026-01-01T00:05:00.000Z", 20),
        result("API", "http", false, "2026-01-01T23:58:00.000Z", 30),
        result("DNS", "dns", true, "2026-01-01T12:00:00.000Z", 5),
        result("API", "http", true, "2026-01-02T00:00:00.000Z", 40),
      ]);

      await expect(
        database.summarizeHistory(new Date("2026-01-02T12:00:00.000Z")),
      ).resolves.toEqual({
        summarizedDays: 2,
        summarizedResults: 4,
        deletedResults: 4,
      });
      await expect(database.listResults()).resolves.toEqual([
        result("API", "http", true, "2026-01-02T00:00:00.000Z", 40),
      ]);

      const summaries = database.client
        .query(
          `
          SELECT name, total_checks, down_checks, down_minutes,
                 total_latency_ms, min_latency_ms, max_latency_ms, latest_status
          FROM status_daily_summaries
          ORDER BY name
        `,
        )
        .all() as Array<{
        name: string;
        total_checks: number;
        down_checks: number;
        down_minutes: number;
        total_latency_ms: number;
        min_latency_ms: number;
        max_latency_ms: number;
        latest_status: number;
      }>;
      expect(summaries).toEqual([
        {
          name: "API",
          total_checks: 3,
          down_checks: 2,
          down_minutes: 7,
          total_latency_ms: 60,
          min_latency_ms: 10,
          max_latency_ms: 30,
          latest_status: 0,
        },
        {
          name: "DNS",
          total_checks: 1,
          down_checks: 0,
          down_minutes: 0,
          total_latency_ms: 5,
          min_latency_ms: 5,
          max_latency_ms: 5,
          latest_status: 1,
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("cleans up old raw observations", async () => {
    const database = sqlite(":memory:");
    try {
      await database.insertCheckResults([
        result("Website", "http", true, "2000-01-01T00:00:00.000Z", 1),
      ]);

      await database.cleanup(1);
      await expect(database.listResults()).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("embedded SQLite runtime selection", () => {
  // A static bun:sqlite import is hoisted by every bundler, which used to make
  // `next start`, `react-router-serve` and a Node Astro server fail to boot.
  test("keeps the package importable without a Bun-only builtin", async () => {
    const source = await Bun.file(
      new URL("../src/db/sqlite.ts", import.meta.url),
    ).text();
    expect(source).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+"bun:sqlite"/m);
    expect(source).toContain('import type { Database } from "bun:sqlite"');
  });

  test("selects the Bun adapter on Bun and reports the Node fallback", () => {
    expect(hasBunSqlite()).toBe(true);
    const database = createSqlite(":memory:");
    try {
      expect(database).toBeInstanceOf(SQLiteStatusDatabase);
    } finally {
      database.close();
    }
  });

  test("uses node:sqlite when available and explains when it is missing", async () => {
    // Bun 1.4+ supports node:sqlite; Bun 1.3 and older runtimes do not.
    if (!hasNodeSqlite()) {
      expect(() => new NodeSqliteStatusDatabase({ file: ":memory:" })).toThrow(
        /bun:sqlite or node:sqlite/,
      );
      return;
    }
    const database = new NodeSqliteStatusDatabase({ file: ":memory:" });
    try {
      expect(await database.listResults()).toEqual([]);
    } finally {
      database.close();
    }
  });
});

/**
 * A Cloudflare binding exists per request and `DATABASE_URL` only exists on the
 * deployment, but a status configuration is a module-level value. Constructing
 * the adapter eagerly turned both into an unhandled module error that took the
 * whole framework process down instead of failing one request.
 */
describe("deferred database construction", () => {
  test("never builds the adapter while the configuration is imported", () => {
    let built = 0;
    const page = heyoStatus({
      database: lazyStatusDatabase(() => {
        built += 1;
        return createSqlite(":memory:");
      }),
      monitors: [{ name: "Website", type: "http", url: "https://example.com" }],
    });

    expect(built).toBe(0);
    expect(page.title).toBe("Heyo Status");
  });

  test("builds once and reuses the same adapter for later queries", async () => {
    const database = createSqlite(":memory:");
    let built = 0;
    const lazy = lazyStatusDatabase(() => {
      built += 1;
      return database;
    });

    try {
      await lazy.insertCheckResults([
        result("Website", "http", true, "2026-01-01T00:00:00.000Z", 12),
      ]);
      const snapshot = await lazy.getSnapshot(
        ["Website"],
        90,
        new Date("2026-01-01T12:00:00.000Z"),
      );

      expect(built).toBe(1);
      expect(snapshot.results).toHaveLength(1);
      expect(await lazy.listIncidents({})).toEqual([]);
      expect(built).toBe(1);
    } finally {
      database.close();
    }
  });

  test("forwards explicit migrations instead of silently claiming success", async () => {
    const database = createSqlite(":memory:");
    const unsupported = createSqlite(":memory:");
    let migrated = 0;
    try {
      const lazy = lazyStatusDatabase(() =>
        Object.assign(database, {
          migrate: async () => {
            migrated += 1;
          },
        }),
      );
      expect(migrated).toBe(0);
      await lazy.migrate();
      expect(migrated).toBe(1);
      await expect(
        lazyStatusDatabase(() => unsupported).migrate(),
      ).rejects.toThrow("does not support migrations");
    } finally {
      unsupported.close();
      database.close();
    }
  });

  test("reports the resolver's error on the query and retries afterwards", async () => {
    let binding: SQLiteStatusDatabase | undefined;
    const lazy = lazyStatusDatabase(() => {
      if (!binding) throw new Error("Cloudflare D1 is not bound.");
      return binding;
    });

    await expect(lazy.listUpcoming()).rejects.toThrow(
      "Cloudflare D1 is not bound.",
    );

    binding = new SQLiteStatusDatabase({ file: ":memory:" });
    try {
      expect(await lazy.listUpcoming()).toEqual([]);
    } finally {
      binding.close();
    }
  });
});

function result(
  name: string,
  type: CheckResult["type"],
  status: boolean,
  checkedAt: string,
  latencyMs: number,
): CheckResult {
  return {
    name,
    type,
    status,
    message: status ? "ok" : "down",
    latencyMs,
    checkedAt: new Date(checkedAt),
  };
}
