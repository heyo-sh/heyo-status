import type {
  NotificationChannel,
  NotificationDeliveryResult,
  NotificationMonitor,
  StatusEvent,
  StatusEventSelector,
  StatusEventType,
  SubscriberEmailMessage,
} from "./types";

/** Minimal fetch contract, deliberately smaller than Bun's augmented global fetch. */
export type NotificationFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const allStatusEventTypes: readonly StatusEventType[] = [
  "monitor.down",
  "monitor.recovered",
  "ssl.expiring",
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.starting",
  "maintenance.completed",
];

export interface SlackNotificationOptions {
  id?: string;
  webhookUrl: string;
  /** Optional incoming-webhook channel override. */
  channel?: string;
  /** Mentioned only when an event belongs to a critical incident. */
  mentionOnCritical?: string;
  includeLatency?: boolean;
  events?: readonly StatusEventSelector[];
  fetch?: NotificationFetch;
}

export interface DiscordNotificationOptions {
  id?: string;
  webhookUrl: string;
  /** Discord role ID or a human-readable role name. */
  mentionRole?: string;
  events?: readonly StatusEventSelector[];
  fetch?: NotificationFetch;
}

export interface WebhookNotificationOptions {
  id?: string;
  url: string;
  /** Shared secret used to create a HMAC-SHA256 signature. */
  secret: string;
  events?: readonly StatusEventSelector[];
  headers?: Record<string, string>;
  /** Total delivery attempts, including the first request. Defaults to 3. */
  retries?: number;
  /** Initial exponential-backoff delay in milliseconds. Defaults to 250. */
  retryDelayMs?: number;
  fetch?: NotificationFetch;
}

export type EmailTransport = "resend" | "aws-ses" | "cloudflare" | "smtp";

export interface EmailMessage extends SubscriberEmailMessage {
  from: string;
}

export interface EmailNotificationOptions {
  id?: string;
  from: string;
  to: string | string[];
  transport: EmailTransport;
  /** Resend API key. */
  apiKey?: string;
  /** AWS SES region; defaults to us-east-1. */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Overrides the Resend or SES API endpoint, primarily for testing/proxies. */
  endpoint?: string;
  /** Required for Cloudflare Email bindings and custom SMTP transports. */
  send?: (message: EmailMessage) => Promise<void>;
  events?: readonly StatusEventSelector[];
  fetch?: NotificationFetch;
}

/** JSON-safe public payload sent through generic webhooks. */
export interface StatusEventPayload {
  event: StatusEventType;
  timestamp: string;
  monitor?: {
    name: string;
    type: NotificationMonitor["type"];
    group?: string;
    target?: string;
    status: boolean;
    message: string;
    latencyMs: number;
    consecutiveFailures?: number;
  };
  incident?: {
    id: string;
    title: string;
    status: string;
    severity: string;
  };
  maintenance?: {
    id: string;
    title: string;
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
}

/**
 * Creates a Slack incoming-webhook channel using Block Kit. It has no SDK
 * dependency and accepts an injected fetch implementation for tests/workers.
 */
export function slack(options: SlackNotificationOptions): NotificationChannel {
  const webhookUrl = requireUrl(options.webhookUrl, "Slack webhookUrl");
  const events = normaliseEvents(options.events);
  const channelId = options.id ?? "slack";

  return {
    id: channelId,
    type: "slack",
    events,
    async send(event) {
      const response = await (options.fetch ?? globalThis.fetch)(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createSlackPayload(event, options)),
      });
      await assertSuccessfulResponse(response, "Slack");
    },
  };
}

/** Creates a Discord webhook channel with a rich, status-coloured embed. */
export function discord(
  options: DiscordNotificationOptions,
): NotificationChannel {
  const webhookUrl = requireUrl(options.webhookUrl, "Discord webhookUrl");
  const events = normaliseEvents(options.events);
  const channelId = options.id ?? "discord";

  return {
    id: channelId,
    type: "discord",
    events,
    async send(event) {
      const response = await (options.fetch ?? globalThis.fetch)(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createDiscordPayload(event, options)),
      });
      await assertSuccessfulResponse(response, "Discord");
    },
  };
}

