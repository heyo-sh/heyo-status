import { describe, expect, test } from "bun:test";

import { heyoStatus } from "../src/config";
import { sqlite } from "../src/db";
import { reconcileAutomaticIncidents } from "../src/incidents";
import type { CheckResult } from "../src/types";

describe("incident and maintenance persistence", () => {
  test("stores a chronological incident timeline and soft-deletes incidents", async () => {
    const database = sqlite(":memory:");
    try {
      const created = await database.createIncident({
        title: "API unavailable",
        severity: "major",
        affectedMonitors: ["API"],
        message: "We are investigating.",
      });
      const updatedAt = new Date(created.createdAt.getTime() + 60_000);
      const updated = await database.updateIncident(created.id, {
        id: "upd_identified",
        status: "identified",
        message: "The root cause was identified.",
        createdAt: updatedAt,
        severity: "critical",
      });

      expect(updated).toMatchObject({
        status: "identified",
        severity: "critical",
        auto: false,
      });
      expect(updated.updates.map((update) => update.status)).toEqual([
        "investigating",
        "identified",
      ]);

      const resolved = await database.resolveIncident(
        created.id,
        "The API is operational again.",
      );
      expect(resolved).toMatchObject({ status: "resolved" });
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
      await expect(
        database.listIncidents({ status: "resolved" }),
      ).resolves.toHaveLength(1);

      await database.deleteIncident(created.id);
      await expect(database.getIncident(created.id)).resolves.toBeNull();
      await expect(database.listIncidents({})).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });

  test("refreshes maintenance state from its schedule", async () => {
    const database = sqlite(":memory:");
    try {
      const start = new Date("2030-01-01T10:00:00.000Z");
      const end = new Date("2030-01-01T12:00:00.000Z");
      const maintenance = await database.createMaintenance({
        title: "Database upgrade",
        affectedMonitors: ["Database"],
        scheduledStart: start,
        scheduledEnd: end,
      });

      await expect(
        database.listUpcoming(new Date("2030-01-01T09:00:00.000Z")),
      ).resolves.toMatchObject([{ id: maintenance.id, status: "scheduled" }]);
      await expect(
        database.listUpcoming(new Date("2030-01-01T10:30:00.000Z")),
      ).resolves.toMatchObject([{ id: maintenance.id, status: "in-progress" }]);
      await expect(
        database.listUpcoming(new Date("2030-01-01T12:00:00.000Z")),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("incident API and monitor automation", () => {
  test("creates incidents through the API and includes them in a public snapshot", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database,
        adminToken: "test-admin-token",
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
        ],
      });
      const createBody = JSON.stringify({
        title: "API incident",
        severity: "major",
        affectedMonitors: ["API"],
        message: "Investigating API errors.",
      });

      // The management API must never be writable by anonymous visitors.
      const unauthorised = await page.handler(
        new Request(
          "https://status.example.com/api/heyo-status/admin/incidents",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: createBody,
          },
        ),
      );
      expect(unauthorised.status).toBe(401);

      const createdResponse = await page.handler(
        new Request(
          "https://status.example.com/api/heyo-status/admin/incidents",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer test-admin-token",
            },
            body: createBody,
          },
        ),
      );
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { id: string };

      const detailResponse = await page.handler(
        new Request(
          `https://status.example.com/api/heyo-status/incidents/${created.id}`,
        ),
      );
      await expect(detailResponse.json()).resolves.toMatchObject({
        id: created.id,
        updates: [expect.objectContaining({ status: "investigating" })],
      });

      const snapshotResponse = await page.handler(
        new Request("https://status.example.com/api/heyo-status/status"),
      );
      await expect(snapshotResponse.json()).resolves.toMatchObject({
        overall: "degraded",
        activeIncidents: [expect.objectContaining({ id: created.id })],
      });
    } finally {
      database.close();
    }
  });

  test("opens automatic incidents after the configured threshold and suppresses them during maintenance", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database,
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
        ],
        notifications: { failureThreshold: 2 },
      });
      const first = failedCheck("2030-01-01T00:00:00.000Z");
      const second = failedCheck("2030-01-01T00:05:00.000Z");
      await database.insertCheckResults([first]);
      await reconcileAutomaticIncidents(page, [first], first.checkedAt);
      await database.insertCheckResults([second]);
      await reconcileAutomaticIncidents(page, [second], second.checkedAt);

      await expect(
        database.listIncidents({ status: "investigating" }),
      ).resolves.toMatchObject([{ auto: true, affectedMonitors: ["API"] }]);
    } finally {
      database.close();
    }

    const maintenanceDatabase = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database: maintenanceDatabase,
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
        ],
        notifications: { failureThreshold: 1 },
      });
      await maintenanceDatabase.createMaintenance({
        title: "API maintenance",
        affectedMonitors: ["API"],
        scheduledStart: new Date("2030-01-01T00:00:00.000Z"),
        scheduledEnd: new Date("2030-01-01T01:00:00.000Z"),
      });
      const failure = failedCheck("2030-01-01T00:05:00.000Z");
      await maintenanceDatabase.insertCheckResults([failure]);
      await reconcileAutomaticIncidents(page, [failure], failure.checkedAt);

      await expect(maintenanceDatabase.listIncidents({})).resolves.toEqual([]);
    } finally {
      maintenanceDatabase.close();
    }
  });
});

function failedCheck(checkedAt: string): CheckResult {
  return {
    name: "API",
    type: "http",
    status: false,
    message: "HTTP 503",
    latencyMs: 0,
    checkedAt: new Date(checkedAt),
  };
}
