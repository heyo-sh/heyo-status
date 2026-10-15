import { describe, expect, test } from "bun:test";

import { createMonitorBadge, createOverallBadge } from "../src/badge";
import { createStatusSnapshotCache } from "../src/cache";
import { heyoStatus, validateStatusPageConfig } from "../src/config";
import { createPrometheusMetrics } from "../src/metrics";
import { buildStatusSnapshot } from "../src/snapshot";
import type {
  MonitorSnapshot,
  StatusPageConfig,
  StatusSnapshot,
} from "../src/types";
import { testDatabaseAdapter } from "./fixtures";

const now = new Date("2026-01-15T12:00:00.000Z");

const monitor: MonitorSnapshot = {
  name: "Website",
  type: "http",
  group: "Frontend",
  latestStatus: true,
  latestCheckedAt: now,
  latestLatencyMs: 42,
  uptimePercent: 99.95,
  uptimePercent24h: 100,
  uptimePercent7d: 99.9,
  uptimePercent30d: 97,
  uptimePercent90d: 97,
  avgLatencyMs: 40,
  days: [],
  latencySeries: [],
};

const snapshot: StatusSnapshot = {
  generatedAt: now,
  retentionDays: 90,
  displayDays: 90,
  overall: "degraded",
  groups: [{ name: "Frontend", status: "operational", monitors: ["Website"] }],
  monitors: [
    monitor,
    {
      ...monitor,
      name: "API",
      group: undefined,
      latestStatus: false,
      latestLatencyMs: null,
      uptimePercent24h: 80,
    },
  ],
  activeIncidents: [],
  scheduledMaintenances: [],
  hasConfig: true,
  hasData: true,
};

function page(
  overrides: Parameters<typeof heyoStatus>[0] = {
    database: testDatabaseAdapter,
  },
) {
  return heyoStatus(overrides);
}

