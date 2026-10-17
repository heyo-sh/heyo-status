import { z } from "zod";

import { defaultStatusBasePath } from "./base-path";
import { createStatusPage } from "./runtime";
import { builtInStatusThemeNames, defaultStatusThemeName } from "./theme/names";
import type {
  JsonValue,
  NotificationChannel,
  StatusDatabaseAdapter,
  StatusEventType,
  StatusPage,
  StatusPageConfig,
  StatusSnapshot,
  UserStatusPageConfig,
} from "./types";

const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const port = z.number().int().min(1).max(65_535);
const cronExpression = nonEmptyString;

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  }, "A URL must use HTTP(S).");

const siteUrlSchema = httpUrl.refine((value) => {
  const url = new URL(value);
  return url.search === "" && url.hash === "";
}, "siteUrl must be an HTTP(S) base URL without a query string or fragment.");

// The catch-all mount point. It is stripped from incoming requests, so it must
// be a plain absolute path: no origin, no query string and no fragment.
const basePathSchema = z
  .string()
  .trim()
  .refine((value) => value.startsWith("/"), 'basePath must start with "/".')
  .refine(
    (value) => !/[?#]/.test(value),
    "basePath cannot contain a query string or fragment.",
  )
  .refine(
    (value) => !value.includes("//"),
    "basePath cannot contain empty segments.",
  )
  .transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => value.length > 0, 'basePath cannot be "/".');

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const commonMonitorSchema = z
  .object({
    name: nonEmptyString,
    description: nonEmptyString.optional(),
    group: nonEmptyString.optional(),
    private: z.boolean().optional(),
  })
  .strict();

const httpMonitorSchema = commonMonitorSchema
  .extend({
    type: z.literal("http"),
    url: httpUrl,
    method: nonEmptyString.default("GET"),
    headers: z.record(z.string(), nonEmptyString).optional(),
    expectedStatus: z
      .array(z.number().int().min(100).max(599))
      .min(1)
      .default([200]),
    expectedResponseHeaders: z.record(z.string(), nonEmptyString).optional(),
    timeoutMs: positiveInteger.default(10_000),
    softFail: z.boolean().default(false),
    softFailMs: positiveInteger.default(500),
    expectedBodyIncludes: z.string().optional(),
    expectedBodyExcludes: z.string().optional(),
    expectedJson: z.record(z.string(), jsonValueSchema).optional(),
    followRedirects: z.boolean().default(true),
  })
  .strict();

const sslMonitorSchema = commonMonitorSchema
  .extend({
    type: z.literal("ssl"),
    host: nonEmptyString,
    port: port.default(443),
    warnBeforeDays: positiveInteger.default(14),
    timeoutMs: positiveInteger.default(10_000),
  })
  .strict();

const tcpMonitorSchema = commonMonitorSchema
  .extend({
    type: z.literal("tcp"),
    host: nonEmptyString,
    port,
    timeoutMs: positiveInteger.default(10_000),
  })
  .strict();

const dnsMonitorSchema = commonMonitorSchema
  .extend({
    type: z.literal("dns"),
    host: nonEmptyString,
    recordType: nonEmptyString.default("A"),
    timeoutMs: positiveInteger.default(10_000),
  })
  .strict();

const compositeMonitorSchema = commonMonitorSchema
  .extend({
    type: z.literal("composite"),
    monitors: z
      .array(nonEmptyString)
      .min(1)
      .refine(
        (monitors) => new Set(monitors).size === monitors.length,
        "A composite monitor cannot list the same component twice.",
      ),
    strategy: z.enum(["all", "any", "majority"]).default("all"),
  })
  .strict();

const monitorSchema = z.discriminatedUnion("type", [
  httpMonitorSchema,
  sslMonitorSchema,
  tcpMonitorSchema,
  dnsMonitorSchema,
  compositeMonitorSchema,
]);

