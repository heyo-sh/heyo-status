import { heyoStatus } from "@heyo-sh/heyo-status/config";
import { sqlite } from "@heyo-sh/heyo-status/db";
import { slack, webhook } from "@heyo-sh/heyo-status/notifications";

/** Local SQLite adapter with bundled migrations applied automatically. */
const database = sqlite({ file: "./status.sqlite" });

const slackChannel = slack({
  id: "ops-alerts",
  webhookUrl:
    process.env.SLACK_WEBHOOK_URL ?? "https://hooks.slack.com/example",
  channel: "#ops-alerts",
  mentionOnCritical: "@oncall",
  events: ["monitor.down", "monitor.recovered", "incident.created"],
});

const webhookChannel = webhook({
  id: "ops-webhook",
  url: "https://hooks.acme.com/status",
  secret: process.env.WEBHOOK_SECRET ?? "replace-me",
  // Wildcards follow a whole event family, including events added later.
  events: ["monitor.down", "monitor.recovered", "incident.*"],
  headers: { "x-source": "heyo-status" },
});

export const statusPage = heyoStatus({
  database,

  title: "Acme Status",
  description: "Real-time status and uptime for Acme services.",
  siteUrl: "https://status.acme.com",

  // Mount point of the single catch-all route. Every endpoint is served
  // beneath it, for example /api/heyo-status/status.
  basePath: "/api/heyo-status",
  // Bearer token required by /api/heyo-status/admin/*.
  adminToken: process.env.HEYO_STATUS_API_TOKEN,

  theme: "slate",
  colors: {
    primary: "#2563eb",
    secondary: "#eff6ff",
  },
  branding: {
    name: "Acme",
    logo: "/logo.svg",
  },

  monitors: [
    {
      name: "Website",
      description: "Main public website.",
      group: "Frontend",
      type: "http",
      url: "https://acme.com",
      timeoutMs: 15_000,
      softFail: true,
      softFailMs: 2_000,
    },
    {
      name: "API",
      description: "Core REST API.",
      group: "Backend",
      type: "http",
      url: "https://api.acme.com/health",
      expectedBodyIncludes: '"status":"ok"',
    },
    {
      name: "Dashboard",
      description: "User dashboard application.",
      group: "Frontend",
      type: "http",
      url: "https://app.acme.com",
      timeoutMs: 15_000,
    },
    {
      name: "Database",
      description: "Primary database cluster.",
      group: "Infrastructure",
      type: "tcp",
      host: "db.acme.internal",
      port: 5432,
      timeoutMs: 5_000,
      private: true,
    },
    {
      name: "SSL Certificate",
      description: "TLS certificate for acme.com.",
      group: "Security",
      type: "ssl",
      host: "acme.com",
      warnBeforeDays: 14,
    },
    {
      name: "DNS",
      description: "DNS resolution for acme.com.",
      group: "Infrastructure",
      type: "dns",
      host: "acme.com",
    },
    {
      name: "Full Stack Health",
      description: "Aggregate health of the public product surface.",
      group: "Frontend",
      type: "composite",
      monitors: ["Website", "API", "Database"],
      strategy: "all",
    },
  ],

  checks: {
    interval: "*/5 * * * *",
    retentionDays: 90,
    displayDays: 90,
    summaryCron: "10 0 * * *",
    cleanupCron: "0 3 * * *",
  },

  notifications: {
    failureThreshold: 3,
    channels: [slackChannel, webhookChannel],
  },

  incidents: { enabled: true },
  maintenance: { enabled: true },

  metrics: {
    showLatency: true,
    showLatencyChart: true,
    showUptimePercent: true,
    uptimePeriods: ["24h", "7d", "30d", "90d"],
    badges: true,
    prometheus: true,
  },

  subscribers: {
    enabled: true,
    methods: ["email", "rss", "webhook"],
    requireConfirmation: true,
  },

  cache: {
    snapshotTtlMs: 30_000,
  },
});

export default statusPage;
