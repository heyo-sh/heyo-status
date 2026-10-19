import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { validateStatusPageConfig } from "../src/config";
import { createRssFeed } from "../src/feeds";
import { builtInStatusThemeNames } from "../src/theme/names";
import { resolveStatusTheme } from "../src/theme/registry";
import { statusThemeBootstrapScript } from "../src/theme/script";
import { DayGrid, LatencyChart, StatusPage, UptimeBar } from "../src/ui";
import type { Incident, LatencySample, StatusSnapshot } from "../src/types";
import { testDatabaseAdapter } from "./fixtures";

const latencySeries: LatencySample[] = [
  {
    key: "2026-01-15T10:00:00.000Z",
    label: "Jan 15, 2026, 10:00 UTC",
    at: new Date("2026-01-15T10:00:00.000Z"),
    latencyMs: 28,
    totalChecks: 12,
  },
  {
    key: "2026-01-15T11:00:00.000Z",
    label: "Jan 15, 2026, 11:00 UTC",
    at: new Date("2026-01-15T11:00:00.000Z"),
    latencyMs: 64,
    totalChecks: 12,
  },
  {
    key: "2026-01-15T12:00:00.000Z",
    label: "Jan 15, 2026, 12:00 UTC",
    at: new Date("2026-01-15T12:00:00.000Z"),
    latencyMs: 42,
    totalChecks: 1,
  },
];

const generatedAt = new Date("2026-01-15T12:00:00.000Z");

const snapshot: StatusSnapshot = {
  generatedAt,
  retentionDays: 90,
  displayDays: 2,
  overall: "degraded",
  hasConfig: true,
  hasData: true,
  activeIncidents: [],
  scheduledMaintenances: [],
  groups: [{ name: "Frontend", status: "degraded", monitors: ["Website"] }],
  monitors: [
    {
      name: "Website",
      type: "http",
      description: "Public site",
      group: "Frontend",
      latestStatus: false,
      latestCheckedAt: generatedAt,
      latestLatencyMs: 42,
      uptimePercent: 98.5,
      uptimePercent24h: 95,
      uptimePercent7d: 98,
      uptimePercent30d: 98.5,
      uptimePercent90d: 98.5,
      avgLatencyMs: 31,
      days: [
        {
          key: "2026-01-14",
          label: "Jan 14, 2026",
          status: "up",
          tooltip: "100% uptime — 12 checks",
          totalChecks: 12,
          downChecks: 0,
          downMinutes: 0,
          downPercent: 0,
        },
        {
          key: "2026-01-15",
          label: "Jan 15, 2026",
          status: "degraded",
          tooltip: "95% uptime — 12 checks — 1 failure",
          totalChecks: 12,
          downChecks: 1,
          downMinutes: 15,
          downPercent: 5,
        },
      ],
      latencySeries,
    },
    {
      name: "Worker",
      type: "tcp",
      latestStatus: true,
      latestCheckedAt: generatedAt,
      latestLatencyMs: 5,
      uptimePercent: 100,
      uptimePercent24h: 100,
      uptimePercent7d: 100,
      uptimePercent30d: 100,
      uptimePercent90d: 100,
      avgLatencyMs: 5,
      days: [],
      latencySeries: [],
    },
  ],
};

