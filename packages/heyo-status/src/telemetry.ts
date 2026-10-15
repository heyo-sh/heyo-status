import { heyoStatusVersion } from "./version";
import type { StatusMonitorConfig, StatusPageConfig } from "./types";

/** Default collector. Nothing is sent when telemetry is disabled. */
export const defaultTelemetryEndpoint = "https://telemetry.heyo.sh/v1/status";

const telemetryTimeoutMs = 2_000;

export type TelemetryEnvironment = Record<string, string | undefined>;

export interface TelemetryPayload {
  /** Payload revision, so a collector can evolve without breaking clients. */
  schema: 1;
  package: "@heyo-sh/heyo-status";
  version: string;
  /** Stable, irreversible hash of the configured site URL or page title. */
  projectId: string;
  runtime: "bun" | "node" | "workerd" | "unknown";
  runtimeVersion: string;
  platform: string;
  monitors: {
    total: number;
    private: number;
    groups: number;
    byType: Record<StatusMonitorConfig["type"], number>;
  };
  features: {
    theme: string;
    mode: string;
    incidents: boolean;
    maintenance: boolean;
    subscribers: boolean;
    badges: boolean;
    prometheus: boolean;
    latencyChart: boolean;
    notificationChannels: string[];
    displayDays: number;
    retentionDays: number;
  };
}

export interface TelemetryOptions {
  env?: TelemetryEnvironment;
  fetch?: typeof fetch;
  version?: string;
  /** Overrides runtime detection; useful for deterministic tests. */
  runtime?: TelemetryPayload["runtime"];
  runtimeVersion?: string;
  platform?: string;
}

/**
 * Reports whether anonymous telemetry may be sent. Environment opt-outs take
 * precedence over configuration, never the other way round.
 */
export function isTelemetryEnabled(
  config: Pick<StatusPageConfig, "telemetry">,
  env: TelemetryEnvironment = readEnvironment(),
): boolean {
  if (!config.telemetry.enabled) return false;
  if (isTruthy(env.HEYO_TELEMETRY_DISABLED)) return false;
  if (isTruthy(env.DO_NOT_TRACK)) return false;
  // Continuous integration and test runs are automation, not adoption.
  if (isTruthy(env.CI)) return false;
  if (env.NODE_ENV === "test") return false;
  return true;
}

/**
 * Builds the anonymous payload. Monitor names, URLs, hosts, credentials and
 * incident content are deliberately never collected.
 */
export async function createTelemetryPayload(
  config: StatusPageConfig,
  options: TelemetryOptions = {},
): Promise<TelemetryPayload> {
  const byType: TelemetryPayload["monitors"]["byType"] = {
    http: 0,
    ssl: 0,
    tcp: 0,
    dns: 0,
    composite: 0,
  };
  const groups = new Set<string>();
  let privateMonitors = 0;

  for (const monitor of config.monitors) {
    byType[monitor.type] += 1;
    if (monitor.private) privateMonitors += 1;
    if (monitor.group) groups.add(monitor.group);
  }

  return {
    schema: 1,
    package: "@heyo-sh/heyo-status",
    version: options.version ?? heyoStatusVersion,
    projectId: await anonymousProjectId(config.siteUrl ?? config.title),
    runtime: options.runtime ?? detectRuntime(),
    runtimeVersion: options.runtimeVersion ?? detectRuntimeVersion(),
    platform: options.platform ?? detectPlatform(),
    monitors: {
      total: config.monitors.length,
      private: privateMonitors,
      groups: groups.size,
      byType,
    },
    features: {
      theme: config.theme,
      mode: config.mode,
      incidents: config.incidents.enabled,
      maintenance: config.maintenance.enabled,
      subscribers: config.subscribers.enabled,
      badges: config.metrics.badges,
      prometheus: config.metrics.prometheus,
      latencyChart: config.metrics.showLatencyChart,
      notificationChannels: [
        ...new Set(
          config.notifications.channels.map((channel) => channel.type),
        ),
      ].sort(),
      displayDays: config.checks.displayDays,
      retentionDays: config.checks.retentionDays,
    },
  };
}

/**
 * Sends one anonymous adoption ping. It resolves to false instead of throwing
 * so telemetry can never break a check run, a request, or a CLI command.
 */
export async function reportTelemetry(
  config: StatusPageConfig,
  options: TelemetryOptions = {},
): Promise<boolean> {
  const env = options.env ?? readEnvironment();
  if (!isTelemetryEnabled(config, env)) return false;

  const send = options.fetch ?? globalThis.fetch;
  if (typeof send !== "function") return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), telemetryTimeoutMs);
  try {
    const payload = await createTelemetryPayload(config, options);
    const response = await send(config.telemetry.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** The single-line notice printed by the CLI while telemetry is enabled. */
export const telemetryNotice =
  "Anonymous usage telemetry is enabled. Opt out with HEYO_TELEMETRY_DISABLED=1 or telemetry: false.";

async function anonymousProjectId(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`heyo-status:${seed}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function detectRuntime(): TelemetryPayload["runtime"] {
  const globals = globalThis as {
    Bun?: unknown;
    process?: { versions?: { node?: string } };
    navigator?: { userAgent?: string };
  };
  if (globals.Bun) return "bun";
  if (globals.navigator?.userAgent === "Cloudflare-Workers") return "workerd";
  if (globals.process?.versions?.node) return "node";
  return "unknown";
}

function detectRuntimeVersion(): string {
  const globals = globalThis as {
    Bun?: { version?: string };
    process?: { versions?: { node?: string } };
  };
  return globals.Bun?.version ?? globals.process?.versions?.node ?? "unknown";
}

function detectPlatform(): string {
  const platform = (globalThis as { process?: { platform?: string } }).process
    ?.platform;
  return platform ?? "unknown";
}

function readEnvironment(): TelemetryEnvironment {
  return (
    (globalThis as { process?: { env?: TelemetryEnvironment } }).process?.env ??
    {}
  );
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  return normalised !== "" && normalised !== "0" && normalised !== "false";
}
