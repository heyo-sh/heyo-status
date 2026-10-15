import { sql, type SQLWrapper } from "drizzle-orm";

import {
  D1StatusDatabase,
  type D1Database,
  type D1Statement,
  type D1StatusDatabaseOptions,
} from "./d1";

/** Minimal `pg`/Neon/Supabase query client contract. */
export interface PostgresClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/** Structural contract implemented by `drizzle-orm/node-postgres` databases. */
export interface DrizzlePostgresClient {
  // `any` avoids coupling the public structural contract to a particular
  // installed copy of Drizzle's branded SQLWrapper type.
  execute(query: any): unknown;
}

export type PostgresDatabaseClient = PostgresClient | DrizzlePostgresClient;

export interface PostgresStatusDatabaseOptions extends D1StatusDatabaseOptions {}

/**
 * A Postgres implementation backed by the same portable SQL repository as D1.
 * It accepts node-postgres pools, Neon/Supabase clients exposing
 * `query(text, values)`, and `drizzle(pool)` instances. No driver is bundled.
 */
export class PostgresStatusDatabase extends D1StatusDatabase {
  readonly client: PostgresDatabaseClient;

  constructor(
    client: PostgresDatabaseClient,
    options: PostgresStatusDatabaseOptions = {},
  ) {
    super(new PostgresBinding(client), options);
    this.client = client;
  }
}

/** Creates a Postgres adapter for pg-compatible or Drizzle clients. */
export function postgres(
  client: PostgresDatabaseClient,
  options?: PostgresStatusDatabaseOptions,
): PostgresStatusDatabase {
  return new PostgresStatusDatabase(client, options);
}

class PostgresBinding implements D1Database {
  constructor(private readonly client: PostgresDatabaseClient) {}

  prepare(query: string): D1Statement {
    return new PostgresStatement(this.client, query);
  }

  async exec(query: string): Promise<unknown> {
    const migration = postgresDialectSql(query);
    if (!migration.trim()) return undefined;
    return execute(this.client, migration, []);
  }
}

class PostgresStatement implements D1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly client: PostgresDatabaseClient,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1Statement {
    this.values = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
    const result = await execute<T & Record<string, unknown>>(
      this.client,
      this.query,
      this.values,
    );
    return { results: result.rows as T[] };
  }

  async run(): Promise<unknown> {
    return execute(this.client, this.query, this.values);
  }
}

function execute<T extends Record<string, unknown>>(
  client: PostgresDatabaseClient,
  query: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  const dialectSql = postgresDialectSql(query);
  if (isPostgresClient(client)) {
    return client.query<T>(toNodePostgresSql(dialectSql), values);
  }
  return client.execute(toDrizzleSql(dialectSql, values)) as Promise<{
    rows: T[];
  }>;
}

/** Converts the SQLite/D1 SQL subset used by the shared repository to Postgres. */
function postgresDialectSql(query: string): string {
  return (
    query
      .replace(/^\s*PRAGMA [^;]+;?\s*/gim, "")
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "BIGSERIAL PRIMARY KEY")
      // Every timestamp column stores epoch milliseconds, which overflows the
      // 32-bit Postgres `integer`. SQLite and D1 widen INTEGER automatically;
      // Postgres needs BIGINT to accept the same values.
      .replace(/\bINTEGER\b/gi, "BIGINT")
      .replace(/LIMIT -1 OFFSET \?/gi, "OFFSET ?")
  );
}

function isPostgresClient(
  client: PostgresDatabaseClient,
): client is PostgresClient {
  return (
    "query" in client &&
    typeof (client as { query?: unknown }).query === "function"
  );
}

function toNodePostgresSql(query: string): string {
  let parameter = 0;
  return query.replace(/\?/g, () => `$${++parameter}`);
}

function toDrizzleSql(query: string, values: unknown[]): SQLWrapper {
  const parts = query.split("?");
  if (parts.length - 1 !== values.length) {
    throw new Error(
      "Postgres query placeholder count does not match bound values.",
    );
  }
  return sql.join(
    parts.flatMap((part, index) =>
      index < values.length
        ? [sql.raw(part), sql.param(values[index])]
        : [sql.raw(part)],
    ),
  );
}
