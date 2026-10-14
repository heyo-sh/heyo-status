import { toStatusEventPayload } from "./notifications";
import type {
  NotificationChannel,
  StatusEvent,
  StatusPageConfig,
  Subscriber,
  SubscriberEmailMessage,
} from "./types";

const subscriberEventTypes = new Set([
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.starting",
  "maintenance.completed",
]);

/** True when an email channel can send mail to a public subscription address. */
export function canSendSubscriberEmail(config: StatusPageConfig): boolean {
  return findSubscriberEmailChannel(config) !== undefined;
}

/** Sends the double-opt-in message through the first configured email transport. */
export async function sendSubscriberConfirmation(
  config: StatusPageConfig,
  subscriber: Subscriber,
  confirmationUrl: string,
): Promise<void> {
  const channel = findSubscriberEmailChannel(config);
  if (!channel?.sendEmail) {
    throw new Error(
      "Email subscriptions require a configured email notification channel.",
    );
  }
  if (subscriber.type !== "email") {
    throw new Error("Only email subscriptions can be confirmed by email.");
  }

  await channel.sendEmail({
    to: [subscriber.target],
    subject: `Confirm your subscription to ${config.title}`,
    text: [
      `Confirm your subscription to ${config.title}.`,
      "",
      `Open this link to receive incident and maintenance updates: ${confirmationUrl}`,
    ].join("\n"),
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5"><h2>Confirm your subscription</h2><p>Confirm your subscription to ${escapeHtml(config.title)}.</p><p><a href="${escapeAttribute(confirmationUrl)}">Confirm subscription</a></p></body></html>`,
  });
}

/**
 * Delivers incident and maintenance events to confirmed public subscribers.
 * Failures are isolated per destination, just like configured channels.
 */
export async function dispatchSubscriberNotifications(
  config: StatusPageConfig,
  event: StatusEvent,
): Promise<void> {
  if (
    !config.subscribers.enabled ||
    !subscriberEventTypes.has(event.type) ||
    !config.subscribers.methods.some((method) => method !== "rss")
  ) {
    return;
  }

  let subscribers: Subscriber[];
  try {
    subscribers = await config.database.listSubscribers({ confirmed: true });
  } catch {
    // Public subscriptions must never make an incident update fail.
    return;
  }

  for (const subscriber of subscribers) {
    if (
      !config.subscribers.methods.includes(subscriber.type) ||
      !subscriberWantsEvent(subscriber, event)
    ) {
      continue;
    }

    try {
      if (subscriber.type === "email") {
        const channel = findSubscriberEmailChannel(config);
        if (!channel?.sendEmail) {
          throw new Error(
            "No configured email channel can deliver subscriber notifications.",
          );
        }
        await channel.sendEmail(
          createSubscriberEventEmail(config, subscriber, event),
        );
      } else {
        await sendSubscriberWebhook(subscriber, event);
      }
      await recordSubscriberDelivery(config, subscriber, event, "sent", null);
    } catch (error) {
      await recordSubscriberDelivery(
        config,
        subscriber,
        event,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function findSubscriberEmailChannel(
  config: StatusPageConfig,
): NotificationChannel | undefined {
  return config.notifications.channels.find(
    (channel) =>
      channel.type === "email" && typeof channel.sendEmail === "function",
  );
}

function subscriberWantsEvent(
  subscriber: Subscriber,
  event: StatusEvent,
): boolean {
  if (subscriber.monitors === null || subscriber.monitors.length === 0) {
    return true;
  }
  const affected = event.monitor
    ? [event.monitor.name]
    : (event.incident?.affectedMonitors ??
      event.maintenance?.affectedMonitors ??
      []);
  return (
    affected.length === 0 ||
    affected.some((name) => subscriber.monitors?.includes(name))
  );
}

function createSubscriberEventEmail(
  config: StatusPageConfig,
  subscriber: Subscriber,
  event: StatusEvent,
): SubscriberEmailMessage {
  const subject = `[${event.page?.title ?? config.title}] ${eventTitle(event)}`;
  const description = eventDescription(event);
  const unsubscribeUrl = event.page?.siteUrl
    ? `${event.page.siteUrl}${config.basePath}/subscribers/${encodeURIComponent(subscriber.id)}/unsubscribe`
    : undefined;
  const statusUrl = event.page?.siteUrl;
  const text = [
    eventTitle(event),
    "",
    description,
    ...(statusUrl ? ["", `View status page: ${statusUrl}`] : []),
    ...(unsubscribeUrl ? ["", `Unsubscribe: ${unsubscribeUrl}`] : []),
  ].join("\n");
  const statusLink = statusUrl
    ? `<p><a href="${escapeAttribute(statusUrl)}">View status page</a></p>`
    : "";
  const unsubscribe = unsubscribeUrl
    ? `<p style="color:#6b7280;font-size:12px"><a href="${escapeAttribute(unsubscribeUrl)}">Unsubscribe</a> from these updates.</p>`
    : "";

  return {
    to: [subscriber.target],
    subject,
    text,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5"><h2>${escapeHtml(eventTitle(event))}</h2><p>${escapeHtml(description)}</p>${statusLink}${unsubscribe}</body></html>`,
  };
}

async function sendSubscriberWebhook(
  subscriber: Subscriber,
  event: StatusEvent,
): Promise<void> {
  const response = await globalThis.fetch(subscriber.target, {
    method: "POST",
    // A public endpoint must not follow a redirect into a private network.
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toStatusEventPayload(event)),
  });
  if (!response.ok) {
    throw new Error(
      `Subscriber webhook delivery failed with HTTP ${response.status}.`,
    );
  }
}

async function recordSubscriberDelivery(
  config: StatusPageConfig,
  subscriber: Subscriber,
  event: StatusEvent,
  status: "sent" | "failed",
  error: string | null,
): Promise<void> {
  try {
    await config.database.recordNotification({
      channelId: `subscriber:${subscriber.id}`,
      channelType: subscriber.type,
      eventType: event.type,
      status,
      attempts: 1,
      error,
      ...(event.monitor ? { monitorName: event.monitor.name } : {}),
      ...(event.incident ? { incidentId: event.incident.id } : {}),
      ...(event.maintenance ? { maintenanceId: event.maintenance.id } : {}),
      createdAt: event.occurredAt,
    });
  } catch {
    // Delivery log persistence has the same isolation guarantee as delivery.
  }
}

function eventTitle(event: StatusEvent): string {
  if (event.incident)
    return `${event.incident.title} (${event.incident.status})`;
  if (event.maintenance)
    return `${event.maintenance.title} (${event.maintenance.status})`;
  return event.type;
}

function eventDescription(event: StatusEvent): string {
  if (event.incident) {
    const latest = event.incident.updates.at(-1);
    return latest?.message ?? `Incident status: ${event.incident.status}.`;
  }
  if (event.maintenance) {
    return `Maintenance is scheduled from ${event.maintenance.scheduledStart.toISOString()} to ${event.maintenance.scheduledEnd.toISOString()}.`;
  }
  return event.type;
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
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