/**
 * Creates a signed generic webhook. Each request signs `${timestamp}.${body}`
 * and sends the timestamp both as a dedicated header and in x-heyo-signature.
 */
export function webhook(
  options: WebhookNotificationOptions,
): NotificationChannel {
  const url = requireUrl(options.url, "Webhook url");
  if (!options.secret.trim())
    throw new Error("Webhook secret cannot be empty.");
  const events = normaliseEvents(options.events);
  const channelId = options.id ?? "webhook";
  const retries = normaliseRetries(options.retries ?? 3);
  const retryDelayMs = normaliseDelay(options.retryDelayMs ?? 250);

  return {
    id: channelId,
    type: "webhook",
    events,
    async send(event) {
      const payload = JSON.stringify(toStatusEventPayload(event));
      const timestamp = String(Math.floor(event.occurredAt.getTime() / 1000));
      const signature = await createWebhookSignature(
        options.secret,
        timestamp,
        payload,
      );
      const headers = new Headers(options.headers);
      headers.set("content-type", "application/json");
      headers.set("x-heyo-timestamp", timestamp);
      headers.set("x-heyo-signature", `t=${timestamp},v1=${signature}`);

      return sendWithRetry(
        async () => {
          const response = await (options.fetch ?? globalThis.fetch)(url, {
            method: "POST",
            headers,
            body: payload,
          });
          await assertSuccessfulResponse(response, "Webhook");
        },
        retries,
        retryDelayMs,
      );
    },
  };
}

/**
 * Creates an email channel. Resend and AWS SES use their HTTP APIs directly;
 * Cloudflare Email bindings and SMTP are supplied through the `send` callback.
 */
export function email(options: EmailNotificationOptions): NotificationChannel {
  const from = requireText(options.from, "Email from");
  const to = normaliseRecipients(options.to);
  const events = normaliseEvents(options.events);
  const channelId = options.id ?? `email:${options.transport}`;
  const deliver = async (message: EmailMessage): Promise<void> => {
    if (options.send) {
      await options.send(message);
      return;
    }

    switch (options.transport) {
      case "resend":
        await sendWithResend(message, options);
        return;
      case "aws-ses":
        await sendWithAwsSes(message, options);
        return;
      case "cloudflare":
        throw new Error(
          "Cloudflare email requires an EmailNotificationOptions.send callback bound to your Email binding.",
        );
      case "smtp":
        throw new Error(
          "SMTP email requires an EmailNotificationOptions.send callback backed by your SMTP transport.",
        );
    }
  };

  return {
    id: channelId,
    type: "email",
    events,
    send: async (event) => deliver(createEmailMessage(event, from, to)),
    // The configured sender/transport is reused for confirmation and public
    // incident mail; recipients remain fully controlled by the subscription.
    sendEmail: async (message) => deliver({ ...message, from }),
  };
}

/** The event catalogue accepted by the per-channel `events` option. */
export function notificationEventTypes(): readonly StatusEventType[] {
  return allStatusEventTypes;
}

/** Converts an event to the stable payload used by generic webhooks. */
export function toStatusEventPayload(event: StatusEvent): StatusEventPayload {
  return {
    event: event.type,
    timestamp: event.occurredAt.toISOString(),
    ...(event.monitor
      ? {
          monitor: {
            name: event.monitor.name,
            type: event.monitor.type,
            ...(event.monitor.group ? { group: event.monitor.group } : {}),
            ...(event.monitor.target ? { target: event.monitor.target } : {}),
            status: event.monitor.status,
            message: event.monitor.message,
            latencyMs: event.monitor.latencyMs,
            ...(event.monitor.consecutiveFailures === undefined
              ? {}
              : {
                  consecutiveFailures: event.monitor.consecutiveFailures,
                }),
          },
        }
      : {}),
    ...(event.incident
      ? {
          incident: {
            id: event.incident.id,
            title: event.incident.title,
            status: event.incident.status,
            severity: event.incident.severity,
          },
        }
      : {}),
    ...(event.maintenance
      ? {
          maintenance: {
            id: event.maintenance.id,
            title: event.maintenance.title,
            status: event.maintenance.status,
            scheduledStart: event.maintenance.scheduledStart.toISOString(),
            scheduledEnd: event.maintenance.scheduledEnd.toISOString(),
          },
        }
      : {}),
  };
}

