import { describe, expect, spyOn, test } from "bun:test";

import { heyoStatus } from "../src/config";
import { sqlite } from "../src/db";
import { email, type EmailMessage } from "../src/notifications";
import { dispatchSubscriberNotifications } from "../src/subscribers";

describe("public subscriptions and feeds", () => {
  test("confirms email subscriptions, delivers incident mail, and publishes RSS and Atom", async () => {
    const database = sqlite(":memory:");
    const messages: EmailMessage[] = [];
    try {
      const page = heyoStatus({
        database,
        title: "Acme Status",
        description: "Acme service health.",
        siteUrl: "https://status.acme.test",
        adminToken: "test-admin-token",
        monitors: [{ name: "API", type: "http", url: "https://api.acme.test" }],
        subscribers: {
          enabled: true,
          methods: ["email", "rss", "webhook"],
          requireConfirmation: true,
        },
        notifications: {
          channels: [
            email({
              from: "status@acme.test",
              to: "ops@acme.test",
              transport: "smtp",
              send: async (message) => {
                messages.push(message);
              },
            }),
          ],
        },
      });

      const subscribeResponse = await page.handler(
        new Request("https://status.acme.test/api/heyo-status/subscribers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "email",
            target: "visitor@acme.test",
            monitors: ["API"],
          }),
        }),
      );
      expect(subscribeResponse.status).toBe(202);
      expect(await subscribeResponse.json()).toEqual({ status: "pending" });
      const subscriber = (await database.listSubscribers())[0]!;
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ to: ["visitor@acme.test"] });
      const confirmationUrl = messages[0]?.text.match(/https:\/\/[^\s]+/)?.[0];
      if (!confirmationUrl)
        throw new Error("Confirmation email omitted its URL.");

      const confirmResponse = await page.handler(new Request(confirmationUrl));
      expect(confirmResponse.status).toBe(200);
      expect(confirmResponse.headers.get("cache-control")).toBe("no-store");
      expect(confirmResponse.headers.get("referrer-policy")).toBe(
        "no-referrer",
      );
      await expect(confirmResponse.json()).resolves.toMatchObject({
        id: subscriber.id,
        confirmed: true,
        monitors: ["API"],
      });
      await expect(
        database.listSubscribers({ confirmed: true }),
      ).resolves.toHaveLength(1);

      const incidentResponse = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/incidents",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer test-admin-token",
            },
            body: JSON.stringify({
              title: "API <outage>",
              severity: "major",
              affectedMonitors: ["API"],
              message: "Investigating.",
            }),
          },
        ),
      );
      expect(incidentResponse.status).toBe(201);
      expect(messages).toHaveLength(3);
      expect(messages[2]).toMatchObject({ to: ["visitor@acme.test"] });

      const maintenanceResponse = await page.handler(
        new Request(
          "https://status.acme.test/api/heyo-status/admin/maintenance",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer test-admin-token",
            },
            body: JSON.stringify({
              title: "API maintenance",
              affectedMonitors: ["API"],
              scheduledStart: "2030-01-01T01:00:00.000Z",
              scheduledEnd: "2030-01-01T02:00:00.000Z",
            }),
          },
        ),
      );
      expect(maintenanceResponse.status).toBe(201);
      expect(messages).toHaveLength(5);
      expect(messages[4]).toMatchObject({ to: ["visitor@acme.test"] });

      const rss = await page.handler(
        new Request("https://status.acme.test/api/heyo-status/rss.xml"),
      );
      expect(rss.headers.get("content-type")).toContain("application/rss+xml");
      const rssBody = await rss.text();
      expect(rssBody).toContain('<rss version="2.0"');
      expect(rssBody).toContain("API &lt;outage&gt;");
      // Feed self links must resolve to the mounted catch-all route.
      expect(rssBody).toContain(
        '<atom:link href="https://status.acme.test/api/heyo-status/rss.xml" rel="self"',
      );

      const atom = await page.handler(
        new Request("https://status.acme.test/api/heyo-status/atom.xml"),
      );
      expect(atom.headers.get("content-type")).toContain(
        "application/atom+xml",
      );
      const atomBody = await atom.text();
      expect(atomBody).toContain('xmlns="http://www.w3.org/2005/Atom"');
      expect(atomBody).toContain(
        '<link rel="self" href="https://status.acme.test/api/heyo-status/atom.xml"/>',
      );

      // The notification mail links here, so the link must work in a browser.
      const unsubscribeUrl = `https://status.acme.test/api/heyo-status/subscribers/${subscriber.id}/unsubscribe`;
      expect(messages.at(-1)?.html).toContain(unsubscribeUrl);

      const unsubscribePage = await page.handler(new Request(unsubscribeUrl));
      expect(unsubscribePage.status).toBe(200);
      expect(unsubscribePage.headers.get("content-type")).toContain(
        "text/html",
      );
      // A GET must never unsubscribe: mail scanners prefetch links.
      expect(await unsubscribePage.text()).toContain('method="post"');
      await expect(database.listSubscribers()).resolves.toHaveLength(1);

      const confirmed = await page.handler(
        new Request(unsubscribeUrl, { method: "POST" }),
      );
      expect(confirmed.status).toBe(200);
      expect(await confirmed.text()).toContain("You are unsubscribed");
      await expect(database.listSubscribers()).resolves.toEqual([]);

      const apiDelete = await page.handler(
        new Request(
          `https://status.acme.test/api/heyo-status/subscribers/${subscriber.id}`,
          { method: "DELETE" },
        ),
      );
      expect(apiDelete.status).toBe(404);
    } finally {
      database.close();
    }
  });

  /**
   * `POST /subscribers` is public and sends mail. Creating a row per request
   * let anyone mail an address repeatedly, and every duplicate row then
   * received its own copy of every future incident.
   */
  test("treats a repeated subscription as the same subscription", async () => {
    const database = sqlite(":memory:");
    const messages: EmailMessage[] = [];
    try {
      const page = heyoStatus({
        database,
        title: "Acme Status",
        subscribers: { enabled: true },
        notifications: {
          channels: [
            email({
              from: "status@acme.test",
              to: "ops@acme.test",
              transport: "smtp",
              send: async (message) => {
                messages.push(message);
              },
            }),
          ],
        },
      });
      const subscribe = () =>
        page.handler(
          new Request("https://status.acme.test/api/heyo-status/subscribers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "email",
              target: "visitor@acme.test",
            }),
          }),
        );

      const first = await subscribe();
      const repeats = await Promise.all([
        subscribe(),
        subscribe(),
        subscribe(),
      ]);

      expect(first.status).toBe(202);
      expect(repeats.map((response) => response.status)).toEqual([
        202, 202, 202,
      ]);
      expect(messages).toHaveLength(1);
      for (const response of [first, ...repeats]) {
        await expect(response.json()).resolves.toEqual({ status: "pending" });
      }
      await expect(database.listSubscribers()).resolves.toHaveLength(1);

      // Confirming still works, but a stranger cannot learn whether an address
      // has already confirmed (or retrieve its unsubscribe capability).
      const confirmationUrl = messages[0]?.text.match(/https:\/\/[^\s]+/)?.[0];
      if (!confirmationUrl)
        throw new Error("Confirmation email omitted its URL.");
      await page.handler(new Request(confirmationUrl));

      const afterConfirmation = await subscribe();
      expect(afterConfirmation.status).toBe(202);
      await expect(afterConfirmation.json()).resolves.toEqual({
        status: "pending",
      });
      expect(messages).toHaveLength(1);
      await expect(database.listSubscribers()).resolves.toHaveLength(1);
    } finally {
      database.close();
    }
  });

  /**
   * The API de-duplicates before inserting, but two concurrent requests both
   * pass that check. Only the index can settle the race, and the loser has to
   * report the winner's subscription rather than a failure.
   */
  test("enforces one subscription per destination in the database", async () => {
    const database = sqlite(":memory:");
    try {
      await database.createSubscriber({
        type: "email",
        target: "visitor@acme.test",
        confirmToken: "first",
      });
      await expect(
        database.createSubscriber({
          type: "email",
          target: "visitor@acme.test",
          confirmToken: "second",
        }),
      ).rejects.toThrow(/UNIQUE|unique/);

      // The same address is a different subscription per delivery method.
      await expect(
        database.createSubscriber({
          type: "webhook",
          target: "https://hooks.acme.test/status",
          confirmed: true,
        }),
      ).resolves.toMatchObject({ type: "webhook" });
      await expect(database.listSubscribers()).resolves.toHaveLength(2);
    } finally {
      database.close();
    }
  });

  /**
   * A public subscription makes the status page issue HTTP requests chosen by
   * an anonymous visitor. Without a destination filter it is a
   * request-forgery proxy into the deployment's own network.
   */
  test("refuses webhook destinations that are not publicly routable", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({
        database,
        subscribers: {
          enabled: true,
          methods: ["webhook"],
          requireConfirmation: false,
        },
      });
      const subscribe = (target: string) =>
        page.handler(
          new Request("https://status.acme.test/api/heyo-status/subscribers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "webhook", target }),
          }),
        );

      const rejected = [
        "http://localhost:3000/hook",
        "http://127.0.0.1/hook",
        "http://[::1]/hook",
        "http://[::ffff:127.0.0.1]/hook",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/hook",
        "http://172.16.0.1/hook",
        "http://192.168.1.1/hook",
        "http://100.64.0.1/hook",
        "http://0.0.0.0/hook",
        "http://[fd00::1]/hook",
        "http://metadata.google.internal/hook",
        "http://database.local/hook",
        "ftp://hooks.acme.test/hook",
      ];
      for (const target of rejected) {
        expect({ target, status: (await subscribe(target)).status }).toEqual({
          target,
          status: 400,
        });
      }

      // Credentials would be stored in clear text and replayed on every send.
      expect((await subscribe("https://a:b@hooks.acme.test/x")).status).toBe(
        400,
      );
      expect((await subscribe("https://hooks.acme.test/status")).status).toBe(
        201,
      );
      await expect(database.listSubscribers()).resolves.toHaveLength(1);
    } finally {
      database.close();
    }
  });

  test("webhooks require opt-in and deliveries never follow redirects", async () => {
    const database = sqlite(":memory:");
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/" },
      }),
    );
    try {
      const defaultPage = heyoStatus({
        database,
        subscribers: { enabled: true },
      });
      const subscription = new Request(
        "https://status.acme.test/api/heyo-status/subscribers",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "webhook",
            target: "https://hooks.acme.test/events",
          }),
        },
      );
      expect((await defaultPage.handler(subscription.clone())).status).toBe(
        400,
      );

      const page = heyoStatus({
        database,
        subscribers: { enabled: true, methods: ["webhook"] },
      });
      expect((await page.handler(subscription)).status).toBe(201);
      const incident = await database.createIncident({
        title: "Outage",
        severity: "minor",
        affectedMonitors: [],
        message: "Investigating.",
      });
      await dispatchSubscriberNotifications(page, {
        type: "incident.created",
        incident,
        occurredAt: incident.createdAt,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
      await expect(database.listNotificationLog()).resolves.toMatchObject([
        { status: "failed" },
      ]);
    } finally {
      fetchSpy.mockRestore();
      database.close();
    }
  });

  /** Feeds are public, so they publish a window rather than all history. */
  test("publishes a bounded window of the newest incidents", async () => {
    const database = sqlite(":memory:");
    try {
      const page = heyoStatus({ database, title: "Acme Status" });
      for (let index = 0; index < 60; index += 1) {
        await database.createIncident({
          title: `Incident ${index}`,
          severity: "minor",
          affectedMonitors: [],
          message: "Investigating.",
        });
      }

      const rss = await page.handler(
        new Request("https://status.acme.test/api/heyo-status/rss.xml"),
      );
      const body = await rss.text();
      expect(body.split("<item>").length - 1).toBe(50);

      const atom = await page.handler(
        new Request("https://status.acme.test/api/heyo-status/atom.xml"),
      );
      expect((await atom.text()).split("<entry>").length - 1).toBe(50);
      // The full history is still available to API consumers, which page it.
      await expect(page.database.listIncidents({})).resolves.toHaveLength(60);
    } finally {
      database.close();
    }
  });
});
