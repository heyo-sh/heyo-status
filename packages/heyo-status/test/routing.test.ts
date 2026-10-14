import { describe, expect, test } from "bun:test";

import { heyoStatus } from "../src/config";
import { lazyStatusDatabase, sqlite } from "../src/db";
import type { StatusPage } from "../src/types";

const monitors = [
  { name: "Website", type: "http" as const, url: "https://example.com" },
];

function createPage(
  database: ReturnType<typeof sqlite>,
  overrides: { basePath?: string; adminToken?: string } = {},
): StatusPage {
  return heyoStatus({
    database,
    title: "Acme Status",
    monitors,
    metrics: { prometheus: true },
    subscribers: { enabled: true },
    ...overrides,
  });
}

describe("catch-all routing", () => {
  /**
   * Regression guard: every template mounts one catch-all route at the base
   * path, so the router must answer on `basePath + path` rather than on bare
   * absolute paths. Without this the entire HTTP API 404s once deployed.
   */
  test("serves every documented endpoint under the default base path", async () => {
    const database = sqlite(":memory:");
    try {
      const page = createPage(database);
      const paths = [
        "/status",
        "/status/summary",
        "/monitors",
        "/monitors/Website",
        "/monitors/Website/uptime",
        "/incidents",
        "/maintenance",
        "/rss.xml",
        "/atom.xml",
        "/healthz",
        "/badge/Website.svg",
        "/metrics",
      ];

      for (const path of paths) {
        const response = await page.handler(
          new Request(`https://status.acme.test/api/heyo-status${path}`),
        );
        expect({ path, status: response.status }).toEqual({
          path,
          status: 200,
        });
      }
    } finally {
      database.close();
    }
  });

  test("honours a configured base path and rejects unmounted paths", async () => {
    const database = sqlite(":memory:");
    try {
      const page = createPage(database, { basePath: "/status-api/" });
      expect(page.basePath).toBe("/status-api");
      // The documented contract is always a promise, including for 404s.
      expect(
        page.handler(new Request("https://status.acme.test/nope")),
      ).toBeInstanceOf(Promise);

      await expect(
        page
          .handler(new Request("https://status.acme.test/status-api/healthz"))
          .then((response) => response.status),
      ).resolves.toBe(200);
      await expect(
        page
          .handler(
            new Request("https://status.acme.test/api/heyo-status/healthz"),
          )
          .then((response) => response.status),
      ).resolves.toBe(404);
      // A base-path prefix must not match a longer sibling segment.
      await expect(
        page
          .handler(new Request("https://status.acme.test/status-api-v2/status"))
          .then((response) => response.status),
      ).resolves.toBe(404);
    } finally {
      database.close();
    }
  });

  test("rejects a base path which is not a mountable absolute path", () => {
    const database = sqlite(":memory:");
    try {
      for (const basePath of [
        "api/heyo-status",
        "/",
        "/api?x=1",
        "/api#x",
        "/api//status",
      ]) {
        expect(() => createPage(database, { basePath })).toThrow();
      }
    } finally {
      database.close();
    }
  });

  test("summary and uptime endpoints expose the documented shapes", async () => {
    const database = sqlite(":memory:");
    try {
      const page = createPage(database);
      const summary = await page
        .handler(
          new Request(
            "https://status.acme.test/api/heyo-status/status/summary",
          ),
        )
        .then((response) => response.json());
      expect(summary).toMatchObject({
        overall: "operational",
        activeIncidents: 0,
        monitors: [{ name: "Website", latestStatus: null }],
      });

      const uptime = await page
        .handler(
          new Request(
            "https://status.acme.test/api/heyo-status/monitors/Website/uptime",
          ),
        )
        .then((response) => response.json());
      expect(uptime).toMatchObject({
        name: "Website",
        "24h": null,
        "7d": null,
        "30d": null,
        "90d": null,
        displayDays: 90,
      });
    } finally {
      database.close();
    }
  });
});

/**
 * Read routes have nothing to recover from, but a JSON API must not switch to
 * Hono's plain-text 500 and drop the reason with it.
 */
describe("unreachable database", () => {
  test("answers with the API's JSON error shape and keeps the reason", async () => {
    const page = heyoStatus({
      database: lazyStatusDatabase(() => {
        throw new Error("Cloudflare D1 is not bound.");
      }),
      monitors: [{ name: "API", type: "http", url: "https://example.com" }],
    });

    const healthz = await page.handler(
      new Request("https://status.test/api/heyo-status/healthz"),
    );
    expect(healthz.status).toBe(200);

    const snapshot = await page.handler(
      new Request("https://status.test/api/heyo-status/status"),
    );
    expect(snapshot.status).toBe(500);
    expect(snapshot.headers.get("content-type")).toContain("application/json");
    await expect(snapshot.json()).resolves.toEqual({
      error: "Cloudflare D1 is not bound.",
    });
  });
});

