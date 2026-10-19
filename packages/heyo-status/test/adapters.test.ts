import { describe, expect, test } from "bun:test";

import { statusHandler as astroStatusHandler } from "../src/adapters/astro";
import { statusHandler as nextStatusHandler } from "../src/adapters/next";
import { statusHandler as reactRouterStatusHandler } from "../src/adapters/react-router";
import {
  cloudflareCronExpressions,
  cloudflareWorker,
  runCloudflareScheduled,
  runLocalDevCron,
} from "../src/deployments/cloudflare";
import { scheduleStatusPage } from "../src/deployments/node";
import { runVercelCron, vercelCronHandler } from "../src/deployments/vercel";
import type { StatusPage } from "../src/types";

const requests: string[] = [];
const calls: string[] = [];
const page = {
  handler: async (request: Request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response("handled");
  },
  checks: {
    interval: "*/5 * * * *",
    summaryCron: "10 0 * * *",
    cleanupCron: "0 3 * * *",
  },
  cron: {
    runChecks: async () => {
      calls.push("checks");
      return [];
    },
    summarize: async () => {
      calls.push("summarize");
      return { summarizedDays: 0, summarizedResults: 0, deletedResults: 0 };
    },
    cleanup: async () => {
      calls.push("cleanup");
    },
  },
} as unknown as StatusPage;

describe("framework and deployment adapters", () => {
  test("passes every framework request through the status handler", async () => {
    const request = new Request("https://status.example/api/status");
    await expect(nextStatusHandler(page).GET(request)).resolves.toBeInstanceOf(
      Response,
    );
    await expect(
      astroStatusHandler(page).POST({ request }),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      reactRouterStatusHandler(page).action({ request }),
    ).resolves.toBeInstanceOf(Response);
    expect(requests).toEqual([
      "GET /api/status",
      "GET /api/status",
      "GET /api/status",
    ]);
  });

  test("runs only the Cloudflare task associated with the cron expression", async () => {
    calls.length = 0;
    expect(cloudflareCronExpressions(page)).toEqual([
      "*/5 * * * *",
      "10 0 * * *",
      "0 3 * * *",
    ]);
    await expect(
      runCloudflareScheduled(page, {
        cron: "10 0 * * *",
        scheduledTime: Date.UTC(2030, 0, 1),
      }),
    ).resolves.toEqual({ checks: false, summarized: true, cleaned: false });
    expect(calls).toEqual(["summarize"]);

    let scheduled: Promise<unknown> | undefined;
    cloudflareWorker(page).scheduled(
      { cron: "0 3 * * *" },
      {},
      { waitUntil: (promise) => (scheduled = promise) },
    );
    await scheduled;
    expect(calls).toEqual(["summarize", "cleanup"]);
  });

  test("keeps local Cloudflare cron off in production and away from browser requests", async () => {
    calls.length = 0;
    const request = (
      task: string,
      url = "http://127.0.0.1:3000/api/heyo-status/dev-cron/cron",
      headers: Record<string, string> = {},
    ) =>
      new Request(url, {
        method: "POST",
        headers: { "x-heyo-status-dev-cron": task, ...headers },
      });

    expect((await runLocalDevCron(page, request("checks"), false)).status).toBe(
      404,
    );
    expect(
      (
        await runLocalDevCron(
          page,
          request(
            "checks",
            "https://status.example/api/heyo-status/dev-cron/cron",
          ),
          true,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await runLocalDevCron(
          page,
          request("checks", undefined, { origin: "http://localhost" }),
          true,
        )
      ).status,
    ).toBe(403);
    expect((await runLocalDevCron(page, request("unknown"), true)).status).toBe(
      400,
    );
    expect(calls).toEqual([]);

    expect((await runLocalDevCron(page, request("checks"), true)).status).toBe(
      200,
    );
    expect(
      (await runLocalDevCron(page, request("summarize"), true)).status,
    ).toBe(200);
    expect((await runLocalDevCron(page, request("cleanup"), true)).status).toBe(
      200,
    );
    expect(calls).toEqual(["checks", "summarize", "cleanup"]);
  });

  test("provides protected Vercel and node-cron deployment helpers", async () => {
    calls.length = 0;
    const unauthorized = await vercelCronHandler(page, "checks", {
      secret: "cron-secret",
    })(new Request("https://status.example/api/cron"));
    expect(unauthorized.status).toBe(401);

    const authorized = await vercelCronHandler(page, "checks", {
      secret: "cron-secret",
    })(
      new Request("https://status.example/api/cron", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(authorized.status).toBe(200);
    await expect(runVercelCron(page, "cleanup")).resolves.toBeInstanceOf(
      Response,
    );

    const configuredPage = { ...page, cronSecret: "configured-secret" };
    const configured = await vercelCronHandler(
      configuredPage,
      "checks",
    )(
      new Request("https://status.example/api/cron", {
        headers: { authorization: "Bearer configured-secret" },
      }),
    );
    expect(configured.status).toBe(200);

    // An unconfigured secret closes the route even when one is exported.
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "from-environment";
    calls.length = 0;
    try {
      const unconfigured = await vercelCronHandler(
        page,
        "cleanup",
      )(
        new Request("https://status.example/api/cron", {
          headers: { authorization: "Bearer from-environment" },
        }),
      );
      expect(unconfigured.status).toBe(503);
      expect(calls).toEqual([]);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }

    const expressions: string[] = [];
    const scheduler = scheduleStatusPage(page, {
      schedule: (expression, task) => {
        expressions.push(expression);
        void task();
        return { stop() {} };
      },
    });
    scheduler.stop();
    expect(expressions).toEqual(["*/5 * * * *", "10 0 * * *", "0 3 * * *"]);
  });
});
