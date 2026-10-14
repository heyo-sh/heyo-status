import { describe, expect, test } from "bun:test";

import { createSeedResults } from "../src/cli";
import { heyoStatus } from "../src/config";
import { buildStatusSnapshot } from "../src/snapshot";
import type {
  CheckResult,
  Maintenance,
  StatusDatabaseAdapter,
} from "../src/types";
import { testDatabaseAdapter } from "./fixtures";

const now = new Date("2026-01-15T12:00:00.000Z");

const results: CheckResult[] = [
  check("Website", "http", false, "2026-01-14T00:00:00.000Z", 8),
  check("Website", "http", true, "2026-01-14T02:00:00.000Z", 12),
  check("Website", "http", false, "2026-01-15T11:30:00.000Z", 20),
  check("API", "http", true, "2026-01-15T11:45:00.000Z", 25),
  check("Internal", "tcp", false, "2026-01-15T11:50:00.000Z", 5),
];

const data = {
  results,
  dailySummaries: [
    {
      name: "Website",
      dayStartAt: new Date("2026-01-13T00:00:00.000Z"),
      totalChecks: 10,
      downChecks: 1,
      downMinutes: 5,
      totalLatencyMs: 100,
      minLatencyMs: 5,
      maxLatencyMs: 20,
      latestStatus: true,
      latestCheckedAt: new Date("2026-01-13T23:55:00.000Z"),
    },
  ],
};

const database: StatusDatabaseAdapter = {
  ...testDatabaseAdapter,
  async getSnapshot() {
    return data;
  },
};

function page() {
  return heyoStatus({
    database,
    monitors: [
      {
        name: "Website",
        group: "Frontend",
        type: "http",
        url: "https://example.com",
      },
      {
        name: "API",
        group: "Backend",
        type: "http",
        url: "https://api.example.com",
      },
      {
        name: "Internal",
        type: "tcp",
        host: "db.internal",
        port: 5432,
        private: true,
      },
    ],
    checks: { displayDays: 3, retentionDays: 90 },
  });
}

