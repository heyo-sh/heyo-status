import { Database, type SQLQueryBindings } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { d1, type D1Database } from "../src/db/d1";
import { checkResult, testDatabaseAdapter } from "./fixtures";

/**
 * Runs the portable SQL repository against a real SQLite engine through the D1
 * statement contract. D1 and Postgres are the same repository behind a
 * different binding, so this covers the code paths that only ever ran against
 * hand-written mocks before.
 */
function portableAdapter() {
  const sqlite = new Database(":memory:");
  const binding: D1Database = {
    prepare(query) {
      let values: SQLQueryBindings[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound as SQLQueryBindings[];
          return statement;
        },
        async all<T>() {
          return { results: sqlite.query(query).all(...values) as T[] };
        },
        async run() {
          return sqlite.query(query).run(...values);
        },
      };
      return statement;
    },
    async exec(query) {
      sqlite.exec(query);
    },
  };
  return d1(binding, { migrate: true });
}

describe("portable SQL repository", () => {
  test("persists and compacts check history", async () => {
    const database = portableAdapter();
    const now = new Date("2026-03-15T12:00:00.000Z");
    await database.insertCheckResults([
      { ...checkResult, checkedAt: new Date("2026-03-15T10:00:00.000Z") },
      {
        ...checkResult,
        status: false,
        message: "HTTP 503",
        latencyMs: 900,
        checkedAt: new Date("2026-03-15T11:00:00.000Z"),
      },
    ]);

    const snapshot = await database.getSnapshot(["Website"], 90, now);
    expect(snapshot.results).toHaveLength(2);
    expect(snapshot.results[0]).toMatchObject({
      name: "Website",
      type: "http",
      status: true,
      latencyMs: 12,
    });

    await expect(
      database.summarizeHistory(new Date("2026-03-16T00:00:00.000Z")),
    ).resolves.toEqual({
      summarizedDays: 1,
      summarizedResults: 2,
      deletedResults: 2,
    });

    const compacted = await database.getSnapshot(["Website"], 90, now);
    expect(compacted.results).toHaveLength(0);
    expect(compacted.dailySummaries[0]).toMatchObject({
      name: "Website",
      totalChecks: 2,
      downChecks: 1,
      latestStatus: false,
    });
  });

  test("round-trips incidents, maintenance, subscribers and delivery logs", async () => {
    const database = portableAdapter();
    const incident = await database.createIncident({
      title: "API unavailable",
      severity: "major",
      affectedMonitors: ["API"],
      message: "Investigating.",
    });
    expect(incident.updates).toHaveLength(1);
    expect(incident.auto).toBe(false);

    await database.updateIncident(incident.id, {
      id: "upd_1",
      status: "identified",
      message: "Root cause found.",
      createdAt: new Date("2026-03-15T12:05:00.000Z"),
    });
    const resolved = await database.resolveIncident(incident.id, "Resolved.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.updates).toHaveLength(3);
    await expect(
      database.listIncidents({ status: "resolved", severity: ["major"] }),
    ).resolves.toHaveLength(1);

    await database.deleteIncident(incident.id);
    await expect(database.getIncident(incident.id)).resolves.toBeNull();

    const window = await database.createMaintenance({
      title: "Database upgrade",
      affectedMonitors: ["API"],
      scheduledStart: new Date("2100-01-01T02:00:00.000Z"),
      scheduledEnd: new Date("2100-01-01T04:00:00.000Z"),
    });
    expect(window.status).toBe("scheduled");
    await expect(
      database.updateMaintenance(window.id, { title: "Database upgrade v2" }),
    ).resolves.toMatchObject({ title: "Database upgrade v2" });
    await expect(database.listUpcoming()).resolves.toHaveLength(1);
    await database.deleteMaintenance(window.id);
    await expect(database.getMaintenance(window.id)).resolves.toBeNull();

    const subscriber = await database.createSubscriber({
      type: "email",
      target: "visitor@example.com",
      confirmToken: "confirm_1",
      monitors: ["API"],
    });
    expect(subscriber.confirmed).toBe(false);
    await expect(
      database.confirmSubscriber("confirm_1"),
    ).resolves.toMatchObject({ confirmed: true, monitors: ["API"] });
    // Confirmation tokens are single use.
    await expect(database.confirmSubscriber("confirm_1")).resolves.toBeNull();
    await expect(database.deleteSubscriber(subscriber.id)).resolves.toBe(true);

    await database.recordNotification({
      channelId: "ops",
      channelType: "slack",
      eventType: "monitor.down",
      status: "failed",
      error: "HTTP 500",
    });
    await expect(
      database.listNotificationLog({ eventType: "monitor.down" }),
    ).resolves.toMatchObject([{ channelId: "ops", status: "failed" }]);
  });
});

describe("StatusDatabaseAdapter contract", () => {
  test("exposes the complete check-history surface", async () => {
    await expect(
      testDatabaseAdapter.insertCheckResults([checkResult]),
    ).resolves.toBeUndefined();
    await expect(
      testDatabaseAdapter.getSnapshot(["Website"], 90),
    ).resolves.toEqual({
      results: [checkResult],
      dailySummaries: [],
    });
    await expect(
      testDatabaseAdapter.summarizeHistory(
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      summarizedDays: 0,
      summarizedResults: 0,
      deletedResults: 0,
    });
    await expect(testDatabaseAdapter.cleanup(90)).resolves.toBeUndefined();
  });

  test("exposes the incident and maintenance surface", async () => {
    const createdIncident = await testDatabaseAdapter.createIncident({
      title: "API unavailable",
      severity: "major",
      affectedMonitors: ["API"],
      message: "We are investigating.",
    });
    const updatedIncident = await testDatabaseAdapter.updateIncident("inc_1", {
      id: "upd_1",
      status: "identified",
      message: "The issue is identified.",
      createdAt: new Date("2026-01-15T12:05:00.000Z"),
    });

    expect(createdIncident.title).toBe("API unavailable");
    expect(updatedIncident.updates).toHaveLength(1);
    await expect(
      testDatabaseAdapter.resolveIncident("inc_1", "Resolved."),
    ).resolves.toMatchObject({
      status: "resolved",
    });
    await expect(
      testDatabaseAdapter.listIncidents({ status: "investigating" }),
    ).resolves.toHaveLength(1);
    await expect(
      testDatabaseAdapter.getIncident("inc_1"),
    ).resolves.toMatchObject({
      id: "inc_1",
    });

    await expect(
      testDatabaseAdapter.createMaintenance({
        title: "Database maintenance",
        affectedMonitors: ["API"],
        scheduledStart: new Date("2026-01-16T02:00:00.000Z"),
        scheduledEnd: new Date("2026-01-16T04:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "scheduled" });
    await expect(testDatabaseAdapter.listUpcoming()).resolves.toHaveLength(1);
  });

  test("exposes the public subscription surface", async () => {
    await expect(
      testDatabaseAdapter.createSubscriber({
        type: "email",
        target: "visitor@example.com",
        monitors: ["API"],
        confirmToken: "confirm_1",
      }),
    ).resolves.toMatchObject({
      type: "email",
      confirmed: false,
      monitors: ["API"],
    });
    await expect(
      testDatabaseAdapter.confirmSubscriber("confirm_1"),
    ).resolves.toMatchObject({ confirmed: true });
    await expect(
      testDatabaseAdapter.listSubscribers({ confirmed: true }),
    ).resolves.toEqual([]);
    await expect(testDatabaseAdapter.deleteSubscriber("sub_1")).resolves.toBe(
      true,
    );
  });
});
