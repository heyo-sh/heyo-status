import { describe, expect, test } from "bun:test";

import { heyoStatus, validateStatusPageConfig } from "../src/config";
import type { StatusPageConfig } from "../src/types";
import { testDatabaseAdapter } from "./fixtures";

describe("heyoStatus", () => {
  test("applies stable page, scheduling, and presentation defaults", () => {
    expect<StatusPageConfig>(
      heyoStatus({ database: testDatabaseAdapter }),
    ).toEqual({
      database: testDatabaseAdapter,
      title: "Heyo Status",
      description: "Real-time service status and uptime.",
      siteUrl: undefined,
      basePath: "/api/heyo-status",
      theme: "slate",
      colors: {},
      mode: "system",
      branding: {},
      monitors: [],
      checks: {
        interval: "*/5 * * * *",
        retentionDays: 90,
        displayDays: 90,
        summaryCron: "10 0 * * *",
        cleanupCron: "0 3 * * *",
      },
      notifications: { failureThreshold: 3, channels: [] },
      incidents: { enabled: true },
      maintenance: { enabled: true },
      metrics: {
        showLatency: true,
        showLatencyChart: true,
        showUptimePercent: true,
        uptimePeriods: ["24h", "7d", "30d", "90d"],
        badges: true,
        prometheus: false,
      },
      subscribers: {
        enabled: false,
        methods: ["email", "rss"],
        requireConfirmation: true,
      },
      cache: { snapshotTtlMs: 30_000 },
      telemetry: {
        enabled: true,
        endpoint: "https://telemetry.heyo.sh/v1/status",
      },
    });
  });

  test("accepts a boolean telemetry opt-out and a custom snapshot cache TTL", () => {
    const statusPage = heyoStatus({
      database: testDatabaseAdapter,
      telemetry: false,
      cache: { snapshotTtlMs: 0 },
    });

    expect(statusPage.telemetry).toEqual({
      enabled: false,
      endpoint: "https://telemetry.heyo.sh/v1/status",
    });
    expect(statusPage.cache).toEqual({ snapshotTtlMs: 0 });
  });

  test("defaults composite monitors to the all strategy and validates components", () => {
    const monitors = heyoStatus({
      database: testDatabaseAdapter,
      monitors: [
        { name: "Website", type: "http", url: "https://example.com" },
        { name: "API", type: "http", url: "https://api.example.com" },
        {
          name: "Full Stack Health",
          type: "composite",
          monitors: ["Website", "API"],
        },
      ],
    }).monitors;

    expect(monitors[2]).toEqual({
      name: "Full Stack Health",
      type: "composite",
      monitors: ["Website", "API"],
      strategy: "all",
    });

    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        monitors: [
          {
            name: "Full Stack Health",
            type: "composite",
            monitors: ["Website"],
          },
        ],
      }),
    ).toThrow(/references unknown monitor/);
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        monitors: [
          {
            name: "Loop",
            type: "composite",
            monitors: ["Loop"],
          },
        ],
      }),
    ).toThrow(/references unknown monitor/);
  });

  test("keeps the page title separate from optional visible branding", () => {
    const logoOnly = heyoStatus({
      database: testDatabaseAdapter,
      title: "Acme Status",
      branding: { logo: "/logo.svg" },
    });
    expect(logoOnly.title).toBe("Acme Status");
    expect(logoOnly.branding).toEqual({ logo: "/logo.svg" });

    const withName = heyoStatus({
      database: testDatabaseAdapter,
      branding: { logo: "/logo.svg", name: "Acme" },
    });
    expect(withName.branding).toEqual({ name: "Acme", logo: "/logo.svg" });
  });

  test("preserves explicit mode and built-in theme", () => {
    const statusPage = heyoStatus({
      database: testDatabaseAdapter,
      mode: "dark",
      theme: "onyx",
      colors: { primary: "#2563eb", secondary: "#eff6ff" },
    });

    expect(statusPage.mode).toBe("dark");
    expect(statusPage.theme).toBe("onyx");
    expect(statusPage.colors).toEqual({
      primary: "#2563eb",
      secondary: "#eff6ff",
    });
  });

  test("normalises an HTTP(S) site URL without a trailing slash", () => {
    expect(
      heyoStatus({
        database: testDatabaseAdapter,
        siteUrl: "https://status.example.com/status/",
      }).siteUrl,
    ).toBe("https://status.example.com/status");
  });

  test("applies checker defaults to every monitor type", () => {
    const monitors = heyoStatus({
      database: testDatabaseAdapter,
      monitors: [
        { name: "Website", type: "http", url: "https://example.com" },
        { name: "Certificate", type: "ssl", host: "example.com" },
        { name: "Database", type: "tcp", host: "db.example.com", port: 5432 },
        { name: "DNS", type: "dns", host: "example.com" },
      ],
    }).monitors;

    expect(monitors).toEqual([
      {
        name: "Website",
        type: "http",
        url: "https://example.com",
        method: "GET",
        expectedStatus: [200],
        timeoutMs: 10_000,
        softFail: false,
        softFailMs: 500,
        followRedirects: true,
      },
      {
        name: "Certificate",
        type: "ssl",
        host: "example.com",
        port: 443,
        warnBeforeDays: 14,
        timeoutMs: 10_000,
      },
      {
        name: "Database",
        type: "tcp",
        host: "db.example.com",
        port: 5432,
        timeoutMs: 10_000,
      },
      {
        name: "DNS",
        type: "dns",
        host: "example.com",
        recordType: "A",
        timeoutMs: 10_000,
      },
    ]);
  });

  test("accepts JSON expectations and custom HTTP settings", () => {
    const monitor = heyoStatus({
      database: testDatabaseAdapter,
      monitors: [
        {
          name: "API",
          type: "http",
          url: "https://api.example.com/health",
          method: "POST",
          headers: { authorization: "Bearer test" },
          expectedStatus: [200, 201],
          expectedResponseHeaders: { "x-health": "ready" },
          expectedBodyIncludes: "healthy",
          expectedBodyExcludes: "error",
          expectedJson: { status: "ok", meta: { version: 1 } },
          softFail: true,
          softFailMs: 2_000,
          followRedirects: false,
        },
      ],
    }).monitors[0];

    expect(monitor).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer test" },
      expectedStatus: [200, 201],
      expectedResponseHeaders: { "x-health": "ready" },
      expectedJson: { status: "ok", meta: { version: 1 } },
      softFail: true,
      softFailMs: 2_000,
      followRedirects: false,
    });
  });

  test("rejects unknown keys at every configuration level", () => {
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        unexpected: true,
      } as never),
    ).toThrow();
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        colors: { primary: "#2563eb", tertiary: "#fff" },
      } as never),
    ).toThrow();
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        monitors: [
          {
            name: "Website",
            type: "http",
            url: "https://example.com",
            retries: 3,
          },
        ],
      } as never),
    ).toThrow();
  });

  test("rejects invalid modes, themes, URLs, and monitor configuration", () => {
    const invalidConfigs = [
      { mode: "midnight" },
      { theme: "custom" },
      { siteUrl: "ftp://status.example.com" },
      { siteUrl: "https://status.example.com?preview=true" },
      { siteUrl: "https://status.example.com#overview" },
      {
        monitors: [{ name: "Website", type: "http", url: "ftp://example.com" }],
      },
      { monitors: [{ name: "Database", type: "tcp", host: "db", port: 0 }] },
      {
        monitors: [
          { name: "DNS", type: "dns", host: "example.com", recordType: "" },
        ],
      },
    ];

    for (const invalidConfig of invalidConfigs) {
      expect(() =>
        validateStatusPageConfig({
          database: testDatabaseAdapter,
          ...invalidConfig,
        } as never),
      ).toThrow();
    }
  });

  test("rejects duplicate monitor names and impossible history settings", () => {
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        monitors: [
          { name: "API", type: "http", url: "https://api.example.com" },
          { name: "API", type: "dns", host: "api.example.com" },
        ],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        checks: { retentionDays: 7, displayDays: 30 },
      }),
    ).toThrow(/displayDays.*retentionDays/i);
  });

  test("rejects incomplete database and notification adapter contracts", () => {
    expect(() => validateStatusPageConfig({ database: {} as never })).toThrow(
      /StatusDatabaseAdapter/,
    );
    expect(() =>
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        notifications: {
          channels: [{ id: "ops", type: "slack" }] as never,
        },
      }),
    ).toThrow(/NotificationChannel/);
  });
});
