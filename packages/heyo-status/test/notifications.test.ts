import { describe, expect, test } from "bun:test";

import { heyoStatus } from "../src/config";
import { sqlite } from "../src/db";
import {
  collectMonitorNotificationEvents,
  dispatchNotifications,
} from "../src/notification-dispatcher";
import {
  email,
  notificationEventTypes,
  slack,
  verifyWebhookSignature,
  webhook,
} from "../src/notifications";
import type { CheckResult, StatusEvent } from "../src/types";

describe("notification delivery", () => {
  test("sends threshold and recovery Slack Block Kit alerts and records delivery history", async () => {
    const database = sqlite(":memory:");
    const payloads: Array<Record<string, unknown>> = [];
    try {
      const page = heyoStatus({
        database,
        title: "Acme Status",
        siteUrl: "https://status.acme.test",
        adminToken: "test-admin-token",
        monitors: [
          {
            name: "API",
            type: "http",
            url: "https://api.acme.test/health",
            group: "Backend",
          },
        ],
        notifications: {
          failureThreshold: 2,
          channels: [
            slack({
              id: "ops",
              webhookUrl: "https://hooks.slack.test/services/1",
              channel: "#ops",
              fetch: async (_input, init) => {
                payloads.push(
                  JSON.parse(String(init?.body)) as Record<string, unknown>,
                );
                return new Response(null, { status: 200 });
              },
            }),
          ],
        },
      });
      const first = failed("2030-01-01T00:00:00.000Z");
      const second = failed("2030-01-01T00:05:00.000Z");
      await database.insertCheckResults([first]);

      const downEvents = await collectMonitorNotificationEvents(
        page,
        [second],
        second.checkedAt,
      );
      expect(downEvents).toMatchObject([
        {
          type: "monitor.down",
          monitor: { name: "API", consecutiveFailures: 2 },
        },
      ]);
      await database.insertCheckResults([second]);
      await dispatchNotifications(page, downEvents);

      const recovered = healthy("2030-01-01T00:10:00.000Z");
      const recoveryEvents = await collectMonitorNotificationEvents(
        page,
        [recovered],
        recovered.checkedAt,
      );
      expect(recoveryEvents).toMatchObject([
        {
          type: "monitor.recovered",
          monitor: { name: "API", consecutiveFailures: 2 },
        },
      ]);
      await dispatchNotifications(page, recoveryEvents);

      expect(payloads).toHaveLength(2);
      expect(payloads[0]).toMatchObject({ channel: "#ops" });
      expect(payloads[0]?.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "header" }),
          expect.objectContaining({ type: "actions" }),
        ]),
      );
      expect(JSON.stringify(payloads[0])).toContain("API is down");
      expect(JSON.stringify(payloads[1])).toContain("API has recovered");

      await expect(database.listNotificationLog()).resolves.toMatchObject([
        {
          channelId: "ops",
          eventType: "monitor.recovered",
          status: "sent",
          attempts: 1,
          monitorName: "API",
        },
        {
          channelId: "ops",
          eventType: "monitor.down",
          status: "sent",
          attempts: 1,
          monitorName: "API",
        },
      ]);

      // The delivery history is operational data: it stays behind admin auth.
      const anonymous = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/notifications/log",
        ),
      );
      expect(anonymous.status).toBe(401);

      const response = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/notifications/log?eventType=monitor.down",
          { headers: { authorization: "Bearer test-admin-token" } },
        ),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        { eventType: "monitor.down", channelId: "ops" },
      ]);
    } finally {
      database.close();
    }
  });

  test("retries generic webhooks and signs the exact JSON payload with its timestamp", async () => {
    let calls = 0;
    let receivedBody = "";
    let receivedSignature = "";
    const channel = webhook({
      id: "partner",
      url: "https://hooks.partner.test/status",
      secret: "top-secret",
      retries: 3,
      retryDelayMs: 0,
      fetch: async (_input, init) => {
        calls += 1;
        receivedBody = String(init?.body);
        receivedSignature =
          new Headers(init?.headers).get("x-heyo-signature") ?? "";
        return new Response(calls === 3 ? "ok" : "try again", {
          status: calls === 3 ? 200 : 503,
        });
      },
    });
    const event = monitorDownEvent();

    await expect(channel.send(event)).resolves.toEqual({ attempts: 3 });
    expect(calls).toBe(3);
    expect(JSON.parse(receivedBody)).toMatchObject({
      event: "monitor.down",
      timestamp: "2030-01-01T00:00:00.000Z",
      monitor: { name: "API", consecutiveFailures: 3 },
    });
    await expect(
      verifyWebhookSignature("top-secret", receivedSignature, receivedBody),
    ).resolves.toBe(true);
  });

  // The dispatcher used to detect an expiring certificate by matching the
  // human-readable check message, so rewording a check silently downgraded the
  // event back to monitor.down.
  test("routes an expiring certificate to ssl.expiring by result, not message", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database,
        monitors: [{ name: "TLS", type: "ssl", host: "acme.test" }],
        notifications: { failureThreshold: 1 },
      });
      const expiring: CheckResult = {
        name: "TLS",
        type: "ssl",
        status: false,
        message: "anything at all",
        latencyMs: 10,
        checkedAt: new Date("2026-03-15T12:00:00.000Z"),
        expiring: true,
      } as CheckResult;

      await expect(
        collectMonitorNotificationEvents(page, [expiring]),
      ).resolves.toMatchObject([{ type: "ssl.expiring" }]);

      await expect(
        collectMonitorNotificationEvents(page, [
          { ...expiring, expiring: false } as CheckResult,
        ]),
      ).resolves.toMatchObject([{ type: "monitor.down" }]);
    } finally {
      database.close();
    }
  });

  test("expands wildcard event selectors and rejects unsupported ones", () => {
    const channel = webhook({
      url: "https://hooks.acme.test/status",
      secret: "top-secret",
      events: ["monitor.down", "incident.*"],
    });
    expect(channel.events).toEqual([
      "monitor.down",
      "incident.created",
      "incident.updated",
      "incident.resolved",
    ]);

    expect(
      webhook({
        url: "https://hooks.acme.test/status",
        secret: "top-secret",
        events: ["*"],
      }).events,
    ).toEqual(notificationEventTypes());

    expect(() =>
      webhook({
        url: "https://hooks.acme.test/status",
        secret: "top-secret",
        events: ["nope.*" as never],
      }),
    ).toThrow();
    expect(() =>
      webhook({
        url: "https://hooks.acme.test/status",
        secret: "top-secret",
        events: ["monitor.down", "monitor.down"],
      }),
    ).toThrow();
  });

  test("uses Resend's HTTP API and renders a minimal escaped HTML email", async () => {
    let request:
      { headers: Headers; body: Record<string, unknown> } | undefined;
    const channel = email({
      id: "email-ops",
      transport: "resend",
      from: "status@acme.test",
      to: ["ops@acme.test"],
      apiKey: "re_test",
      endpoint: "https://resend.test/emails",
      fetch: async (_input, init) => {
        request = {
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      },
    });

    await channel.send({
      ...monitorDownEvent(),
      monitor: {
        ...monitorDownEvent().monitor!,
        message: "Unexpected <failure>",
      },
    });

    expect(request?.headers.get("authorization")).toBe("Bearer re_test");
    expect(request?.body).toMatchObject({
      from: "status@acme.test",
      to: ["ops@acme.test"],
    });
    expect(String(request?.body.html)).toContain("&lt;failure&gt;");
  });

  /**
   * Transition detection used to read a monitor's whole retained history once
   * per monitor, so one scheduled run cost a full-history query for every
   * configured monitor, every five minutes.
   */
  test("reads check history once per run, not once per monitor", async () => {
    const database = sqlite(":memory:");
    let historyReads = 0;
    try {
      const counting = new Proxy(database, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (typeof value !== "function") return value;
          if (property === "getSnapshot") {
            return (...args: unknown[]) => {
              historyReads += 1;
              return (value as (...input: unknown[]) => unknown).apply(
                target,
                args,
              );
            };
          }
          return value.bind(target);
        },
      });
      const page = heyoStatus({
        database: counting,
        monitors: Array.from({ length: 12 }, (_, index) => ({
          name: `Monitor ${index}`,
          type: "http" as const,
          url: "https://example.test",
        })),
      });

      const results: CheckResult[] = page.monitors.map((monitor) => ({
        name: monitor.name,
        type: "http",
        status: false,
        message: "HTTP 503",
        latencyMs: 10,
        checkedAt: new Date("2030-01-01T00:00:00.000Z"),
      }));
      await collectMonitorNotificationEvents(page, results);

      expect(historyReads).toBe(1);
    } finally {
      database.close();
    }
  });
});

function failed(checkedAt: string): CheckResult {
  return {
    name: "API",
    type: "http",
    status: false,
    message: "HTTP 503, expected 200",
    latencyMs: 2340,
    checkedAt: new Date(checkedAt),
  };
}

function healthy(checkedAt: string): CheckResult {
  return {
    ...failed(checkedAt),
    status: true,
    message: "HTTP 200",
    latencyMs: 12,
  };
}

function monitorDownEvent(): StatusEvent {
  return {
    type: "monitor.down",
    occurredAt: new Date("2030-01-01T00:00:00.000Z"),
    page: { title: "Acme Status", siteUrl: "https://status.acme.test" },
    monitor: {
      ...failed("2030-01-01T00:00:00.000Z"),
      group: "Backend",
      target: "https://api.acme.test/health",
      consecutiveFailures: 3,
    },
  };
}
