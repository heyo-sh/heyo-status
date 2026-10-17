import { Hono } from "hono";

import { hasBearerToken, readEnvironmentSecret } from "./auth";
import {
  createMonitorBadge,
  createOverallBadge,
  type BadgeMetric,
} from "./badge";
import { createStatusSnapshotCache, type StatusSnapshotCache } from "./cache";
import { createAtomFeed, createRssFeed } from "./feeds";
import { createId } from "./ids";
import { isPublicIncident } from "./incident-visibility";
import { createPrometheusMetrics, prometheusContentType } from "./metrics";
import { dispatchNotifications } from "./notification-dispatcher";
import {
  canSendSubscriberEmail,
  sendSubscriberConfirmation,
} from "./subscribers";
import type {
  CheckResult,
  Incident,
  IncidentListOptions,
  IncidentSeverity,
  IncidentStatus,
  MaintenanceStatus,
  MaintenanceUpdate,
  MonitorSnapshot,
  NotificationDeliveryStatus,
  NotificationLogOptions,
  NewIncident,
  NewMaintenance,
  NewSubscriber,
  StatusPageConfig,
  Subscriber,
  SubscriberType,
  UptimePeriod,
} from "./types";

const incidentStatuses = new Set<IncidentStatus>([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);
const incidentSeverities = new Set<IncidentSeverity>([
  "minor",
  "major",
  "critical",
]);
const notificationDeliveryStatuses = new Set<NotificationDeliveryStatus>([
  "sent",
  "failed",
]);
const subscriberTypes = new Set<SubscriberType>(["email", "webhook"]);
const maintenanceStatuses = new Set<MaintenanceStatus>([
  "scheduled",
  "in-progress",
  "completed",
]);
/**
 * Feeds are public and unauthenticated, so they publish a bounded window of the
 * newest incidents instead of serialising a history that only ever grows.
 */
const feedIncidentLimit = 50;
/**
 * How long a pending email subscription is reused before a new confirmation is
 * sent. Without it, repeating one request mails an address without limit.
 */
const confirmationResendCooldownMs = 15 * 60 * 1000;
const badgeMetrics = new Set<BadgeMetric>(["status", "uptime", "latency"]);
const badgeUptimePeriods = new Set<UptimePeriod>(["24h", "7d", "30d", "90d"]);
const statusEventTypes = new Set([
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

export interface StatusAppOptions {
  /** Shares one snapshot cache with the programmatic API of a status page. */
  snapshots?: StatusSnapshotCache;
  /** Backs `POST /admin/checks/run`; supplied by the status-page runtime. */
  runChecks?: (now?: Date) => Promise<CheckResult[]>;
}

/**
 * Creates the framework-neutral status API, including incident and maintenance
 * management. Mount `StatusPage.handler` rather than duplicating its routes in
 * every framework adapter.
 */
export function createStatusApp(
  config: StatusPageConfig,
  options: StatusAppOptions = {},
): Hono {
  const app = new Hono();
  const snapshots = options.snapshots ?? createStatusSnapshotCache(config);

  // Read routes have nothing to recover from, but the API must answer with one
  // shape. Without this, a database that is unreachable — an unbound Cloudflare
  // binding, a missing DATABASE_URL — returned Hono's plain-text 500 and threw
  // the actionable message away.
  app.onError((error, context) => apiError(context, error));

  app.get("/status", async (context) => {
    return context.json(await snapshots.get());
  });

  // A deliberately small payload for embeds and uptime widgets, so consumers
  // never have to download the full day grid to render an overall state.
  app.get("/status/summary", async (context) => {
    const snapshot = await snapshots.get();
    return context.json({
      generatedAt: snapshot.generatedAt,
      overall: snapshot.overall,
      hasConfig: snapshot.hasConfig,
      hasData: snapshot.hasData,
      activeIncidents: snapshot.activeIncidents.length,
      scheduledMaintenances: snapshot.scheduledMaintenances.length,
      groups: snapshot.groups,
      monitors: snapshot.monitors.map((monitor) => ({
        name: monitor.name,
        type: monitor.type,
        ...(monitor.group ? { group: monitor.group } : {}),
        latestStatus: monitor.latestStatus,
        latestCheckedAt: monitor.latestCheckedAt,
        latestLatencyMs: monitor.latestLatencyMs,
        uptimePercent: monitor.uptimePercent,
      })),
    });
  });

  app.get("/monitors", async (context) => {
    const snapshot = await snapshots.get();
    return context.json(snapshot.monitors);
  });

  app.get("/monitors/:name", async (context) => {
    const monitor = await findMonitor(context.req.param("name"));
    return monitor
      ? context.json(monitor)
      : context.json({ error: "Monitor not found." }, 404);
  });

  app.get("/monitors/:name/uptime", async (context) => {
    const monitor = await findMonitor(context.req.param("name"));
    if (!monitor) return context.json({ error: "Monitor not found." }, 404);
    return context.json({
      name: monitor.name,
      "24h": monitor.uptimePercent24h,
      "7d": monitor.uptimePercent7d,
      "30d": monitor.uptimePercent30d,
      "90d": monitor.uptimePercent90d,
      // Uptime across the configured window, which is not always 90 days.
      window: monitor.uptimePercent,
      displayDays: config.checks.displayDays,
      avgLatencyMs: monitor.avgLatencyMs,
    });
  });

  app.get("/badge/:file", async (context) => {
    if (!config.metrics.badges) return featureDisabled(context);
    const file = context.req.param("file");
    if (!file.toLowerCase().endsWith(".svg")) {
      return context.json({ error: "Badges are served as .svg." }, 404);
    }

    try {
      const name = readBadgeName(file.slice(0, -4));
      const query = context.req.query();
      const badgeOptions = {
        ...(query.label ? { label: query.label } : {}),
        ...(query.metric ? { metric: readBadgeMetric(query.metric) } : {}),
        ...(query.period
          ? { period: readBadgeUptimePeriod(query.period) }
          : {}),
      };
      const snapshot = await snapshots.get();
      const monitor = snapshot.monitors.find(
        (candidate) => candidate.name === name,
      );
      if (!monitor && name !== "overall") {
        return context.json({ error: "Monitor not found." }, 404);
      }

      return svgResponse(
        monitor
          ? createMonitorBadge(monitor, badgeOptions)
          : createOverallBadge(snapshot, badgeOptions),
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  if (config.metrics.prometheus) {
    app.get("/metrics", async () => {
      return new Response(createPrometheusMetrics(await snapshots.get()), {
        headers: { "content-type": prometheusContentType },
      });
    });
  }

  app.get("/rss.xml", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      const incidents = await listPublicIncidents(config, {
        limit: feedIncidentLimit,
      });
      return xmlResponse(
        createRssFeed(config, incidents, new URL(context.req.url).origin),
        "application/rss+xml; charset=utf-8",
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.get("/atom.xml", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      const incidents = await listPublicIncidents(config, {
        limit: feedIncidentLimit,
      });
      return xmlResponse(
        createAtomFeed(config, incidents, new URL(context.req.url).origin),
        "application/atom+xml; charset=utf-8",
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.post("/subscribers", async (context) => {
    if (!config.subscribers.enabled) return featureDisabled(context);
    try {
      const input = readNewSubscriber(await readJson(context), config);
      const requiresConfirmation =
        input.type === "email" && config.subscribers.requireConfirmation;
      if (requiresConfirmation && !canSendSubscriberEmail(config)) {
        throw new ApiDeliveryError(
          "Email subscriptions require a configured email notification channel.",
        );
      }

      // A subscription is identified by its destination, so repeating the
      // request is idempotent. Without this, one address could be signed up any
      // number of times, which both mailed it on every retry and then delivered
      // every future incident once per duplicate row.
      const existing = await findSubscription(config, input);
      if (existing) {
        const pendingSince = Date.now() - existing.createdAt.getTime();
        if (existing.confirmed || pendingSince < confirmationResendCooldownMs) {
          // Anyone can submit someone else's destination. Never reveal the
          // subscription ID (an unsubscribe capability) or confirmation state.
          return publicSubscriptionResponse(context, requiresConfirmation);
        }
        // The cooldown has passed, so the first mail was probably lost. Replace
        // the pending row to issue a single-use token that is still valid.
        await config.database.deleteSubscriber(existing.id).catch(() => false);
      }

      const confirmationToken = requiresConfirmation
        ? createConfirmationToken()
        : null;
      let subscriber: Subscriber;
      try {
        subscriber = await config.database.createSubscriber({
          ...input,
          confirmed: !requiresConfirmation,
          confirmToken: confirmationToken,
        });
      } catch (error) {
        // Two concurrent requests pass the check above together; the unique
        // index settles which one wins. The loser reports the winner's
        // subscription rather than an error the visitor cannot act on.
        const winner = await findSubscription(config, input);
        if (!winner) throw error;
        return publicSubscriptionResponse(context, requiresConfirmation);
      }

      if (confirmationToken) {
        try {
          await sendSubscriberConfirmation(
            config,
            subscriber,
            confirmationUrl(config, context.req.url, confirmationToken),
          );
        } catch (error) {
          await config.database
            .deleteSubscriber(subscriber.id)
            .catch(() => false);
          throw new ApiDeliveryError(
            error instanceof Error
              ? error.message
              : "Unable to send subscription confirmation email.",
          );
        }
      }

      return publicSubscriptionResponse(context, requiresConfirmation);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.get("/subscribers/confirm", async (context) => {
    if (!config.subscribers.enabled) return featureDisabled(context);
    try {
      const token = context.req.query()["token"];
      if (!token) {
        throw new ApiInputError("token is required.");
      }
      const subscriber = await config.database.confirmSubscriber(token);
      context.header("Cache-Control", "no-store");
      context.header("Referrer-Policy", "no-referrer");
      return subscriber
        ? context.json(subscriber)
        : context.json(
            { error: "Confirmation token is invalid or expired." },
            404,
          );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.delete("/subscribers/:id", async (context) => {
    if (!config.subscribers.enabled) return featureDisabled(context);
    try {
      const removed = await config.database.deleteSubscriber(
        context.req.param("id"),
      );
      return removed
        ? new Response(null, { status: 204 })
        : context.json({ error: "Subscriber not found." }, 404);
    } catch (error) {
      return apiError(context, error);
    }
  });

  // The human-facing half of DELETE /subscribers/:id. A mail client cannot
  // issue a DELETE, and a link that unsubscribes on GET would fire whenever a
  // mail scanner prefetches it, so the link opens a page with a confirm form.
  app.get("/subscribers/:id/unsubscribe", (context) => {
    if (!config.subscribers.enabled) return featureDisabled(context);
    return htmlResponse(
      unsubscribePage(config, {
        heading: `Unsubscribe from ${config.title}`,
        body: "You will stop receiving incident and maintenance updates.",
        confirmId: context.req.param("id"),
      }),
    );
  });

  app.post("/subscribers/:id/unsubscribe", async (context) => {
    if (!config.subscribers.enabled) return featureDisabled(context);
    try {
      const removed = await config.database.deleteSubscriber(
        context.req.param("id"),
      );
      return htmlResponse(
        unsubscribePage(config, {
          heading: removed ? "You are unsubscribed" : "Subscription not found",
          body: removed
            ? `You will no longer receive updates from ${config.title}.`
            : "This subscription has already been removed.",
        }),
        removed ? 200 : 404,
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.get("/incidents", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      return context.json(
        await listPublicIncidents(
          config,
          readIncidentListOptions(context.req.query()),
        ),
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.get("/incidents/:id", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    const incident = await config.database.getIncident(context.req.param("id"));
    return incident && isPublicIncident(config, incident)
      ? context.json(incident)
      : context.json({ error: "Incident not found." }, 404);
  });

  app.get("/maintenance", async (context) => {
    if (!config.maintenance.enabled) return featureDisabled(context);
    return context.json(await config.database.listUpcoming());
  });

  // Every mutation lives behind one authenticated prefix so a public status
  // page can never be edited by its visitors.
  app.use("/admin/*", adminAuth(config));

  app.post("/admin/checks/run", async (context) => {
    if (!options.runChecks) {
      return context.json(
        { error: "Manual checks require the status-page runtime." },
        501,
      );
    }
    try {
      const results = await options.runChecks();
      return context.json(results);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.post("/admin/incidents", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      const input = readNewIncident(await readJson(context));
      const incident = await config.database.createIncident(input);
      snapshots.invalidate();
      await dispatchNotifications(config, {
        type: "incident.created",
        occurredAt: incident.createdAt,
        incident,
      });
      return context.json(incident, 201);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.post("/admin/incidents/:id/updates", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      const id = context.req.param("id");
      if (!(await config.database.getIncident(id))) {
        return context.json({ error: "Incident not found." }, 404);
      }
      const body = await readJson(context);
      const status = readIncidentStatus(body.status, "status");
      const severity =
        body.severity === undefined
          ? undefined
          : readIncidentSeverity(body.severity, "severity");
      const incident = await config.database.updateIncident(id, {
        id: createId("upd"),
        status,
        ...(severity ? { severity } : {}),
        message: readText(body.message, "message"),
        createdAt: new Date(),
      });
      snapshots.invalidate();
      await dispatchNotifications(config, {
        type: status === "resolved" ? "incident.resolved" : "incident.updated",
        occurredAt: new Date(),
        incident,
      });
      return context.json(incident);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.patch("/admin/incidents/:id", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    try {
      const id = context.req.param("id");
      const current = await config.database.getIncident(id);
      if (!current) return context.json({ error: "Incident not found." }, 404);

      const body = await readJson(context);
      const status =
        body.status === undefined
          ? current.status
          : readIncidentStatus(body.status, "status");
      const severity =
        body.severity === undefined
          ? current.severity
          : readIncidentSeverity(body.severity, "severity");
      const message =
        body.message === undefined
          ? "Incident details updated."
          : readText(body.message, "message");

      const incident = await config.database.updateIncident(id, {
        id: createId("upd"),
        status,
        severity,
        message,
        createdAt: new Date(),
      });
      snapshots.invalidate();
      await dispatchNotifications(config, {
        type: status === "resolved" ? "incident.resolved" : "incident.updated",
        occurredAt: new Date(),
        incident,
      });
      return context.json(incident);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.delete("/admin/incidents/:id", async (context) => {
    if (!config.incidents.enabled) return featureDisabled(context);
    const id = context.req.param("id");
    if (!(await config.database.getIncident(id))) {
      return context.json({ error: "Incident not found." }, 404);
    }
    await config.database.deleteIncident(id);
    snapshots.invalidate();
    return new Response(null, { status: 204 });
  });

  app.post("/admin/maintenance", async (context) => {
    if (!config.maintenance.enabled) return featureDisabled(context);
    try {
      const maintenance = await config.database.createMaintenance(
        readNewMaintenance(await readJson(context)),
      );
      snapshots.invalidate();
      await dispatchNotifications(config, {
        type:
          maintenance.status === "in-progress"
            ? "maintenance.starting"
            : maintenance.status === "completed"
              ? "maintenance.completed"
              : "maintenance.scheduled",
        occurredAt: maintenance.createdAt,
        maintenance,
      });
      return context.json(maintenance, 201);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.patch("/admin/maintenance/:id", async (context) => {
    if (!config.maintenance.enabled) return featureDisabled(context);
    try {
      const id = context.req.param("id");
      if (!(await config.database.getMaintenance(id))) {
        return context.json({ error: "Maintenance window not found." }, 404);
      }
      const maintenance = await config.database.updateMaintenance(
        id,
        readMaintenanceUpdate(await readJson(context)),
      );
      snapshots.invalidate();
      await dispatchNotifications(config, {
        type:
          maintenance.status === "in-progress"
            ? "maintenance.starting"
            : maintenance.status === "completed"
              ? "maintenance.completed"
              : "maintenance.scheduled",
        occurredAt: new Date(),
        maintenance,
      });
      return context.json(maintenance);
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.delete("/admin/maintenance/:id", async (context) => {
    if (!config.maintenance.enabled) return featureDisabled(context);
    const id = context.req.param("id");
    if (!(await config.database.getMaintenance(id))) {
      return context.json({ error: "Maintenance window not found." }, 404);
    }
    await config.database.deleteMaintenance(id);
    snapshots.invalidate();
    return new Response(null, { status: 204 });
  });

  app.get("/admin/notifications/log", async (context) => {
    try {
      return context.json(
        await config.database.listNotificationLog(
          readNotificationLogOptions(context.req.query()),
        ),
      );
    } catch (error) {
      return apiError(context, error);
    }
  });

  app.get("/healthz", (context) => context.json({ ok: true }));

  return app;

  async function findMonitor(name: string): Promise<MonitorSnapshot | null> {
    const snapshot = await snapshots.get();
    return (
      snapshot.monitors.find((candidate) => candidate.name === name) ?? null
    );
  }
}

function publicSubscriptionResponse(
  context: { json: (body: unknown, status: 201 | 202) => Response },
  requiresConfirmation: boolean,
): Response {
  return context.json(
    { status: requiresConfirmation ? "pending" : "subscribed" },
    requiresConfirmation ? 202 : 201,
  );
}

/** Looks up the single subscription that owns a destination, if it exists. */
async function findSubscription(
  config: StatusPageConfig,
  input: NewSubscriber,
): Promise<Subscriber | undefined> {
  const subscribers = await config.database.listSubscribers({
    type: input.type,
  });
  return subscribers.find((subscriber) => subscriber.target === input.target);
}

/**
 * Requires `Authorization: Bearer <token>`. The token comes from configuration
 * or `HEYO_STATUS_API_TOKEN`; without one the management API stays closed
 * rather than silently public.
 */
function adminAuth(config: StatusPageConfig) {
  return async (
    context: {
      req: { header(name: string): string | undefined };
      json: (body: unknown, status: 401 | 503) => Response;
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    // Workers and Deno do not always expose process.env; treat it as optional.
    const token =
      config.adminToken ?? readEnvironmentSecret("HEYO_STATUS_API_TOKEN");
    if (!token) {
      return context.json(
        {
          error:
            "The management API is disabled. Set adminToken or HEYO_STATUS_API_TOKEN.",
        },
        503,
      );
    }

    if (!hasBearerToken(context.req.header("authorization"), token)) {
      return context.json({ error: "Unauthorized." }, 401);
    }
    await next();
  };
}

async function readJson(context: {
  req: { json(): Promise<unknown> };
}): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await context.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiInputError("Request body must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiInputError) throw error;
    throw new ApiInputError("Request body must be valid JSON.");
  }
}

function readNewIncident(body: Record<string, unknown>): NewIncident {
  const status =
    body.status === undefined
      ? undefined
      : readIncidentStatus(body.status, "status");
  if (status === "resolved") {
    throw new ApiInputError("A new incident cannot be created as resolved.");
  }
  return {
    title: readText(body.title, "title"),
    severity: readIncidentSeverity(body.severity, "severity"),
    affectedMonitors: readStringArray(
      body.affectedMonitors,
      "affectedMonitors",
    ),
    message: readText(body.message, "message"),
    ...(status ? { status } : {}),
  };
}

function readNewMaintenance(body: Record<string, unknown>): NewMaintenance {
  const scheduledStart = readDate(body.scheduledStart, "scheduledStart");
  const scheduledEnd = readDate(body.scheduledEnd, "scheduledEnd");
  if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
    throw new ApiInputError("scheduledEnd must be after scheduledStart.");
  }
  return {
    title: readText(body.title, "title"),
    ...(body.description === undefined
      ? {}
      : { description: readText(body.description, "description") }),
    affectedMonitors: readStringArray(
      body.affectedMonitors,
      "affectedMonitors",
    ),
    scheduledStart,
    scheduledEnd,
  };
}

function readMaintenanceUpdate(
  body: Record<string, unknown>,
): MaintenanceUpdate {
  const update: MaintenanceUpdate = {
    ...(body.title === undefined
      ? {}
      : { title: readText(body.title, "title") }),
    ...(body.description === undefined
      ? {}
      : { description: readText(body.description, "description") }),
    ...(body.affectedMonitors === undefined
      ? {}
      : {
          affectedMonitors: readStringArray(
            body.affectedMonitors,
            "affectedMonitors",
          ),
        }),
    ...(body.scheduledStart === undefined
      ? {}
      : { scheduledStart: readDate(body.scheduledStart, "scheduledStart") }),
    ...(body.scheduledEnd === undefined
      ? {}
      : { scheduledEnd: readDate(body.scheduledEnd, "scheduledEnd") }),
    ...(body.status === undefined
      ? {}
      : { status: readMaintenanceStatus(body.status) }),
  };
  if (Object.keys(update).length === 0) {
    throw new ApiInputError("At least one field must be provided.");
  }
  if (
    update.scheduledStart &&
    update.scheduledEnd &&
    update.scheduledEnd.getTime() <= update.scheduledStart.getTime()
  ) {
    throw new ApiInputError("scheduledEnd must be after scheduledStart.");
  }
  return update;
}

function readMaintenanceStatus(value: unknown): MaintenanceStatus {
  if (
    typeof value !== "string" ||
    !maintenanceStatuses.has(value as MaintenanceStatus)
  ) {
    throw new ApiInputError(
      "status must be scheduled, in-progress or completed.",
    );
  }
  return value as MaintenanceStatus;
}

function readNewSubscriber(
  body: Record<string, unknown>,
  config: StatusPageConfig,
): NewSubscriber {
  const type = readSubscriberType(body.type, "type");
  if (!config.subscribers.methods.includes(type)) {
    throw new ApiInputError(`The ${type} subscription method is disabled.`);
  }
  const target = readSubscriberTarget(type, body.target);
  return {
    type,
    target,
    ...(body.monitors === undefined
      ? {}
      : { monitors: readSubscriberMonitors(body.monitors) }),
  };
}

function readNotificationLogOptions(
  query: Record<string, string | undefined>,
): NotificationLogOptions {
  return {
    ...(query.channelId ? { channelId: query.channelId } : {}),
    ...(query.eventType
      ? {
          eventType: readCsv(query.eventType, readStatusEventType, "eventType"),
        }
      : {}),
    ...(query.status
      ? {
          status: readCsv(
            query.status,
            readNotificationDeliveryStatus,
            "status",
          ),
        }
      : {}),
    ...(query.limit ? { limit: readNonNegativeInt(query.limit, "limit") } : {}),
    ...(query.offset
      ? { offset: readNonNegativeInt(query.offset, "offset") }
      : {}),
  };
}

// Filter before pagination so hidden legacy incidents neither leak nor occupy
// slots in the public list or the newest-50 feeds. Database access for admins
// and the CLI remains unchanged.
async function listPublicIncidents(
  config: StatusPageConfig,
  options: IncidentListOptions,
): Promise<Incident[]> {
  if (!config.monitors.some((monitor) => monitor.private)) {
    return config.database.listIncidents(options);
  }

  const { limit, offset = 0, ...filters } = options;
  if (limit === undefined) {
    const incidents = await config.database.listIncidents(filters);
    return incidents
      .filter((incident) => isPublicIncident(config, incident))
      .slice(offset);
  }
  if (limit === 0) return [];

  const pageSize = Math.max(50, Math.min(limit, 100));
  const visible: Incident[] = [];
  let skipped = 0;
  let databaseOffset = 0;
  while (visible.length < limit) {
    const batch = await config.database.listIncidents({
      ...filters,
      limit: pageSize,
      offset: databaseOffset,
    });
    for (const incident of batch) {
      if (!isPublicIncident(config, incident)) continue;
      if (skipped < offset) skipped += 1;
      else visible.push(incident);
      if (visible.length === limit) return visible;
    }
    databaseOffset += batch.length;
    if (batch.length < pageSize) break;
  }
  return visible;
}

function readIncidentListOptions(
  query: Record<string, string | undefined>,
): IncidentListOptions {
  return {
    ...(query.status
      ? { status: readCsv(query.status, readIncidentStatus, "status") }
      : {}),
    ...(query.severity
      ? { severity: readCsv(query.severity, readIncidentSeverity, "severity") }
      : {}),
    ...(query.from ? { from: readDate(query.from, "from") } : {}),
    ...(query.to ? { to: readDate(query.to, "to") } : {}),
    ...(query.limit ? { limit: readNonNegativeInt(query.limit, "limit") } : {}),
    ...(query.offset
      ? { offset: readNonNegativeInt(query.offset, "offset") }
      : {}),
  };
}

function readCsv<T extends string>(
  value: string,
  parser: (value: unknown, name: string) => T,
  name: string,
): T[] {
  const items = value.split(",").filter(Boolean);
  if (items.length === 0) throw new ApiInputError(`${name} cannot be empty.`);
  return items.map((item) => parser(item, name));
}

function readText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiInputError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function readStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ApiInputError(`${name} must be an array of strings.`);
  }
  const values = value.map((item) => item.trim());
  if (values.some((item) => !item)) {
    throw new ApiInputError(`${name} cannot contain empty names.`);
  }
  return [...new Set(values)];
}

function readSubscriberMonitors(value: unknown): string[] | null {
  if (value === null) return null;
  return readStringArray(value, "monitors");
}

function readBadgeName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiInputError("The badge name is not valid percent-encoding.");
  }
}

function readBadgeMetric(value: string): BadgeMetric {
  if (!badgeMetrics.has(value as BadgeMetric)) {
    throw new ApiInputError("metric must be status, uptime or latency.");
  }
  return value as BadgeMetric;
}

function readBadgeUptimePeriod(value: string): UptimePeriod {
  if (!badgeUptimePeriods.has(value as UptimePeriod)) {
    throw new ApiInputError("period must be 24h, 7d, 30d or 90d.");
  }
  return value as UptimePeriod;
}

function readSubscriberType(value: unknown, name: string): SubscriberType {
  if (
    typeof value !== "string" ||
    !subscriberTypes.has(value as SubscriberType)
  ) {
    throw new ApiInputError(`${name} must be email or webhook.`);
  }
  return value as SubscriberType;
}

function readSubscriberTarget(type: SubscriberType, value: unknown): string {
  const target = readText(value, "target");
  if (type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      throw new ApiInputError("target must be a valid email address.");
    }
    return target;
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ApiInputError("target must be an HTTP(S) webhook URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiInputError("target must be an HTTP(S) webhook URL.");
  }
  if (!isPubliclyRoutableHost(url.hostname)) {
    throw new ApiInputError(
      "target must be a public host. Loopback, private and link-local addresses are rejected.",
    );
  }
  // Credentials would be stored in clear text and replayed on every delivery.
  if (url.username || url.password) {
    throw new ApiInputError("target cannot contain credentials.");
  }
  return url.toString();
}

/**
 * Rejects destinations that only exist inside the deployment's network.
 *
 * Public subscriptions turn the status page into an HTTP client controlled by
 * an anonymous visitor, so a webhook pointing at `127.0.0.1`, a private range
 * or the cloud metadata address (169.254.169.254) would make it a
 * request-forgery proxy. This filters literals; it cannot see through DNS, so
 * a network egress policy is still the durable control.
 */
function isPubliclyRoutableHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  if (host.startsWith("[") && host.endsWith("]")) {
    return isPublicIpv6(host.slice(1, -1));
  }
  if (host.includes(":")) return isPublicIpv6(host);

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) return isPublicIpv4(ipv4.slice(1).map(Number));

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // Names a public resolver never answers, reserved by RFC 6761/8375 and by
  // the container and cloud platforms that use them for internal services.
  return ![".local", ".internal", ".home.arpa", ".localdomain"].some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
}

function isPublicIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return false;
  }
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a >= 224) return false; // multicast, reserved and broadcast
  return true;
}

function isPublicIpv6(address: string): boolean {
  const host = address.split("%")[0]?.toLowerCase() ?? "";
  if (host === "::1" || host === "::") return false;
  // IPv4-mapped addresses inherit the IPv4 rules above. `URL` rewrites the
  // dotted form to hex, so `::ffff:127.0.0.1` arrives as `::ffff:7f00:1`.
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted) return isPublicIpv4(dotted[1]!.split(".").map(Number));
  const hex = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(host);
  if (hex) {
    const high = Number.parseInt(hex[1]!, 16);
    const low = Number.parseInt(hex[2]!, 16);
    return isPublicIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  if (/^f[cd]/.test(host)) return false; // unique local
  if (/^fe[89ab]/.test(host)) return false; // link-local
  if (/^ff/.test(host)) return false; // multicast
  return true;
}

function readStatusEventType(
  value: unknown,
  name: string,
): import("./types").StatusEventType {
  if (typeof value !== "string" || !statusEventTypes.has(value)) {
    throw new ApiInputError(`${name} must be a valid notification event type.`);
  }
  return value as import("./types").StatusEventType;
}

function readNotificationDeliveryStatus(
  value: unknown,
  name: string,
): NotificationDeliveryStatus {
  if (
    typeof value !== "string" ||
    !notificationDeliveryStatuses.has(value as NotificationDeliveryStatus)
  ) {
    throw new ApiInputError(`${name} must be sent or failed.`);
  }
  return value as NotificationDeliveryStatus;
}

function readIncidentStatus(value: unknown, name: string): IncidentStatus {
  if (
    typeof value !== "string" ||
    !incidentStatuses.has(value as IncidentStatus)
  ) {
    throw new ApiInputError(`${name} must be a valid incident status.`);
  }
  return value as IncidentStatus;
}

function readIncidentSeverity(value: unknown, name: string): IncidentSeverity {
  if (
    typeof value !== "string" ||
    !incidentSeverities.has(value as IncidentSeverity)
  ) {
    throw new ApiInputError(`${name} must be a valid incident severity.`);
  }
  return value as IncidentSeverity;
}

function readDate(value: unknown, name: string): Date {
  if (typeof value !== "string") {
    throw new ApiInputError(`${name} must be an ISO-8601 timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiInputError(`${name} must be an ISO-8601 timestamp.`);
  }
  return date;
}

function readNonNegativeInt(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ApiInputError(`${name} must be a non-negative integer.`);
  }
  return number;
}

function featureDisabled(context: {
  json: (body: unknown, status: 404) => Response;
}): Response {
  return context.json({ error: "This feature is disabled." }, 404);
}

function apiError(
  context: { json: (body: unknown, status: 400 | 500 | 503) => Response },
  error: unknown,
): Response {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return context.json(
    { error: message },
    error instanceof ApiInputError
      ? 400
      : error instanceof ApiDeliveryError
        ? 503
        : 500,
  );
}

function xmlResponse(body: string, contentType: string): Response {
  return new Response(body, { headers: { "content-type": contentType } });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Unsubscribe pages carry a subscription id; keep them out of caches.
      "cache-control": "no-store",
    },
  });
}

/** A self-contained page, so unsubscribing never depends on the app's assets. */
function unsubscribePage(
  config: StatusPageConfig,
  page: { heading: string; body: string; confirmId?: string },
): string {
  const form = page.confirmId
    ? `<form method="post" action="${escapeHtml(`${config.basePath}/subscribers/${encodeURIComponent(page.confirmId)}/unsubscribe`)}"><button type="submit">Unsubscribe</button></form>`
    : "";
  const back = config.siteUrl
    ? `<p><a href="${escapeHtml(config.siteUrl)}">Back to ${escapeHtml(config.title)}</a></p>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(page.heading)}</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#111827}main{max-width:32rem;padding:2rem;text-align:center}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.375rem;background:#111827;color:#fff;cursor:pointer}</style></head><body><main><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.body)}</p>${form}${back}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function svgResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Badges are embedded in third-party READMEs; a short cache keeps them
      // fresh without turning every page view into a database read.
      "cache-control": "public, max-age=60",
    },
  });
}

function confirmationUrl(
  config: StatusPageConfig,
  requestUrl: string,
  token: string,
): string {
  const base = config.siteUrl ?? new URL(requestUrl).origin;
  const url = new URL(`${base}${config.basePath}/subscribers/confirm`);
  url.searchParams.set("token", token);
  return url.toString();
}

function createConfirmationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class ApiInputError extends Error {}
class ApiDeliveryError extends Error {}