/** Returns the lowercase hexadecimal HMAC-SHA256 used by generic webhooks. */
export async function createWebhookSignature(
  secret: string,
  timestamp: string,
  payload: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${payload}`);
}

/** Verifies the `t=<seconds>,v1=<hex>` signature emitted by {@link webhook}. */
export async function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  payload: string,
): Promise<boolean> {
  const match = /^t=(\d+),v1=([a-f\d]{64})$/i.exec(signatureHeader);
  if (!match) return false;
  const expected = await createWebhookSignature(secret, match[1]!, payload);
  return timingSafeEqual(expected, match[2]!);
}

function createSlackPayload(
  event: StatusEvent,
  options: SlackNotificationOptions,
) {
  const isRecovery = event.type === "monitor.recovered";
  const isDown = event.type === "monitor.down" || event.type === "ssl.expiring";
  const emoji = isRecovery ? "🟢" : isDown ? "🔴" : "🟡";
  const subject = eventSubject(event);
  const fields = detailFields(event, options.includeLatency !== false);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${subject}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: eventDescription(event),
      },
    },
  ];

  if (fields.length > 0) {
    blocks.push({ type: "section", fields });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Event: \`${event.type}\` • ${event.occurredAt.toISOString()}`,
      },
    ],
  });
  if (event.page?.siteUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Status Page", emoji: true },
          url: event.page.siteUrl,
          action_id: "view_status_page",
        },
      ],
    });
  }

  return {
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.mentionOnCritical && event.incident?.severity === "critical"
      ? { text: options.mentionOnCritical }
      : { text: `${emoji} ${subject}` }),
    blocks,
  };
}

function createDiscordPayload(
  event: StatusEvent,
  options: DiscordNotificationOptions,
) {
  const monitor = event.monitor;
  const isRecovery = event.type === "monitor.recovered";
  const isDown = event.type === "monitor.down" || event.type === "ssl.expiring";
  const fields = detailFields(event, true).map((field) => ({
    name: String(field.text).split("\n")[0]?.replaceAll("*", "") ?? "Detail",
    value: String(field.text).split("\n").slice(1).join("\n") || "—",
    inline: true,
  }));

  return {
    ...(options.mentionRole
      ? { content: formatDiscordRoleMention(options.mentionRole) }
      : {}),
    embeds: [
      {
        title: eventSubject(event),
        description: eventDescription(event),
        color: isRecovery ? 0x22c55e : isDown ? 0xef4444 : 0xf59e0b,
        fields,
        timestamp: event.occurredAt.toISOString(),
        ...(event.page?.title ? { footer: { text: event.page.title } } : {}),
        ...(event.page?.siteUrl ? { url: event.page.siteUrl } : {}),
        ...(monitor ? { author: { name: monitor.name } } : {}),
      },
    ],
  };
}

