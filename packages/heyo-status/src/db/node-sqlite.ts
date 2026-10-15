import { createRequire } from "node:module";

import { D1StatusDatabase, type D1Database, type D1Statement } from "./d1";
import type { CheckResult, StatusMonitorConfig } from "../types";
import type { ListCheckResultsOptions } from "./sqlite";

// `node:sqlite` (and createRequire) must not run at module evaluation time:
// Workers bundles may replace import.meta.url with undefined.

interface NodeSqliteStatement {
  all(...values: unknown[]): Record<string, unknown>[];
  run(...values: unknown[]): unknown;
}

interface NodeSqliteDatabase {
  prepare(query: string): NodeSqliteStatement;
  exec(query: string): void;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

/**
 * Resolves `node:sqlite` without a static import.
 *
 * `process.getBuiltinModule` is tried first because Next's Turbopack and Vite
 * rewrite `createRequire`, which makes a bundled server build unable to reach
 * a Node builtin through it.
 */
function loadNodeSqlite(): NodeSqliteModule | undefined {
  const builtin = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process?.getBuiltinModule?.("node:sqlite");
  if (builtin) return builtin as NodeSqliteModule;

  try {
    return createRequire(import.meta.url)("node:sqlite") as NodeSqliteModule;
  } catch {
    return undefined;
  }
}

/** True when the host runtime exposes the `node:sqlite` module. */
export function hasNodeSqlite(): boolean {
  return loadNodeSqlite() !== undefined;
}

function openNodeSqlite(file: string): NodeSqliteDatabase {
  const module = loadNodeSqlite();
  if (!module) {
    throw new Error(
      "Embedded SQLite needs bun:sqlite or node:sqlite. Upgrade to Node 22.5+ or Bun, or choose the D1 or PostgreSQL adapter.",
    );
  }
  return new module.DatabaseSync(file);
}

/**
 * Adapts `node:sqlite` to the portable D1 statement contract. The shared
 * repository in {@link D1StatusDatabase} then serves SQLite, D1 and Postgres
 * from one implementation, so their behaviour cannot drift.
 */
class NodeSqliteBinding implements D1Database {
  constructor(readonly database: NodeSqliteDatabase) {}

  prepare(query: string): D1Statement {
    const database = this.database;
    let values: unknown[] = [];
    const statement: D1Statement = {
      bind(...bound: unknown[]): D1Statement {
        values = bound.map(toSqliteValue);
        return statement;
      },
      async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
        return {
          results: database.prepare(query).all(...values) as T[],
        };
      },
      async run(): Promise<unknown> {
        return database.prepare(query).run(...values);
      },
    };
    return statement;
  }

  async exec(query: string): Promise<unknown> {
    this.database.exec(query);
    return undefined;
  }
}

// node:sqlite only binds null, number, bigint, string, Uint8Array. The shared
// repository already stores booleans as 0/1, but a defensive cast keeps a
// third-party caller from hitting an opaque driver error.
function toSqliteValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

export interface NodeSqliteStatusDatabaseOptions {
  /** SQLite filename; use `:memory:` for tests or transient local state. */
  file?: string;
  /** Applies bundled migrations on construction. Defaults to true. */
  migrate?: boolean;
}

/**
 * Embedded SQLite for runtimes without `bun:sqlite`, such as `next start`,
 * `react-router-serve` and a Node-hosted Astro adapter.
 */
export class NodeSqliteStatusDatabase extends D1StatusDatabase {
  readonly client: NodeSqliteDatabase;

  constructor(options: NodeSqliteStatusDatabaseOptions = {}) {
    const client = openNodeSqlite(options.file ?? "status.sqlite");
    super(new NodeSqliteBinding(client), {
      migrate: options.migrate !== false,
    });
    this.client = client;
  }

  /** Closes the underlying SQLite connection. */
  close(): void {
    this.client.close();
  }

  /** Lists raw observations in chronological order. */
  async listResults(
    options: ListCheckResultsOptions = {},
  ): Promise<CheckResult[]> {
    if (options.names?.length === 0 || options.limit === 0) return [];
    await this.ready();

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.names?.length) {
      conditions.push(`name IN (${options.names.map(() => "?").join(", ")})`);
      values.push(...options.names);
    }
    if (options.from) {
      conditions.push("created_at >= ?");
      values.push(options.from.getTime());
    }
    if (options.to) {
      conditions.push("created_at < ?");
      values.push(options.to.getTime());
    }

    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const limit =
      options.limit === undefined
        ? ""
        : ` LIMIT ${Math.max(0, Math.floor(options.limit))}`;
    const rows = await this.binding
      .prepare(
        `SELECT name, type, status, latency_ms, message, created_at
         FROM status_results${where} ORDER BY created_at, id${limit}`,
      )
      .bind(...values)
      .all<Record<string, unknown>>();

    return (rows.results ?? []).map((row) => ({
      name: String(row.name),
      type: String(row.type) as StatusMonitorConfig["type"],
      status: Number(row.status) === 1,
      message: row.message === null ? "" : String(row.message),
      latencyMs: Number(row.latency_ms),
      checkedAt: new Date(Number(row.created_at)),
    }));
  }
}
