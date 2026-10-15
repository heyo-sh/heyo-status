import { describe, expect, test } from "bun:test";

import packageJson from "../package.json";
import { validateStatusPageConfig } from "../src/config";
import {
  createTelemetryPayload,
  isTelemetryEnabled,
  reportTelemetry,
} from "../src/telemetry";
import { heyoStatusVersion } from "../src/version";
import { testDatabaseAdapter } from "./fixtures";

const config = validateStatusPageConfig({
  database: testDatabaseAdapter,
  title: "Acme Status",
  siteUrl: "https://status.acme.com",
  monitors: [
    { name: "Website", type: "http", url: "https://acme.com", group: "Web" },
    { name: "API", type: "http", url: "https://api.acme.com" },
    {
      name: "Database",
      type: "tcp",
      host: "db.internal",
      port: 5432,
      private: true,
    },
    { name: "Stack", type: "composite", monitors: ["Website", "API"] },
  ],
  metrics: { prometheus: true },
});

describe("adoption telemetry", () => {
  test("keeps the reported version in sync with package.json", () => {
    expect(heyoStatusVersion).toBe(packageJson.version);
  });

  test("honours configuration and environment opt-outs", () => {
    expect(isTelemetryEnabled(config, {})).toBe(true);
    expect(isTelemetryEnabled(config, { HEYO_TELEMETRY_DISABLED: "1" })).toBe(
      false,
    );
    expect(isTelemetryEnabled(config, { DO_NOT_TRACK: "1" })).toBe(false);
    expect(isTelemetryEnabled(config, { CI: "true" })).toBe(false);
    expect(isTelemetryEnabled(config, { NODE_ENV: "test" })).toBe(false);
    // An explicit "off" value must not be mistaken for an opt-out request.
    expect(isTelemetryEnabled(config, { HEYO_TELEMETRY_DISABLED: "0" })).toBe(
      true,
    );
    expect(
      isTelemetryEnabled(
        validateStatusPageConfig({
          database: testDatabaseAdapter,
          telemetry: false,
        }),
        {},
      ),
    ).toBe(false);
  });

  test("collects only anonymous, aggregate configuration facts", async () => {
    const payload = await createTelemetryPayload(config, {
      runtime: "bun",
      runtimeVersion: "1.3.1",
      platform: "darwin",
    });

    expect(payload).toMatchObject({
      schema: 1,
      package: "@heyo-sh/heyo-status",
      version: heyoStatusVersion,
      runtime: "bun",
      monitors: {
        total: 4,
        private: 1,
        groups: 1,
        byType: { http: 2, ssl: 0, tcp: 1, dns: 0, composite: 1 },
      },
      features: { prometheus: true, incidents: true, subscribers: false },
    });
    expect(payload.projectId).toMatch(/^[\da-f]{16}$/);

    const serialised = JSON.stringify(payload);
    for (const secret of [
      "Acme Status",
      "status.acme.com",
      "api.acme.com",
      "db.internal",
      "Website",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  test("derives a stable project id from the site URL", async () => {
    const first = await createTelemetryPayload(config);
    const second = await createTelemetryPayload(config);
    const other = await createTelemetryPayload(
      validateStatusPageConfig({
        database: testDatabaseAdapter,
        siteUrl: "https://status.example.com",
      }),
    );

    expect(first.projectId).toBe(second.projectId);
    expect(first.projectId).not.toBe(other.projectId);
  });

  test("posts one ping when enabled and stays silent when opted out", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(
      reportTelemetry(config, { env: {}, fetch: fetcher }),
    ).resolves.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://telemetry.heyo.sh/v1/status");

    await expect(
      reportTelemetry(config, { env: { DO_NOT_TRACK: "1" }, fetch: fetcher }),
    ).resolves.toBe(false);
    expect(requests).toHaveLength(1);
  });

  test("never throws when the collector is unreachable", async () => {
    const failing = (() => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;

    await expect(
      reportTelemetry(config, { env: {}, fetch: failing }),
    ).resolves.toBe(false);
  });
});
