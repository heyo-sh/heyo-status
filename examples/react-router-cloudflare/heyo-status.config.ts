import { heyoStatus } from "@heyo-sh/heyo-status/config";
import {
  d1,
  type D1Database,
} from "@heyo-sh/heyo-status/deployments/cloudflare";
import type { StatusPage } from "@heyo-sh/heyo-status/types";

export interface Env {
  DB: D1Database;
}

/** Arguments a Worker-hosted React Router route receives from the adapter. */
export interface CloudflareRouteArgs {
  request: Request;
  context: { cloudflare: { env: Env } };
}

export function statusPage(env: Env): StatusPage {
  return heyoStatus({
    database: d1(env.DB),
    title: "Acme Status",
    theme: "onyx",
    siteUrl: "https://status.example.com",
    mode: "system",
    colors: { primary: "#2563eb" },
    branding: { logo: "/heyo.svg" },
    /*
     * A realistic page rather than a single monitor: grouped services and a
     * composite on top, each pointing at a host that is actually reachable,
     * so `bun run example up react-router-cloudflare` renders the page the
     * way a working deployment looks instead of a wall of red.
     *
     * There is no `ssl` or `tcp` monitor here on purpose. Both need
     * `node:tls`/`node:net` at runtime, which a Worker bundle cannot load, so
     * on Cloudflare they report as unavailable — permanently down. `dns` runs
     * over DNS-over-HTTPS and works on every runtime.
     */
    monitors: [
      {
        name: "Website",
        description: "Public marketing site.",
        group: "Web",
        type: "http",
        url: "https://example.com",
        // A 200 can still be served by an error page, so assert the body too.
        expectedBodyIncludes: "Example Domain",
      },
      {
        name: "Dashboard",
        description: "Signed-in customer dashboard.",
        group: "Web",
        type: "http",
        url: "https://example.com/?app=dashboard",
        // Retry once before calling it down, so a single dropped connection
        // does not page anyone.
        softFail: true,
        softFailMs: 1_000,
      },
      {
        name: "API",
        description: "Public REST API.",
        group: "API",
        type: "http",
        url: "https://example.com/?service=api",
      },
      {
        name: "Webhooks",
        description: "Outbound webhook delivery.",
        group: "API",
        type: "http",
        url: "https://example.com/?service=webhooks",
        timeoutMs: 15_000,
      },
      {
        name: "DNS",
        description: "Public A record resolution.",
        group: "Infrastructure",
        type: "dns",
        host: "example.com",
      },
      // Composite monitors run no check of their own; they aggregate the
      // results of the monitors they name. Left ungrouped so it reads as the
      // one line a customer looks at first.
      {
        name: "Platform",
        description: "Everything needed to sign in and get work done.",
        type: "composite",
        monitors: ["Website", "Dashboard", "API"],
        strategy: "all",
      },
    ],
  });
}