function detailFields(event: StatusEvent, includeLatency: boolean) {
  const fields: Array<{ type: "mrkdwn"; text: string }> = [];
  if (event.monitor) {
    fields.push({
      type: "mrkdwn",
      text: `*Type*\n${event.monitor.type.toUpperCase()}`,
    });
    if (event.monitor.target) {
      fields.push({
        type: "mrkdwn",
        text: `*Target*\n${event.monitor.target}`,
      });
    }
    fields.push({
      type: "mrkdwn",
      text: `*Status*\n${event.monitor.status ? "Healthy" : "Failing"}`,
    });
    if (includeLatency) {
      fields.push({
        type: "mrkdwn",
        text: `*Latency*\n${event.monitor.latencyMs}ms`,
      });
    }
    if (event.monitor.consecutiveFailures !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Consecutive failures*\n${event.monitor.consecutiveFailures}`,
      });
    }
  }
  if (event.incident) {
    fields.push({
      type: "mrkdwn",
      text: `*Incident*\n${event.incident.title}`,
    });
    fields.push({
      type: "mrkdwn",
      text: `*Severity*\n${event.incident.severity}`,
    });
  }
  if (event.maintenance) {
    fields.push({
      type: "mrkdwn",
      text: `*Maintenance*\n${event.maintenance.title}`,
    });
  }
  return fields;
}

function eventSubject(event: StatusEvent): string {
  if (event.monitor) {
    switch (event.type) {
      case "monitor.down":
        return `${event.monitor.name} is down`;
      case "monitor.recovered":
        return `${event.monitor.name} has recovered`;
      case "ssl.expiring":
        return `${event.monitor.name} certificate is expiring`;
      default:
        return `${event.monitor.name}: ${event.type}`;
    }
  }
  if (event.incident) return `${event.incident.title}: ${event.type}`;
  if (event.maintenance) return `${event.maintenance.title}: ${event.type}`;
  return `${event.page?.title ?? "Heyo Status"}: ${event.type}`;
}

function eventDescription(event: StatusEvent): string {
  if (event.monitor) return event.monitor.message || eventSubject(event);
  if (event.incident) return `Incident is ${event.incident.status}.`;
  if (event.maintenance) {
    return `Scheduled from ${event.maintenance.scheduledStart.toISOString()} to ${event.maintenance.scheduledEnd.toISOString()}.`;
  }
  return event.type;
}

function createEmailMessage(
  event: StatusEvent,
  from: string,
  to: string[],
): EmailMessage {
  const subject = `[${event.page?.title ?? "Heyo Status"}] ${eventSubject(event)}`;
  const description = eventDescription(event);
  const target = event.monitor?.target
    ? `<p><strong>Target:</strong> ${escapeHtml(event.monitor.target)}</p>`
    : "";
  const latency = event.monitor
    ? `<p><strong>Latency:</strong> ${event.monitor.latencyMs}ms</p>`
    : "";
  const statusLink = event.page?.siteUrl
    ? `<p><a href="${escapeAttribute(event.page.siteUrl)}">View status page</a></p>`
    : "";
  const text = [
    eventSubject(event),
    description,
    event.monitor?.target ? `Target: ${event.monitor.target}` : undefined,
    event.monitor ? `Latency: ${event.monitor.latencyMs}ms` : undefined,
    event.page?.siteUrl ? `View status page: ${event.page.siteUrl}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");

  return {
    from,
    to,
    subject,
    text,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5"><h2>${escapeHtml(eventSubject(event))}</h2><p>${escapeHtml(description)}</p>${target}${latency}${statusLink}</body></html>`,
  };
}

async function sendWithResend(
  message: EmailMessage,
  options: EmailNotificationOptions,
): Promise<void> {
  const apiKey = requireText(options.apiKey ?? "", "Resend apiKey");
  const endpoint = options.endpoint ?? "https://api.resend.com/emails";
  const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  await assertSuccessfulResponse(response, "Resend");
}

async function sendWithAwsSes(
  message: EmailMessage,
  options: EmailNotificationOptions,
): Promise<void> {
  const accessKeyId = requireText(
    options.accessKeyId ?? "",
    "AWS SES accessKeyId",
  );
  const secretAccessKey = requireText(
    options.secretAccessKey ?? "",
    "AWS SES secretAccessKey",
  );
  const region = options.region ?? "us-east-1";
  const endpoint = new URL(
    options.endpoint ??
      `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
  );
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payload = JSON.stringify({
    FromEmailAddress: message.from,
    Destination: { ToAddresses: message.to },
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: message.html, Charset: "UTF-8" },
          Text: { Data: message.text, Charset: "UTF-8" },
        },
      },
    },
  });
  const payloadHash = await sha256Hex(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.sessionToken)
    headers["x-amz-security-token"] = options.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "POST",
    endpoint.pathname || "/",
    endpoint.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await awsSigningKey(
    secretAccessKey,
    dateStamp,
    region,
    "ses",
  );
  const signature = await hmacSha256Hex(signingKey, stringToSign);
  headers.authorization = [
    "AWS4-HMAC-SHA256",
    `Credential=${accessKeyId}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${signature}`,
  ].join(" ");

  const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
    method: "POST",
    headers,
    body: payload,
  });
  await assertSuccessfulResponse(response, "AWS SES");
}

async function sendWithRetry(
  send: () => Promise<void>,
  attempts: number,
  delayMs: number,
): Promise<NotificationDeliveryResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await send();
      return { attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs * 2 ** (attempt - 1));
    }
  }
  throw new NotificationDeliveryError(lastError, attempts);
}

async function assertSuccessfulResponse(
  response: Response,
  provider: string,
): Promise<void> {
  if (response.ok) return;
  let body = "";
  try {
    body = (await response.text()).slice(0, 500);
  } catch {
    // The status is still enough context when a Response body cannot be read.
  }
  throw new Error(
    `${provider} delivery failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
  );
}

/**
 * Expands the configured selectors into concrete event types. Wildcards such as
 * `"incident.*"` are resolved once, here, so the dispatcher only ever compares
 * exact event names.
 */
function normaliseEvents(
  events: readonly StatusEventSelector[] | undefined,
): readonly StatusEventType[] | undefined {
  if (events === undefined) return undefined;
  if (events.length === 0)
    throw new Error("Notification events cannot be empty.");
  if (new Set(events).size !== events.length) {
    throw new Error("Notification events cannot contain duplicates.");
  }

  const selected = new Set<StatusEventType>();
  for (const selector of events) {
    const matches = expandEventSelector(selector);
    if (matches.length === 0) {
      throw new Error(
        `Notification event ${JSON.stringify(selector)} is not supported.`,
      );
    }
    for (const match of matches) selected.add(match);
  }
  return [...selected];
}

function expandEventSelector(
  selector: StatusEventSelector,
): readonly StatusEventType[] {
  if (selector === "*") return allStatusEventTypes;
  if (selector.endsWith(".*")) {
    const prefix = `${selector.slice(0, -1)}`;
    return allStatusEventTypes.filter((event) => event.startsWith(prefix));
  }
  return allStatusEventTypes.includes(selector as StatusEventType)
    ? [selector as StatusEventType]
    : [];
}

function normaliseRecipients(value: string | string[]): string[] {
  const values = (Array.isArray(value) ? value : [value]).map((recipient) =>
    requireText(recipient, "Email recipient"),
  );
  if (values.length === 0)
    throw new Error("At least one email recipient is required.");
  return [...new Set(values)];
}

function requireText(value: string, name: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${name} cannot be empty.`);
  return result;
}

function requireUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be an HTTP(S) URL.`);
  }
}