describe("status UI", () => {
  test.each(builtInStatusThemeNames)(
    "%s shows empty incident and maintenance sections when enabled",
    (theme) => {
      const html = renderToStaticMarkup(
        <StatusPage snapshot={snapshot} theme={theme} />,
      );

      expect(html).toContain("No active incidents.");
      expect(html).toContain("Upcoming maintenance");
      expect(html).toContain("No upcoming maintenance.");
    },
  );

  test.each(builtInStatusThemeNames)(
    "%s controls the two empty sections independently",
    (theme) => {
      const onlyIncidents = renderToStaticMarkup(
        <StatusPage
          maintenanceEnabled={false}
          snapshot={snapshot}
          theme={theme}
        />,
      );
      const onlyMaintenance = renderToStaticMarkup(
        <StatusPage
          incidentsEnabled={false}
          snapshot={snapshot}
          theme={theme}
        />,
      );

      expect(onlyIncidents).toContain("No active incidents.");
      expect(onlyIncidents).not.toContain("No upcoming maintenance.");
      expect(onlyMaintenance).not.toContain("No active incidents.");
      expect(onlyMaintenance).toContain("No upcoming maintenance.");
    },
  );

  test.each(builtInStatusThemeNames)(
    "%s hides disabled incident and maintenance sections even with data",
    (theme) => {
      const html = renderToStaticMarkup(
        <StatusPage
          incidentsEnabled={false}
          maintenanceEnabled={false}
          snapshot={{
            ...snapshot,
            activeIncidents: [
              {
                id: "inc_test",
                title: "Hidden incident",
                status: "investigating",
                severity: "major",
                affectedMonitors: ["Website"],
                auto: false,
                updates: [],
                createdAt: generatedAt,
                updatedAt: generatedAt,
                resolvedAt: null,
              },
            ],
            scheduledMaintenances: [
              {
                id: "mnt_test",
                title: "Hidden maintenance",
                description: "",
                affectedMonitors: ["Website"],
                scheduledStart: generatedAt,
                scheduledEnd: new Date("2026-01-15T14:00:00.000Z"),
                status: "in-progress",
                createdAt: generatedAt,
              },
            ],
          }}
          theme={theme}
        />,
      );

      expect(html).not.toContain("Hidden incident");
      expect(html).not.toContain("Hidden maintenance");
      expect(html).not.toContain("No active incidents.");
      expect(html).not.toContain("No upcoming maintenance.");
      expect(html).not.toContain("Upcoming maintenance");
    },
  );

  test.each(builtInStatusThemeNames)(
    "%s renders a logo-only brand without showing the metadata title",
    (theme) => {
      const html = renderToStaticMarkup(
        <StatusPage
          branding={{ logo: "/heyo.svg" }}
          snapshot={snapshot}
          theme={theme}
          title="Acme Status"
        />,
      );

      expect(html).toContain('alt="Acme Status"');
      expect(html).toContain('src="/heyo.svg"');
      expect(html).not.toContain(">Acme Status<");
    },
  );

  test("shows an explicit brand name without repeating the title", () => {
    const html = renderToStaticMarkup(
      <StatusPage
        branding={{ logo: "/heyo.svg", name: "Acme" }}
        snapshot={snapshot}
        title="Acme Status"
      />,
    );

    expect(html).toContain(">Acme<");
    expect(html).toContain('alt=""');
    expect(html).not.toContain(">Acme Status<");
  });

  // GET /status and the generated status-client return JSON, so every date in
  // the snapshot reaches the components as an ISO string rather than a Date.
  test("renders a snapshot that has been round-tripped through JSON", () => {
    const jsonSnapshot = JSON.parse(
      JSON.stringify({
        ...snapshot,
        activeIncidents: [
          {
            id: "inc_1",
            title: "Elevated errors",
            status: "investigating",
            severity: "major",
            affectedMonitors: ["Website"],
            auto: false,
            updates: [
              {
                id: "upd_1",
                status: "investigating",
                message: "Investigating elevated error rates.",
                createdAt: new Date("2026-01-15T11:00:00.000Z"),
              },
            ],
            createdAt: new Date("2026-01-15T11:00:00.000Z"),
            updatedAt: new Date("2026-01-15T11:30:00.000Z"),
            resolvedAt: null,
          },
        ],
        scheduledMaintenances: [
          {
            id: "mnt_1",
            title: "Database upgrade",
            description: "Rolling restart.",
            affectedMonitors: ["Website"],
            scheduledStart: new Date("2026-01-16T02:00:00.000Z"),
            scheduledEnd: new Date("2026-01-16T04:00:00.000Z"),
            status: "scheduled",
            createdAt: new Date("2026-01-15T12:00:00.000Z"),
          },
        ],
      }),
    ) as StatusSnapshot;

    const html = renderToStaticMarkup(
      <StatusPage snapshot={jsonSnapshot} title="Acme Status" />,
    );

    expect(html).toContain("Elevated errors");
    expect(html).toContain("Investigating elevated error rates.");
    expect(html).toContain("Database upgrade");
    expect(html).toContain('dateTime="2026-01-16T02:00:00.000Z"');
    expect(html).toContain('dateTime="2026-01-15T11:00:00.000Z"');
    expect(html).toContain("Jan 15, 2026 at 11:00 AM UTC");
  });

  test("renders grouped and ungrouped monitors from a framework-neutral snapshot", () => {
    const html = renderToStaticMarkup(
      <StatusPage
        branding={{ name: "Acme" }}
        colors={{ primary: "#111827", secondary: "#f3f4f6" }}
        metrics={{
          showLatency: true,
          showUptimePercent: true,
          uptimePeriods: ["24h", "90d"],
        }}
        rssHref="/rss.xml"
        snapshot={snapshot}
        subscribersEnabled
        title="Acme Status"
      />,
    );

    expect(html).toContain("Partial System Outage");
    expect(html).toContain("Frontend");
    expect(html).toContain("Website");
    expect(html).toContain("Worker");
    expect(html).toContain("Subscribe");
    expect(html).toContain("RSS");
    // Configured colours become heyo-ui brand tokens, scoped to the page.
    expect(html).toContain("--color-heyo-brand:#111827");
    expect(html).toContain("--color-heyo-brand-tint:#f3f4f6");
    expect(html).toContain("95%");
  });

  test("renders a latency sparkline with exact per-bucket tooltips", () => {
    const html = renderToStaticMarkup(
      <LatencyChart monitorName="Website" samples={latencySeries} />,
    );

    expect(html).toContain(
      "Website latency trend: minimum 28 ms, average 45 ms, maximum 64 ms",
    );
    expect(html).toContain("28–64 ms · avg 45 ms");
    expect(html).toContain("Jan 15, 2026, 11:00 UTC: 64 ms (12 checks)");
    // The newest bucket has a single check, so the label must not be pluralised.
    expect(html).toContain("42 ms (1 check)");
  });

  test("omits the sparkline until a monitor has at least two buckets", () => {
    expect(
      renderToStaticMarkup(
        <LatencyChart
          monitorName="Worker"
          samples={latencySeries.slice(0, 1)}
        />,
      ),
    ).toBe("");
  });

  test("spaces sparkline buckets by time, not by position in the series", () => {
    // Empty buckets are omitted from the series, so the gap between 11:00 and
    // 14:00 is three hours and has to be drawn three times as wide as the one
    // before it. Even spacing drew it as another hour.
    const gapped: LatencySample[] = [
      latencySeries[0]!,
      latencySeries[1]!,
      {
        ...latencySeries[2]!,
        key: "2026-01-15T14:00:00.000Z",
        at: new Date("2026-01-15T14:00:00.000Z"),
      },
    ];
    const html = renderToStaticMarkup(
      <LatencyChart monitorName="Website" samples={gapped} />,
    );

    expect(html).toContain('points="0,22 25,2 100,14.22"');
    // Hit areas tile the full width, each reaching halfway to its neighbours,
    // so every bucket stays hoverable once the spacing is uneven.
    expect(html).toContain('width="12.5" x="0"');
    expect(html).toContain('width="50" x="12.5"');
    expect(html).toContain('width="37.5" x="62.5"');
  });

  test("draws the newest reading with a marker the viewBox cannot flatten", () => {
    const html = renderToStaticMarkup(
      <LatencyChart monitorName="Website" samples={latencySeries} />,
    );

    // The box is stretched to the card width, so a <circle> renders as an
    // ellipse. A zero-length round-capped stroke stays a dot in CSS pixels.
    expect(html).not.toContain("<circle");
    expect(html).toContain(
      '<line class="stroke-heyo-brand" stroke-linecap="round" stroke-width="3.5" vector-effect="non-scaling-stroke" x1="100" x2="100" y1="14.22" y2="14.22"',
    );
  });

  test("falls back to even spacing when bucket timestamps are unusable", () => {
    const sameInstant = latencySeries.map((sample) => ({
      ...sample,
      at: new Date("2026-01-15T10:00:00.000Z"),
    }));
    const html = renderToStaticMarkup(
      <LatencyChart monitorName="Website" samples={sameInstant} />,
    );

    expect(html).toContain('points="0,22 50,2 100,14.22"');
  });

  test("defers the subscribe dialog until a visitor opens it", () => {
    const html = renderToStaticMarkup(
      <StatusPage snapshot={snapshot} subscribersEnabled title="Acme Status" />,
    );

    expect(html).toContain("Subscribe");
    expect(html).not.toContain("Subscribe to updates");
  });

  // A partial day is its own state: reporting it as either up or down loses the
  // only information the column carries.
  test("keeps daily tooltip data available to assistive technology", () => {
    const html = renderToStaticMarkup(
      <DayGrid days={snapshot.monitors[0]!.days} monitorName="Website" />,
    );

    expect(html).toContain("Website daily uptime history");
    expect(html).toContain("Jan 15, 2026: 95% uptime — 12 checks — 1 failure");
    expect(html).toContain('data-status="operational"');
    expect(html).toContain('data-status="degraded"');
  });

  test("shows unknown uptime as no data instead of a false 0% value", () => {
    const html = renderToStaticMarkup(<UptimeBar label="24h" uptime={null} />);

    expect(html).toContain("No data");
    expect(html).not.toContain('aria-valuenow="0"');
  });

  // The feeds are the only place that deep-links into the page, so the anchor
  // they publish has to exist in the markup the page renders.
  test("renders the incident anchor the RSS and Atom feeds link to", () => {
    const incident: Incident = {
      id: "inc_1",
      title: "Elevated errors",
      status: "investigating",
      severity: "major",
      affectedMonitors: ["Website"],
      auto: false,
      updates: [],
      createdAt: generatedAt,
      updatedAt: generatedAt,
      resolvedAt: null,
    };
    const config = validateStatusPageConfig({
      database: testDatabaseAdapter,
      siteUrl: "https://status.acme.test",
    });
    const feed = createRssFeed(config, [incident], "https://status.acme.test");
    const anchor = /<link>[^<]*#([^<]+)<\/link>/.exec(feed)?.[1];
    const html = renderToStaticMarkup(
      <StatusPage
        snapshot={{ ...snapshot, activeIncidents: [incident] }}
        title="Acme Status"
      />,
    );

    expect(anchor).toBe("incident-inc_1");
    expect(html).toContain(`id="${anchor}"`);
  });

  // A theme may compose the page differently, but it may not drop the data a
  // visitor came for or the hooks an embedding project styles the page with.
  test.each(builtInStatusThemeNames)(
    "the %s theme renders every monitor, group and incident",
    (theme) => {
      const html = renderToStaticMarkup(
        <StatusPage
          snapshot={{
            ...snapshot,
            activeIncidents: [
              {
                id: "inc_1",
                title: "Elevated errors",
                status: "investigating",
                severity: "major",
                affectedMonitors: ["Website"],
                auto: false,
                updates: [
                  {
                    id: "upd_1",
                    status: "investigating",
                    message: "Investigating elevated error rates.",
                    createdAt: generatedAt,
                  },
                ],
                createdAt: generatedAt,
                updatedAt: generatedAt,
                resolvedAt: null,
              },
            ],
          }}
          theme={theme}
          title="Acme Status"
        />,
      );

      expect(html).toContain(`data-theme="${theme}"`);
      expect(html).toContain('data-slot="status-page"');
      expect(html).toContain('data-slot="status-monitor"');
      expect(html).toContain('data-slot="status-overall"');
      expect(html).toContain("Partial System Outage");
      expect(html).toContain("Frontend");
      expect(html).toContain("Website");
      expect(html).toContain("Worker");
      expect(html).toContain("Elevated errors");
      // Every theme keeps the anchor the RSS and Atom feeds link to.
      expect(html).toContain('id="incident-inc_1"');
    },
  );

  test("every registered theme name resolves to a layout", () => {
    for (const name of builtInStatusThemeNames) {
      const theme = resolveStatusTheme(name);
      expect(theme.name).toBe(name);
      expect(typeof theme.Layout).toBe("function");
    }
  });

  test("creates a before-paint mode bootstrap script with the configured defaults", () => {
    const script = statusThemeBootstrapScript("acme-status-mode", "dark");

    expect(script).toContain('const storageKey = "acme-status-mode"');
    expect(script).toContain('const fallbackTheme = "dark"');
    // heyo-ui resolves both palettes from `color-scheme`, which `data-mode`
    // drives; a class would set nothing.
    expect(script).toContain('root.setAttribute("data-mode", theme)');
    expect(script).toContain('root.removeAttribute("data-mode")');
  });
});