describe("buildStatusSnapshot", () => {
  test("combines compacted and raw history without exposing private monitors", () => {
    const snapshot = buildStatusSnapshot(page(), data, now);
    const website = snapshot.monitors.find(
      (monitor) => monitor.name === "Website",
    );

    expect(snapshot).toMatchObject({
      generatedAt: now,
      overall: "degraded",
      hasConfig: true,
      hasData: true,
      groups: [
        { name: "Frontend", monitors: ["Website"], status: "outage" },
        { name: "Backend", monitors: ["API"], status: "operational" },
      ],
    });
    expect(snapshot.monitors.map((monitor) => monitor.name)).toEqual([
      "Website",
      "API",
    ]);
    expect(website).toMatchObject({
      latestStatus: false,
      latestCheckedAt: new Date("2026-01-15T11:30:00.000Z"),
      latestLatencyMs: 20,
      uptimePercent: 76.92,
      uptimePercent24h: 0,
      avgLatencyMs: 11,
    });
    expect(website?.days).toEqual([
      expect.objectContaining({
        key: "2026-01-13",
        status: "degraded",
        downPercent: 10,
      }),
      expect.objectContaining({
        key: "2026-01-14",
        status: "degraded",
        downPercent: 50,
        downMinutes: 120,
      }),
      expect.objectContaining({
        key: "2026-01-15",
        status: "down",
        downPercent: 100,
      }),
    ]);
  });

  test("buckets recent latency hourly and falls back to compacted daily averages", () => {
    const snapshot = buildStatusSnapshot(page(), data, now);
    const website = snapshot.monitors.find(
      (monitor) => monitor.name === "Website",
    );
    const api = snapshot.monitors.find((monitor) => monitor.name === "API");

    // Only observations inside the trailing 24h window are bucketed, so the
    // Jan 14 02:00 check is excluded at this clock.
    expect(website?.latencySeries).toEqual([
      {
        key: "2026-01-15T11:00:00.000Z",
        label: "Jan 15, 2026, 11:00 UTC",
        at: new Date("2026-01-15T11:00:00.000Z"),
        latencyMs: 20,
        totalChecks: 1,
      },
    ]);
    expect(api?.latencySeries).toEqual([
      {
        key: "2026-01-15T11:00:00.000Z",
        label: "Jan 15, 2026, 11:00 UTC",
        at: new Date("2026-01-15T11:00:00.000Z"),
        latencyMs: 25,
        totalChecks: 1,
      },
    ]);

    // Without raw history the series is built from daily summary averages.
    const compacted = buildStatusSnapshot(
      page(),
      { results: [], dailySummaries: data.dailySummaries },
      now,
    );
    expect(
      compacted.monitors.find((monitor) => monitor.name === "Website")
        ?.latencySeries,
    ).toEqual([
      {
        key: "2026-01-13T00:00:00.000Z",
        label: "Jan 13, 2026",
        at: new Date("2026-01-13T00:00:00.000Z"),
        latencyMs: 10,
        totalChecks: 10,
      },
    ]);
  });

  // A window that has started is the one visitors most need to see: the page
  // reports "Under Maintenance", so the snapshot has to say which window.
  test("publishes upcoming and in-progress maintenance, never completed windows", () => {
    const snapshot = buildStatusSnapshot(
      page(),
      data,
      now,
      [],
      [
        maintenanceWindow("mnt_scheduled", "scheduled"),
        maintenanceWindow("mnt_running", "in-progress"),
        maintenanceWindow("mnt_done", "completed"),
      ],
    );

    expect(snapshot.scheduledMaintenances.map((window) => window.id)).toEqual([
      "mnt_scheduled",
      "mnt_running",
    ]);
    expect(snapshot.overall).toBe("maintenance");
  });

  test("exposes the Hono status routes and hides unknown/private monitor names", async () => {
    const statusPage = page();
    const handler = statusPage.handler;
    if (!handler) throw new Error("heyoStatus() did not attach a handler.");

    const statusResponse = await handler(
      new Request("https://status.example.com/api/heyo-status/status"),
    );
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as {
      monitors: Array<{ name: string }>;
    };
    expect(status.monitors.map((monitor) => monitor.name)).toEqual([
      "Website",
      "API",
    ]);

    const monitorResponse = await handler(
      new Request(
        "https://status.example.com/api/heyo-status/monitors/Website",
      ),
    );
    expect(monitorResponse.status).toBe(200);
    await expect(monitorResponse.json()).resolves.toMatchObject({
      name: "Website",
    });

    const privateResponse = await handler(
      new Request(
        "https://status.example.com/api/heyo-status/monitors/Internal",
      ),
    );
    expect(privateResponse.status).toBe(404);

    const healthResponse = await handler(
      new Request("https://status.example.com/api/heyo-status/healthz"),
    );
    await expect(healthResponse.json()).resolves.toEqual({ ok: true });
  });
});

test("seed data honors the requested global uptime and never creates future checks", () => {
  const seedNow = new Date("2026-01-15T12:00:00.000Z");
  const seed = createSeedResults(
    [{ name: "Website", type: "http", url: "https://example.com" }],
    75,
    2,
    seedNow,
  );

  expect(seed).toHaveLength(200);
  expect(seed.filter((result) => !result.status)).toHaveLength(50);
  expect(
    seed.every((result) => result.checkedAt.getTime() <= seedNow.getTime()),
  ).toBe(true);
});

function maintenanceWindow(
  id: string,
  status: Maintenance["status"],
): Maintenance {
  return {
    id,
    title: `Window ${id}`,
    description: "",
    affectedMonitors: ["Website"],
    scheduledStart: new Date("2026-01-15T11:00:00.000Z"),
    scheduledEnd: new Date("2026-01-15T13:00:00.000Z"),
    status,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
  };
}

function check(
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
