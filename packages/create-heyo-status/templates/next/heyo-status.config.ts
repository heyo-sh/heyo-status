import { heyoStatus } from "@heyo-sh/heyo-status/config";

// DATABASE_SETUP

export const statusPage = heyoStatus({
  database,
  title: "{{PROJECT_TITLE}} Status",
  description: "Real-time status for {{PROJECT_TITLE}} services.",
  theme: "{{THEME}}",
  // Replace the bundled Heyo mark with your own, or add `name` beside it.
  branding: { logo: "/heyo.svg" },
  // Set this before deployment to publish canonical RSS and social URLs.
  // siteUrl: "https://status.example.com",
  /*
   * Replace these with your own services. They point at example.com so the
   * very first check renders a page that looks the way a working one does —
   * grouped services, a body assertion, a soft retry and a composite — rather
   * than a single row with nothing to compare it to.
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
    // Composite monitors aggregate other monitors instead of running a check.
    // Left ungrouped so it reads as the one line a visitor looks at first.
    {
      name: "Platform",
      description: "Everything needed to sign in and get work done.",
      type: "composite",
      monitors: ["Website", "Dashboard", "API"],
      strategy: "all",
    },
    // `ssl` and `tcp` monitors need node:tls/node:net, so they run on Node and
    // Bun but report as unavailable on Cloudflare Workers. `private: true`
    // keeps a monitor checked but out of the public snapshot.
    // { name: "TLS certificate", type: "ssl", host: "example.com", warnBeforeDays: 21 },
    // { name: "Database", type: "tcp", host: "db.internal", port: 5432, private: true },
  ],
  checks: {
    interval: "*/5 * * * *",
    retentionDays: 90,
    displayDays: 90,
  },
  notifications: { failureThreshold: 3, channels: [] },
  // Every endpoint is served by the catch-all route under basePath, for
  // example /api/heyo-status/badge/:monitor.svg. Set prometheus: true to also
  // expose /api/heyo-status/metrics.
  metrics: { badges: true, prometheus: false },
  // Required by the /api/heyo-status/admin/* management endpoints. Without a
  // token they stay closed, so a public status page can never be edited.
  // Uncomment and supply a secret to enable management routes.
  // adminToken: "replace-with-a-secret",
  // For Vercel cron, use the same secret as the CRON_SECRET in Vercel settings.
  // cronSecret: "replace-with-a-secret",
});

export default statusPage;