function normaliseRetries(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error("Webhook retries must be an integer between 1 and 10.");
  }
  return value;
}

function normaliseDelay(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Webhook retryDelayMs must be a non-negative number.");
  }
  return value;
}

function formatDiscordRoleMention(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<@&") && trimmed.endsWith(">")) return trimmed;
  return /^\d+$/.test(trimmed) ? `<@&${trimmed}>` : `@${trimmed}`;
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(
  key: string | Uint8Array,
  value: string,
): Promise<string> {
  return bytesToHex(await hmacSha256(key, value));
}

async function hmacSha256(
  key: string | Uint8Array,
  value: string,
): Promise<Uint8Array> {
  const keyBytes =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  // Copy into an ArrayBuffer: TypeScript distinguishes shared ArrayBuffer-like
  // views from the BufferSource accepted by subtle.importKey.
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(value),
    ),
  );
}

async function awsSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const dateKey = await hmacSha256(`AWS4${secret}`, dateStamp);
  const regionKey = await hmacSha256(dateKey, region);
  const serviceKey = await hmacSha256(regionKey, service);
  return hmacSha256(serviceKey, "aws4_request");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

class NotificationDeliveryError extends Error {
  readonly attempts: number;

  constructor(cause: unknown, attempts: number) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NotificationDeliveryError";
    this.attempts = attempts;
  }
}