function isStatusDatabaseAdapter(
  value: unknown,
): value is StatusDatabaseAdapter {
  if (!value || typeof value !== "object") return false;

  return [
    "insertCheckResults",
    "getSnapshot",
    "summarizeHistory",
    "cleanup",
    "createIncident",
    "updateIncident",
    "resolveIncident",
    "listIncidents",
    "getIncident",
    "deleteIncident",
    "createMaintenance",
    "listUpcoming",
    "getMaintenance",
    "updateMaintenance",
    "deleteMaintenance",
    "createSubscriber",
    "confirmSubscriber",
    "listSubscribers",
    "deleteSubscriber",
    "recordNotification",
    "listNotificationLog",
  ].every(
    (method) =>
      typeof (value as Record<string, unknown>)[method] === "function",
  );
}

const statusEventTypes = new Set<StatusEventType>([
  "monitor.down",
  "monitor.recovered",
  "ssl.expiring",
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.starting",
  "maintenance.completed",
]);

function isNotificationChannel(value: unknown): value is NotificationChannel {
  if (!value || typeof value !== "object") return false;
  const channel = value as Record<string, unknown>;
  const events = channel.events;

  return (
    typeof channel.id === "string" &&
    channel.id.trim().length > 0 &&
    ["slack", "discord", "webhook", "email"].includes(channel.type as string) &&
    typeof channel.send === "function" &&
    (events === undefined ||
      (Array.isArray(events) &&
        events.length > 0 &&
        events.every(
          (event) =>
            typeof event === "string" &&
            statusEventTypes.has(event as StatusEventType),
        ) &&
        new Set(events).size === events.length))
  );
}

const databaseAdapterSchema = z.custom<StatusDatabaseAdapter>(
  isStatusDatabaseAdapter,
  "database must implement the StatusDatabaseAdapter contract.",
);

const notificationChannelSchema = z.custom<NotificationChannel>(
  isNotificationChannel,
  "Each notification channel must implement the NotificationChannel contract.",
);

const checksSchema = z
  .object({
    interval: cronExpression.default("*/5 * * * *"),
    retentionDays: positiveInteger.default(90),
    displayDays: positiveInteger.default(90),
    summaryCron: cronExpression.default("10 0 * * *"),
    cleanupCron: cronExpression.default("0 3 * * *"),
  })
  .strict()
  .refine(
    (checks) => checks.displayDays <= checks.retentionDays,
    "checks.displayDays cannot exceed checks.retentionDays.",
  );

