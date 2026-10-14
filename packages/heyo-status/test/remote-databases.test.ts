import { describe, expect, test } from "bun:test";

import { d1, type D1Database } from "../src/db/d1";
import { postgres } from "../src/db/postgres";

describe("remote database adapters", () => {
  test("applies tracked D1 migrations through a Workers-compatible binding", async () => {
    const executed: string[] = [];
    const binding: D1Database = {
      exec: async (sql) => {
        executed.push(sql);
      },
      prepare: () => ({
        bind() {
          return this;
        },
        all: async () => ({ results: [] }),
        run: async () => undefined,
      }),
    };
    const database = d1(binding, { migrate: true });
    await database.cleanup(90, new Date("2030-01-01T00:00:00.000Z"));

    expect(executed.join("\n")).toContain("status_results");
    expect(executed.join("\n")).toContain("subscribers");
  });

  test("adapts the portable repository to a pg-compatible query client", async () => {
    const queries: string[] = [];
    const database = postgres(
      {
        query: async (sql) => {
          queries.push(sql);
          return { rows: [] };
        },
      },
      { migrate: true },
    );
    await database.cleanup(90, new Date("2030-01-01T00:00:00.000Z"));

    expect(queries.join("\n")).toContain("BIGSERIAL PRIMARY KEY");
    expect(queries.join("\n")).not.toContain("PRAGMA");
  });

  // Postgres `integer` is 32-bit, so every epoch-millisecond timestamp column
  // has to be widened. Without this the very first write overflows.
  test("widens every integer column so epoch milliseconds fit", async () => {
    const queries: string[] = [];
    const values: unknown[][] = [];
    const database = postgres(
      {
        query: async (sql, parameters) => {
          queries.push(sql);
          values.push(parameters ?? []);
          return { rows: [] };
        },
      },
      { migrate: true },
    );
    await database.insertCheckResults([
      {
        name: "Website",
        type: "http",
        status: true,
        message: "HTTP 200",
        latencyMs: 12,
        checkedAt: new Date("2026-03-15T12:00:00.000Z"),
      },
    ]);

    const ddl = queries.filter((query) => query.includes("CREATE TABLE"));
    expect(ddl.length).toBeGreaterThan(0);
    for (const statement of ddl) {
      expect(statement).not.toMatch(/\bINTEGER\b/i);
    }
    expect(ddl.join("\n")).toContain("created_at BIGINT NOT NULL");
    expect(values.flat()).toContain(
      new Date("2026-03-15T12:00:00.000Z").getTime(),
    );
  });

  test("accepts a Drizzle Postgres database and binds values through SQL", async () => {
    const queries: unknown[] = [];
    const database = postgres({
      execute: async (query) => {
        queries.push(query);
        return { rows: [] };
      },
    });

    await database.getSnapshot(
      ["Website"],
      1,
      new Date("2030-01-01T00:00:00.000Z"),
    );

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => typeof query === "object")).toBe(true);
  });
});
