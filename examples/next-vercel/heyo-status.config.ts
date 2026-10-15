import { heyoStatus } from "@heyo-sh/heyo-status/config";
import { postgres } from "@heyo-sh/heyo-status/deployments/vercel";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const statusPage = heyoStatus({
  database: postgres(drizzle(pool)),
  title: "Acme Status",
  theme: "slate",
  branding: { logo: "/heyo.svg" },
  siteUrl: "https://status.example.com",
  /*
   * A realistic page rather than a single monitor: grouped services, every
   * monitor type the Node runtime supports, and a composite on top. Each one
   * points at a host that is actually reachable, so `bun run example up
   * next-vercel` renders the page the way a working deployment looks instead
   * of a wall of red.
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
    {
      name: "TLS certificate",
      description: "Certificate lifetime for the public hostname.",
      group: "Infrastructure",
      type: "ssl",
      host: "example.com",
      warnBeforeDays: 21,
    },
    {
      name: "Edge network",
      description: "TCP reachability of the public edge.",
      group: "Infrastructure",
      type: "tcp",
      host: "example.com",
      port: 443,
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