const configSchema = z
  .object({
    database: databaseAdapterSchema,
    title: z
      .string()
      .trim()
      .min(1, "A status page title cannot be empty.")
      .default("Heyo Status"),
    description: z
      .string()
      .trim()
      .default("Real-time service status and uptime."),
    siteUrl: siteUrlSchema.optional(),
    basePath: basePathSchema.default(defaultStatusBasePath),
    adminToken: nonEmptyString.optional(),
    theme: z.enum(builtInStatusThemeNames).default(defaultStatusThemeName),
    colors: z
      .object({
        primary: nonEmptyString.optional(),
        secondary: nonEmptyString.optional(),
      })
      .strict()
      .default({}),
    mode: z.enum(["system", "light", "dark"]).default("system"),
    branding: z
      .object({
        name: nonEmptyString.optional(),
        logo: nonEmptyString.optional(),
      })
      .strict()
      .default({}),
    monitors: z
      .array(monitorSchema)
      .refine(
        (monitors) =>
          new Set(monitors.map((monitor) => monitor.name)).size ===
          monitors.length,
        "Monitor names must be unique.",
      )
      // Components are resolved from the same run's results, so they must be
      // configured monitors which actually perform a check.
      .superRefine((monitors, context) => {
        const checkedNames = new Set(
          monitors
            .filter((monitor) => monitor.type !== "composite")
            .map((monitor) => monitor.name),
        );
        for (const monitor of monitors) {
          if (monitor.type !== "composite") continue;
          for (const component of monitor.monitors) {
            if (checkedNames.has(component)) continue;
            context.addIssue({
              code: "custom",
              message: `Composite monitor ${JSON.stringify(monitor.name)} references unknown monitor ${JSON.stringify(component)}.`,
            });
          }
        }
      })
      .default([]),
    checks: checksSchema.prefault({}),
    notifications: z
      .object({
        failureThreshold: positiveInteger.default(3),
        channels: z
          .array(notificationChannelSchema)
          .refine(
            (channels) =>
              new Set(channels.map((channel) => channel.id)).size ===
              channels.length,
            "notifications.channels cannot contain duplicate ids.",
          )
          .default([]),
      })
      .strict()
      .prefault({}),
    incidents: z
      .object({ enabled: z.boolean().default(true) })
      .strict()
      .prefault({}),
    maintenance: z
      .object({ enabled: z.boolean().default(true) })
      .strict()
      .prefault({}),
    metrics: z
      .object({
        showLatency: z.boolean().default(true),
        showLatencyChart: z.boolean().default(true),
        showUptimePercent: z.boolean().default(true),
        badges: z.boolean().default(true),
        prometheus: z.boolean().default(false),
        uptimePeriods: z
          .array(z.enum(["24h", "7d", "30d", "90d"]))
          .min(1)
          .refine(
            (periods) => new Set(periods).size === periods.length,
            "metrics.uptimePeriods cannot contain duplicates.",
          )
          .default(["24h", "7d", "30d", "90d"]),
      })
      .strict()
      .prefault({}),
    subscribers: z
      .object({
        enabled: z.boolean().default(false),
        methods: z
          .array(z.enum(["email", "rss", "webhook"]))
          .min(1)
          .refine(
            (methods) => new Set(methods).size === methods.length,
            "subscribers.methods cannot contain duplicates.",
          )
          // Public webhooks can send requests to visitor-supplied hosts. Make
          // that capability an explicit opt-in, not a side effect of enabling
          // subscriptions for email or feeds.
          .default(["email", "rss"]),
        requireConfirmation: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    cache: z
      .object({
        snapshotTtlMs: z.number().int().min(0).max(3_600_000).default(30_000),
      })
      .strict()
      .prefault({}),
    cronSecret: nonEmptyString.optional(),
  })
  .strict();

/** Validates an untrusted status-page configuration and applies stable defaults. */
export function validateStatusPageConfig(
  config: UserStatusPageConfig,
): StatusPageConfig {
  const parsed = configSchema.parse(config);

  return {
    database: parsed.database,
    title: parsed.title,
    description: parsed.description,
    siteUrl: parsed.siteUrl?.replace(/\/$/, ""),
    basePath: parsed.basePath,
    ...(parsed.adminToken ? { adminToken: parsed.adminToken } : {}),
    ...(parsed.cronSecret ? { cronSecret: parsed.cronSecret } : {}),
    theme: parsed.theme,
    colors: parsed.colors,
    mode: parsed.mode,
    branding: {
      ...(parsed.branding.name ? { name: parsed.branding.name } : {}),
      ...(parsed.branding.logo ? { logo: parsed.branding.logo } : {}),
    },
    monitors: parsed.monitors,
    checks: parsed.checks,
    notifications: parsed.notifications,
    incidents: parsed.incidents,
    maintenance: parsed.maintenance,
    metrics: parsed.metrics,
    subscribers: parsed.subscribers,
    cache: parsed.cache,
  };
}

/**
 * Declares a validated status page and attaches its framework-neutral runtime.
 *
 * This is the one entry point a project calls, and it belongs in
 * `heyo-status.config.ts` at the root of the project: the CLI, the generated
 * routes and every documented example load the page from that path.
 */
export function heyoStatus(config: UserStatusPageConfig): StatusPage {
  return createStatusPage(validateStatusPageConfig(config));
}

/** A compile-time-only reference that keeps the public snapshot contract exported. */
export type { StatusSnapshot };