describe("Prometheus exposition", () => {
  test("renders gauges for status, latency, uptime, and page-level counters", () => {
    const body = createPrometheusMetrics(snapshot);

    expect(body).toContain("# TYPE heyo_status_up gauge");
    expect(body).toContain(
      'heyo_status_up{monitor="Website",type="http",group="Frontend"} 1',
    );
    expect(body).toContain('heyo_status_up{monitor="API",type="http"} 0');
    expect(body).toContain(
      'heyo_status_latency_milliseconds{monitor="Website",type="http",group="Frontend"} 42',
    );
    expect(body).toContain(
      'heyo_status_uptime_ratio{monitor="API",period="24h"} 0.8',
    );
    expect(body).toContain('heyo_status_overall{status="degraded"} 1');
    expect(body).toContain('heyo_status_overall{status="operational"} 0');
    expect(body).toContain("heyo_status_monitors 2");
    expect(body).toContain("heyo_status_active_incidents 0");
    expect(body).toContain("heyo_status_snapshot_timestamp_seconds 1768478400");
    expect(body.endsWith("\n")).toBe(true);
  });

  test("is only routed when the configuration opts in", async () => {
    const disabled = page({ database: testDatabaseAdapter });
    await expect(
      disabled
        .handler(
          new Request("https://status.example.com/api/heyo-status/metrics"),
        )
        .then((response) => response.status),
    ).resolves.toBe(404);

    const enabled = page({
      database: testDatabaseAdapter,
      monitors: [{ name: "Website", type: "http", url: "https://example.com" }],
      metrics: { prometheus: true },
    });
    const response = await enabled.handler(
      new Request("https://status.example.com/api/heyo-status/metrics"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
    await expect(response.text()).resolves.toContain("heyo_status_up");
  });
});

describe("status badges", () => {
  test("renders status, uptime, and latency variants with readable labels", () => {
    const status = createMonitorBadge(monitor);
    expect(status).toContain('aria-label="Website: operational"');
    expect(status).toContain("#22c55e");

    expect(
      createMonitorBadge({ ...monitor, latestStatus: false }, { label: "web" }),
    ).toContain('aria-label="web: outage"');
    expect(
      createMonitorBadge(monitor, { metric: "uptime", period: "30d" }),
    ).toContain("97%");
    expect(createMonitorBadge(monitor, { metric: "latency" })).toContain(
      "42 ms",
    );
    expect(createMonitorBadge({ ...monitor, latestStatus: null })).toContain(
      "no data",
    );
  });

  test("escapes monitor names and reports the overall page state", () => {
    expect(createMonitorBadge({ ...monitor, name: 'A & <B>"' })).toContain(
      "A &amp; &lt;B&gt;&quot;",
    );
    expect(
      createOverallBadge({ ...snapshot, overall: "major-outage" }),
    ).toContain("major outage");
  });

  test("serves SVG over HTTP and validates badge query options", async () => {
    const statusPage = page({
      database: testDatabaseAdapter,
      monitors: [{ name: "Website", type: "http", url: "https://example.com" }],
    });

    const response = await statusPage.handler(
      new Request(
        "https://status.example.com/api/heyo-status/badge/Website.svg",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    await expect(response.text()).resolves.toContain("<svg");

    const overall = await statusPage.handler(
      new Request(
        "https://status.example.com/api/heyo-status/badge/overall.svg",
      ),
    );
    expect(overall.status).toBe(200);

    const missing = await statusPage.handler(
      new Request(
        "https://status.example.com/api/heyo-status/badge/Unknown.svg",
      ),
    );
    expect(missing.status).toBe(404);

    const invalid = await statusPage.handler(
      new Request(
        "https://status.example.com/api/heyo-status/badge/Website.svg?metric=downtime",
      ),
    );
    expect(invalid.status).toBe(400);

    const malformed = await statusPage.handler(
      new Request("https://status.example.com/api/heyo-status/badge/%zz.svg"),
    );
    expect(malformed.status).toBe(400);

    const disabled = page({
      database: testDatabaseAdapter,
      metrics: { badges: false },
    });
    await expect(
      disabled
        .handler(
          new Request("https://status.example.com/api/heyo-status/badge/x.svg"),
        )
        .then((response_) => response_.status),
    ).resolves.toBe(404);
  });
});

describe("snapshot cache", () => {
  const config: StatusPageConfig = validateStatusPageConfig({
    database: testDatabaseAdapter,
    monitors: [{ name: "Website", type: "http", url: "https://example.com" }],
  });

  test("serves one load per TTL window and reloads after expiry", async () => {
    let loads = 0;
    let clock = 0;
    const cache = createStatusSnapshotCache(config, {
      clock: () => clock,
      async load(loaded, at) {
        loads += 1;
        return buildStatusSnapshot(
          loaded,
          { results: [], dailySummaries: [] },
          at ?? now,
        );
      },
    });

    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(loads).toBe(1);

    clock += 29_000;
    await cache.get();
    expect(loads).toBe(1);

    clock += 2_000;
    await cache.get();
    expect(loads).toBe(2);
  });

  test("bypasses the cache for explicit clocks and after invalidation", async () => {
    let loads = 0;
    const cache = createStatusSnapshotCache(config, {
      async load(loaded, at) {
        loads += 1;
        return buildStatusSnapshot(
          loaded,
          { results: [], dailySummaries: [] },
          at ?? now,
        );
      },
    });

    await cache.get();
    await cache.get(now);
    expect(loads).toBe(2);

    cache.invalidate();
    await cache.get();
    expect(loads).toBe(3);
  });

  test("is disabled by a zero TTL", async () => {
    let loads = 0;
    const cache = createStatusSnapshotCache(
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        cache: { snapshotTtlMs: 0 },
      }),
      {
        async load(loaded, at) {
          loads += 1;
          return buildStatusSnapshot(
            loaded,
            { results: [], dailySummaries: [] },
            at ?? now,
          );
        },
      },
    );

    await cache.get();
    await cache.get();
    expect(loads).toBe(2);
  });
});