describe("management API authentication", () => {
  const managementRequests = [
    { method: "POST", path: "/admin/checks/run" },
    { method: "POST", path: "/admin/incidents" },
    { method: "POST", path: "/admin/incidents/inc_1/updates" },
    { method: "PATCH", path: "/admin/incidents/inc_1" },
    { method: "DELETE", path: "/admin/incidents/inc_1" },
    { method: "POST", path: "/admin/maintenance" },
    { method: "PATCH", path: "/admin/maintenance/mnt_1" },
    { method: "DELETE", path: "/admin/maintenance/mnt_1" },
    { method: "GET", path: "/admin/notifications/log" },
  ];

  test("refuses every management route without a bearer token", async () => {
    const database = sqlite(":memory:");
    try {
      const page = createPage(database, { adminToken: "s3cret" });
      for (const { method, path } of managementRequests) {
        const anonymous = await page.handler(
          new Request(`https://status.acme.test/api/heyo-status${path}`, {
            method,
          }),
        );
        expect({ path, status: anonymous.status }).toEqual({
          path,
          status: 401,
        });

        const wrongToken = await page.handler(
          new Request(`https://status.acme.test/api/heyo-status${path}`, {
            method,
            headers: { authorization: "Bearer wrong" },
          }),
        );
        expect({ path, status: wrongToken.status }).toEqual({
          path,
          status: 401,
        });
      }
    } finally {
      database.close();
    }
  });

  test("stays closed when no token is configured or exported", async () => {
    const database = sqlite(":memory:");
    const previous = process.env.HEYO_STATUS_API_TOKEN;
    delete process.env.HEYO_STATUS_API_TOKEN;
    try {
      const page = createPage(database);
      const response = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/incidents",
          { method: "POST" },
        ),
      );
      expect(response.status).toBe(503);
    } finally {
      if (previous === undefined) delete process.env.HEYO_STATUS_API_TOKEN;
      else process.env.HEYO_STATUS_API_TOKEN = previous;
      database.close();
    }
  });

  test("accepts the HEYO_STATUS_API_TOKEN environment fallback", async () => {
    const database = sqlite(":memory:");
    const previous = process.env.HEYO_STATUS_API_TOKEN;
    process.env.HEYO_STATUS_API_TOKEN = "env-token";
    try {
      const page = createPage(database);
      const response = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/checks/run",
          { method: "POST", headers: { authorization: "Bearer env-token" } },
        ),
      );
      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.HEYO_STATUS_API_TOKEN;
      else process.env.HEYO_STATUS_API_TOKEN = previous;
      database.close();
    }
  });

  test("edits and deletes maintenance windows through the admin API", async () => {
    const database = sqlite(":memory:");
    try {
      const page = createPage(database, { adminToken: "s3cret" });
      const headers = {
        "content-type": "application/json",
        authorization: "Bearer s3cret",
      };
      const created = (await page
        .handler(
          new Request(
            "https://status.acme.test/api/heyo-status/admin/maintenance",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                title: "Database upgrade",
                affectedMonitors: ["Website"],
                scheduledStart: "2030-01-01T02:00:00.000Z",
                scheduledEnd: "2030-01-01T04:00:00.000Z",
              }),
            },
          ),
        )
        .then((response) => response.json())) as { id: string };

      const patched = await page.handler(
        new Request(
          `https://status.acme.test/api/heyo-status/admin/maintenance/${created.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              title: "Database upgrade (rescheduled)",
              scheduledStart: "2030-02-01T02:00:00.000Z",
              scheduledEnd: "2030-02-01T03:00:00.000Z",
            }),
          },
        ),
      );
      expect(patched.status).toBe(200);
      await expect(patched.json()).resolves.toMatchObject({
        id: created.id,
        title: "Database upgrade (rescheduled)",
        status: "scheduled",
      });

      const invalid = await page.handler(
        new Request(
          `https://status.acme.test/api/heyo-status/admin/maintenance/${created.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              scheduledStart: "2030-02-01T04:00:00.000Z",
              scheduledEnd: "2030-02-01T03:00:00.000Z",
            }),
          },
        ),
      );
      expect(invalid.status).toBe(400);

      const removed = await page.handler(
        new Request(
          `https://status.acme.test/api/heyo-status/admin/maintenance/${created.id}`,
          { method: "DELETE", headers },
        ),
      );
      expect(removed.status).toBe(204);
      await expect(database.listUpcoming()).resolves.toEqual([]);

      const missing = await page.handler(
        new Request(
          `https://status.acme.test/api/heyo-status/admin/maintenance/${created.id}`,
          { method: "DELETE", headers },
        ),
      );
      expect(missing.status).toBe(404);
    } finally {
      database.close();
    }
  });
});
