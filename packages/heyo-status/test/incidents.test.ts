import { describe, expect, test } from "bun:test";

import { heyoStatus } from "../src/config";
import { sqlite } from "../src/db";
import { createAtomFeed, createRssFeed } from "../src/feeds";
import { reconcileAutomaticIncidents } from "../src/incidents";
import { createPrometheusMetrics } from "../src/metrics";
import {
  collectMonitorNotificationEvents,
  dispatchNotifications,
} from "../src/notification-dispatcher";
import { email } from "../src/notifications";
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

  test("keeps private checks and operational alerts without opening public incidents", async () => {
    const database = sqlite(":memory:");
    const alerts: string[] = [];
    try {
      const page = heyoStatus({
        database,
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
          {
            name: "Internal",
            type: "tcp",
            host: "db.internal",
            port: 5432,
            private: true,
          },
        ],
        notifications: {
          failureThreshold: 1,
          channels: [
            {
              id: "ops",
              type: "webhook",
              events: ["monitor.down"],
              async send(event) {
                alerts.push(event.monitor?.name ?? "");
              },
            },
          ],
        },
      });
      const now = new Date("2030-01-01T00:05:00.000Z");
      const results: CheckResult[] = [
        failedCheck(now.toISOString()),
        {
          ...failedCheck(now.toISOString()),
          name: "Internal",
          type: "tcp",
          message: "ECONNREFUSED db.internal",
        },
      ];
      const monitorEvents = await collectMonitorNotificationEvents(
        page,
        results,
        now,
      );
      await database.insertCheckResults(results);
      const incidentEvents = await reconcileAutomaticIncidents(
        page,
        results,
        now,
      );
      await dispatchNotifications(page, [...monitorEvents, ...incidentEvents]);

      expect(alerts).toContain("Internal");
      expect(await database.getSnapshot(["Internal"], 1, now)).toMatchObject({
        results: [expect.objectContaining({ name: "Internal", status: false })],
      });
      expect(incidentEvents).toHaveLength(1);
      expect(await database.listIncidents({})).toMatchObject([
        { auto: true, affectedMonitors: ["API"] },
      ]);
    } finally {
      database.close();
    }
  });

  test("hides existing private automatic incidents from every public surface", async () => {
    const database = sqlite(":memory:");
    const messages: string[][] = [];
    try {
      const page = heyoStatus({
        database,
        title: "Acme Status",
        siteUrl: "https://status.acme.test",
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
          {
            name: "Internal",
            type: "tcp",
            host: "db.internal",
            port: 5432,
            private: true,
          },
        ],
        metrics: { prometheus: true },
        subscribers: { enabled: true },
        notifications: {
          channels: [
            email({
              transport: "smtp",
              from: "status@acme.test",
              to: ["ops@acme.test"],
              async send(message) {
                messages.push(message.to);
              },
            }),
          ],
        },
        cache: { snapshotTtlMs: 0 },
      });
      await database.createSubscriber({
        type: "email",
        target: "visitor@acme.test",
        confirmed: true,
      });
      const hidden = await database.createIncident({
        title: "Internal secret is unavailable",
        severity: "critical",
        affectedMonitors: ["Internal"],
        message: "ECONNREFUSED db.internal",
        auto: true,
      });
      const base = "https://status.acme.test/api/heyo-status";
      const request = (path: string) =>
        page.handler(new Request(`${base}${path}`));

      expect(await database.listIncidents({})).toHaveLength(1); // still available to operators
      expect(await (await request("/incidents")).json()).toEqual([]);
      expect((await request(`/incidents/${hidden.id}`)).status).toBe(404);
      const snapshot = await (await request("/status")).json();
      expect(snapshot).toMatchObject({
        overall: "operational",
        activeIncidents: [],
      });
      expect(await (await request("/status/summary")).json()).toMatchObject({
        overall: "operational",
        activeIncidents: 0,
      });
      expect(await (await request("/badge/overall.svg")).text()).toContain(
        "operational",
      );
      expect(await (await request("/metrics")).text()).toContain(
        "heyo_status_active_incidents 0",
      );
      expect(createPrometheusMetrics(await page.api.getSnapshot())).toContain(
        "heyo_status_active_incidents 0",
      );
      for (const path of ["/rss.xml", "/atom.xml"]) {
        const xml = await (await request(path)).text();
        expect(xml).not.toContain("Internal secret");
        expect(xml).not.toContain("db.internal");
      }
      expect(createRssFeed(page, [hidden], page.siteUrl!)).not.toContain(
        "Internal secret",
      );
      expect(createAtomFeed(page, [hidden], page.siteUrl!)).not.toContain(
        "Internal secret",
      );

      await dispatchNotifications(page, {
        type: "incident.updated",
        incident: hidden,
        occurredAt: new Date(),
      });
      expect(messages).toEqual([["ops@acme.test"]]); // not the public subscriber

      const publicIncident = await database.createIncident({
        title: "API is unavailable",
        severity: "major",
        affectedMonitors: ["API"],
        message: "Investigating.",
        auto: true,
      });
      const anotherHidden = await database.createIncident({
        title: "Internal secret still unavailable",
        severity: "major",
        affectedMonitors: ["Internal", "API"],
        message: "Private failure details",
        auto: true,
      });
      const manual = await database.createIncident({
        title: "Manually published notice",
        severity: "minor",
        affectedMonitors: ["Internal"],
        message: "Operator chose to publish this.",
      });
      const publicList = await (
        await request("/incidents?limit=1&offset=1")
      ).json();
      expect(publicList).toMatchObject([{ id: publicIncident.id }]);
      expect(await (await request("/incidents?limit=1")).json()).toMatchObject([
        { id: manual.id },
      ]);
      expect((await request(`/incidents/${anotherHidden.id}`)).status).toBe(
        404,
      );
      expect((await request(`/incidents/${manual.id}`)).status).toBe(200);
      for (const path of ["/rss.xml", "/atom.xml"]) {
        const xml = await (await request(path)).text();
        expect(xml).toContain("API is unavailable");
        expect(xml).toContain("Manually published notice");
        expect(xml).not.toContain("Internal secret");
      }
    } finally {
      database.close();
    }
  });

  test("feeds fill their 50 slots after skipping newer private incidents", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database,
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
          {
            name: "Internal",
            type: "tcp",
            host: "db.internal",
            port: 5432,
            private: true,
          },
        ],
      });
      for (let index = 0; index < 50; index += 1) {
        await database.createIncident({
          title: `Public incident ${index}`,
          severity: "major",
          affectedMonitors: ["API"],
          message: "Public failure",
          auto: true,
        });
      }
      for (let index = 0; index < 50; index += 1) {
        await database.createIncident({
          title: `Secret incident ${index}`,
          severity: "major",
          affectedMonitors: ["Internal"],
          message: "Internal failure",
          auto: true,
        });
      }
      for (const [path, tag] of [
        ["rss.xml", "item"],
        ["atom.xml", "entry"],
      ]) {
        const response = await page.handler(
          new Request(`https://status.acme.test/api/heyo-status/${path}`),
        );
        const body = await response.text();
        expect(body.match(new RegExp(`<${tag}>`, "g"))).toHaveLength(50);
        expect(body).toContain("Public incident 0");
        expect(body).not.toContain("Secret incident");
      }
    } finally {
      database.close();
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
