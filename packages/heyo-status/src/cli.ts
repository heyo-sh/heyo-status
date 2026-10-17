#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runStatusChecks } from "./checks";
import { heyoStatus } from "./config";
import { createId } from "./ids";
import { reconcileAutomaticIncidents } from "./incidents";
import {
  collectMonitorNotificationEvents,
  dispatchNotifications,
} from "./notification-dispatcher";
import type {
  CheckResult,
  IncidentSeverity,
  IncidentStatus,
  StatusPage,
  StatusPageConfig,
  UserStatusPageConfig,
} from "./types";

const dayMs = 24 * 60 * 60 * 1000;
const seedChecksPerDay = 100;
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

/** Entry point for Heyo Status operational commands. */
export async function runCli(args = process.argv.slice(2)): Promise<number> {
  try {
    // Every branch awaits inside the try: returning the promise directly would
    // settle `runCli` before the handler below could turn a rejection into a
    // one-line message and a non-zero exit code.
    if (args[0] === "dev") {
      return await runDevCommand(args.slice(1));
    }
    if (args[0] === "check" && args[1] === "run") {
      return await runCheckCommand(args.slice(2));
    }
    if (args[0] === "db" && args[1] === "migrate") {
      return await runMigrateCommand(args.slice(2));
    }
    if (args[0] === "db" && args[1] === "seed") {
      return await runSeedCommand(args.slice(2));
    }
    if (args[0] === "incident") {
      return await runIncidentCommand(args.slice(1));
    }
    if (args[0] === "maintenance") {
      return await runMaintenanceCommand(args.slice(1));
    }

    printUsage();
    return 1;
  } catch (error) {
    console.error(`heyo-status failed: ${errorMessage(error)}`);
    return 1;
  }
}

async function runDevCommand(args: string[]): Promise<number> {
  const separator = args.indexOf("--");
  const optionArgs = separator === -1 ? args : args.slice(0, separator);
  const command = separator === -1 ? [] : args.slice(separator + 1);
  const parsed = parseOptions(optionArgs, ["config", "port"]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  const scheduler = startLocalScheduler(config);

  // Populate a freshly-created local database immediately. Subsequent runs are
  // driven by the configured cron expressions instead of a fixed interval.
  void config.cron.runChecks().catch((error: unknown) => {
    console.error(`Initial status check failed: ${errorMessage(error)}`);
  });

  if (command.length > 0) {
    try {
      return await runChildProcess(command);
    } finally {
      scheduler.stop();
    }
  }

  const port = readPort(parsed.options.port ?? "3000");
  if (typeof Bun === "undefined") {
    scheduler.stop();
    throw new CliInputError(
      "heyo-status dev without a framework command requires Bun. Pass a command after -- instead.",
    );
  }

  const server = Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/") return config.handler(request);
      return new Response(localDevPage(config), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  console.log(
    `Heyo Status local server listening on http://localhost:${server.port}`,
  );

  await new Promise<void>((resolveServer) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      server.stop(true);
      scheduler.stop();
      resolveServer();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function runMigrateCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config"]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  const database = config.database as StatusPageConfig["database"] & {
    migrate?: () => Promise<void>;
  };

  if (database.migrate) {
    await database.migrate();
    console.log("Database migrations applied.");
  } else {
    // The embedded SQLite adapter applies bundled migrations on construction,
    // which happens while loading the configuration above.
    console.log(
      "Database is ready (embedded migrations are applied automatically).",
    );
  }
  return 0;
}

async function runCheckCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config"]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  if (config.monitors.length === 0) {
    console.log("No monitors are configured.");
    return 0;
  }

  const now = new Date();
  const results = await runStatusChecks(config.monitors, now);
  const monitorEvents = await collectMonitorNotificationEvents(
    config,
    results,
    now,
  );
  await config.database.insertCheckResults(results);
  const incidentEvents = await reconcileAutomaticIncidents(
    config,
    results,
    now,
  );
  await dispatchNotifications(config, [...monitorEvents, ...incidentEvents]);

  for (const result of results) {
    console.log(
      `${result.status ? "UP  " : "DOWN"} ${result.name} (${result.type}) ${result.latencyMs}ms — ${result.message}`,
    );
  }

  const failed = results.filter((result) => !result.status).length;
  console.log(`Stored ${results.length} check result(s); ${failed} failed.`);
  return failed === 0 ? 0 : 1;
}

async function runSeedCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config", "uptime", "days"]);
  ensureNoPositionals(parsed);
  const uptime = readUptime(requiredOption(parsed, "uptime"));
  const days = readPositiveInteger(requiredOption(parsed, "days"), "--days");
  const config = await loadStatusPage(configPathFrom(parsed));
  if (config.monitors.length === 0) {
    console.log("No monitors are configured; nothing to seed.");
    return 0;
  }

  const now = new Date();
  const results = createSeedResults(config.monitors, uptime, days, now);
  await config.database.insertCheckResults(results);
  const compacted = await config.database.summarizeHistory(startOfUtcDay(now));

  console.log(
    `Seeded ${results.length} check result(s) for ${config.monitors.length} monitor(s) across ${days} day(s) at ${uptime}% uptime.`,
  );
  console.log(
    `Compacted ${compacted.summarizedResults} result(s) into ${compacted.summarizedDays} daily summary row(s).`,
  );
  return 0;
}

async function runIncidentCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  switch (subcommand) {
    case "create":
      return createIncidentCommand(args.slice(1));
    case "update":
      return updateIncidentCommand(args.slice(1));
    case "resolve":
      return resolveIncidentCommand(args.slice(1));
    case "list":
      return listIncidentCommand(args.slice(1));
    default:
      throw new CliInputError(
        "Usage: heyo-status incident create|update|resolve|list ...",
      );
  }
}

async function createIncidentCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, [
    "config",
    "title",
    "severity",
    "monitors",
    "message",
    "status",
  ]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  const statusValue = parsed.options.status;
  const status = statusValue
    ? readIncidentStatus(statusValue, "--status")
    : undefined;
  if (status === "resolved") {
    throw new CliInputError(
      "--status cannot be resolved when creating an incident.",
    );
  }

  const incident = await config.database.createIncident({
    title: requiredOption(parsed, "title"),
    severity: readIncidentSeverity(
      requiredOption(parsed, "severity"),
      "--severity",
    ),
    affectedMonitors: readMonitors(requiredOption(parsed, "monitors")),
    message: requiredOption(parsed, "message"),
    ...(status ? { status } : {}),
  });
  printRecord(incident);
  return 0;
}

async function updateIncidentCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, [
    "config",
    "status",
    "severity",
    "message",
  ]);
  const id = requireSinglePositional(parsed, "incident id");
  const config = await loadStatusPage(configPathFrom(parsed));
  const existing = await config.database.getIncident(id);
  if (!existing)
    throw new CliInputError(`Incident ${JSON.stringify(id)} was not found.`);

  const status = parsed.options.status
    ? readIncidentStatus(parsed.options.status, "--status")
    : existing.status;
  const severity = parsed.options.severity
    ? readIncidentSeverity(parsed.options.severity, "--severity")
    : existing.severity;
  const message = parsed.options.message ?? "Incident details updated.";

  const incident =
    status === "resolved"
      ? await config.database.resolveIncident(id, message)
      : await config.database.updateIncident(id, {
          id: createId("upd"),
          status,
          severity,
          message,
          createdAt: new Date(),
        });
  printRecord(incident);
  return 0;
}

async function resolveIncidentCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config", "message"]);
  const id = requireSinglePositional(parsed, "incident id");
  const config = await loadStatusPage(configPathFrom(parsed));
  const incident = await config.database.resolveIncident(
    id,
    requiredOption(parsed, "message"),
  );
  printRecord(incident);
  return 0;
}

async function listIncidentCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config", "status", "severity"]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  const incidents = await config.database.listIncidents({
    ...(parsed.options.status
      ? { status: readIncidentStatus(parsed.options.status, "--status") }
      : {}),
    ...(parsed.options.severity
      ? {
          severity: readIncidentSeverity(parsed.options.severity, "--severity"),
        }
      : {}),
  });
  printRecord(incidents);
  return 0;
}

async function runMaintenanceCommand(args: string[]): Promise<number> {
  const subcommand = args[0];
  switch (subcommand) {
    case "create":
      return createMaintenanceCommand(args.slice(1));
    case "list":
      return listMaintenanceCommand(args.slice(1));
    default:
      throw new CliInputError("Usage: heyo-status maintenance create|list ...");
  }
}

async function createMaintenanceCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, [
    "config",
    "title",
    "description",
    "monitors",
    "start",
    "end",
  ]);
  ensureNoPositionals(parsed);
  const start = readDate(requiredOption(parsed, "start"), "--start");
  const end = readDate(requiredOption(parsed, "end"), "--end");
  if (end.getTime() <= start.getTime()) {
    throw new CliInputError("--end must be after --start.");
  }

  const config = await loadStatusPage(configPathFrom(parsed));
  const maintenance = await config.database.createMaintenance({
    title: requiredOption(parsed, "title"),
    ...(parsed.options.description
      ? { description: parsed.options.description }
      : {}),
    affectedMonitors: readMonitors(requiredOption(parsed, "monitors")),
    scheduledStart: start,
    scheduledEnd: end,
  });
  printRecord(maintenance);
  return 0;
}

async function listMaintenanceCommand(args: string[]): Promise<number> {
  const parsed = parseOptions(args, ["config"]);
  ensureNoPositionals(parsed);
  const config = await loadStatusPage(configPathFrom(parsed));
  printRecord(await config.database.listUpcoming());
  return 0;
}

/**
 * Builds deterministic, evenly distributed synthetic observations. Each day
 * has 100 checks per configured monitor, which makes the requested uptime easy
 * to inspect in DayGrid cells while keeping a 90-day seed lightweight.
 */
export function createSeedResults(
  monitors: StatusPageConfig["monitors"],
  uptime: number,
  days: number,
  now = new Date(),
): CheckResult[] {
  if (!Number.isFinite(uptime) || uptime < 0 || uptime > 100) {
    throw new Error("uptime must be a number between 0 and 100.");
  }
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error("days must be a positive integer.");
  }
  if (!Number.isFinite(now.getTime()))
    throw new Error("now must be a valid Date.");

  const results: CheckResult[] = [];
  const firstDayMs = startOfUtcDay(now).getTime() - (days - 1) * dayMs;

  for (const monitor of monitors) {
    const totalChecks = days * seedChecksPerDay;
    const downChecks = Math.round(totalChecks * (1 - uptime / 100));
    let sample = 0;

    for (let day = 0; day < days; day += 1) {
      const dayStartMs = firstDayMs + day * dayMs;
      const dayEndMs = Math.min(dayStartMs + dayMs, now.getTime());
      const spanMs = Math.max(0, dayEndMs - dayStartMs);

      for (let check = 0; check < seedChecksPerDay; check += 1) {
        const before = Math.floor((sample * downChecks) / totalChecks);
        const after = Math.floor(((sample + 1) * downChecks) / totalChecks);
        const status = after === before;
        const offset = Math.floor(
          ((check + 1) * spanMs) / (seedChecksPerDay + 1),
        );

        results.push({
          name: monitor.name,
          type: monitor.type,
          status,
          message: status ? "Seeded uptime data" : "Seeded downtime data",
          latencyMs: status ? 40 + ((sample * 17) % 160) : 0,
          checkedAt: new Date(dayStartMs + offset),
        });
        sample += 1;
      }
    }
  }

  return results;
}

async function loadStatusPage(path: string): Promise<StatusPage> {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    throw new CliInputError(`Configuration file not found: ${absolutePath}`);
  }

  const module = (await import(pathToFileURL(absolutePath).href)) as {
    default?: unknown;
    statusPage?: unknown;
  };
  const config = module.default ?? module.statusPage;
  if (!config || typeof config !== "object") {
    throw new CliInputError(
      "heyo-status.config.ts must export a heyoStatus() result as `statusPage` or as its default export.",
    );
  }

  return heyoStatus(config as UserStatusPageConfig);
}

interface ParsedOptions {
  options: Record<string, string | undefined>;
  positionals: string[];
}

function parseOptions(args: string[], allowed: string[]): ParsedOptions {
  const options: Record<string, string | undefined> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    const equals = argument.indexOf("=");
    const name = argument.slice(2, equals === -1 ? undefined : equals);
    if (!allowed.includes(name))
      throw new CliInputError(`Unknown option: ${argument}`);
    if (options[name] !== undefined) {
      throw new CliInputError(`Option --${name} was provided more than once.`);
    }

    const value = equals === -1 ? args[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith("--")) {
      throw new CliInputError(`--${name} requires a value.`);
    }
    options[name] = value;
  }

  return { options, positionals };
}

function configPathFrom(parsed: ParsedOptions): string {
  return parsed.options.config ?? defaultConfigPath();
}

function requiredOption(parsed: ParsedOptions, name: string): string {
  const value = parsed.options[name];
  if (!value) throw new CliInputError(`--${name} is required.`);
  return value;
}

function ensureNoPositionals(parsed: ParsedOptions): void {
  if (parsed.positionals.length > 0) {
    throw new CliInputError(`Unexpected argument: ${parsed.positionals[0]}`);
  }
}

function requireSinglePositional(parsed: ParsedOptions, name: string): string {
  if (parsed.positionals.length !== 1) {
    throw new CliInputError(`${name} is required.`);
  }
  return parsed.positionals[0]!;
}

function readUptime(value: string): number {
  const uptime = Number(value);
  if (!Number.isFinite(uptime) || uptime < 0 || uptime > 100) {
    throw new CliInputError("--uptime requires a number between 0 and 100.");
  }
  return uptime;
}

function readPort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new CliInputError("--port requires an integer between 1 and 65535.");
  }
  return port;
}

function readPositiveInteger(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new CliInputError(`${name} requires a positive integer.`);
  }
  return number;
}

function readIncidentStatus(value: string, name: string): IncidentStatus {
  if (!incidentStatuses.has(value as IncidentStatus)) {
    throw new CliInputError(`${name} must be a valid incident status.`);
  }
  return value as IncidentStatus;
}

function readIncidentSeverity(value: string, name: string): IncidentSeverity {
  if (!incidentSeverities.has(value as IncidentSeverity)) {
    throw new CliInputError(`${name} must be a valid incident severity.`);
  }
  return value as IncidentSeverity;
}

function readMonitors(value: string): string[] {
  const monitors = value
    .split(",")
    .map((monitor) => monitor.trim())
    .filter(Boolean);
  if (monitors.length === 0) {
    throw new CliInputError(
      "--monitors requires one or more comma-separated monitor names.",
    );
  }
  return [...new Set(monitors)];
}

function readDate(value: string, name: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new CliInputError(`${name} must be an ISO-8601 timestamp.`);
  }
  return date;
}

function defaultConfigPath(): string {
  return "heyo-status.config.ts";
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function printRecord(record: unknown): void {
  console.log(JSON.stringify(record, null, 2));
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  heyo-status dev [--config ./heyo-status.config.ts] [--port <port>] [-- <framework dev command>]",
      "  heyo-status check run [--config ./heyo-status.config.ts]",
      "  heyo-status db migrate [--config ./heyo-status.config.ts]",
      "  heyo-status db seed --uptime <0-100> --days <n> [--config ./heyo-status.config.ts]",
      "  heyo-status incident create --title <title> --severity <minor|major|critical> --monitors <a,b> --message <message> [--config <path>]",
      "  heyo-status incident update <id> --status <status> --message <message> [--severity <severity>] [--config <path>]",
      "  heyo-status incident resolve <id> --message <message> [--config <path>]",
      "  heyo-status incident list [--status <status>] [--severity <severity>] [--config <path>]",
      "  heyo-status maintenance create --title <title> --monitors <a,b> --start <ISO> --end <ISO> [--description <text>] [--config <path>]",
      "  heyo-status maintenance list [--config <path>]",
    ].join("\n"),
  );
}

interface LocalScheduler {
  stop(): void;
}

/**
 * A dependency-free five-field cron scheduler for local development. It
 * evaluates once per second but runs a matching job at most once per minute.
 * Production adapters keep using their platform cron services.
 */
function startLocalScheduler(config: StatusPage): LocalScheduler {
  const jobs: Array<{
    expression: string;
    name: string;
    run: () => Promise<unknown>;
    lastMinute?: string;
  }> = [
    {
      expression: config.checks.interval,
      name: "checks",
      run: () => config.cron.runChecks(),
    },
    {
      expression: config.checks.summaryCron,
      name: "history summary",
      run: () => config.cron.summarize(),
    },
    {
      expression: config.checks.cleanupCron,
      name: "history cleanup",
      run: () => config.cron.cleanup(),
    },
  ];

  const tick = () => {
    const now = new Date();
    const minute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    for (const job of jobs) {
      if (
        job.lastMinute === minute ||
        !matchesCronExpression(job.expression, now)
      ) {
        continue;
      }
      job.lastMinute = minute;
      void job.run().catch((error: unknown) => {
        console.error(`Scheduled ${job.name} failed: ${errorMessage(error)}`);
      });
    }
  };
  tick();
  // `dev` performs an explicit initial check. Mark the current minute as
  // consumed so an expression such as `* * * * *` does not immediately run
  // that same check a second time on the scheduler's first tick.
  const now = new Date();
  const currentMinute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
  for (const job of jobs) {
    if (matchesCronExpression(job.expression, now))
      job.lastMinute = currentMinute;
  }
  const timer = setInterval(tick, 1_000);
  return { stop: () => clearInterval(timer) };
}

/** Matches the standard five-field cron subset used by Heyo Status configs. */
export function matchesCronExpression(
  expression: string,
  date = new Date(),
): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return false;

  const minuteMatches = cronFieldMatches(minute, date.getUTCMinutes(), 0, 59);
  const hourMatches = cronFieldMatches(hour, date.getUTCHours(), 0, 23);
  const monthMatches = cronFieldMatches(month, date.getUTCMonth() + 1, 1, 12);
  const domMatches = cronFieldMatches(dayOfMonth, date.getUTCDate(), 1, 31);
  const dowMatches = cronFieldMatches(dayOfWeek, date.getUTCDay(), 0, 7);
  if (!minuteMatches || !hourMatches || !monthMatches) return false;

  // Cron treats day-of-month and day-of-week as an OR when both are explicit.
  const domWildcard = dayOfMonth === "*";
  const dowWildcard = dayOfWeek === "*";
  return domWildcard || dowWildcard
    ? domMatches && dowMatches
    : domMatches || dowMatches;
}

function cronFieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  return field.split(",").some((part) => {
    const [rangePart, stepPart] = part.split("/");
    if (
      stepPart !== undefined &&
      (!/^\d+$/.test(stepPart) || Number(stepPart) < 1)
    ) {
      return false;
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      const range = rangePart.match(/^(\d+)(?:-(\d+))?$/);
      if (!range) return false;
      start = Number(range[1]);
      end = range[2] === undefined ? start : Number(range[2]);
    }
    // Sunday can be represented by either 0 or 7 in the last field.
    const candidates = max === 7 && value === 0 ? [0, 7] : [value];
    return (
      start >= min &&
      end <= max &&
      start <= end &&
      candidates.some(
        (candidate) =>
          candidate >= start &&
          candidate <= end &&
          (candidate - start) % step === 0,
      )
    );
  });
}

async function runChildProcess(command: string[]): Promise<number> {
  const [executable, ...arguments_] = command;
  if (!executable)
    throw new CliInputError("A development command is required after --.");
  return new Promise<number>((resolveChild, rejectChild) => {
    const child = spawn(executable, arguments_, { stdio: "inherit" });
    child.once("error", rejectChild);
    child.once("close", (code, signal) => {
      if (signal) return resolveChild(1);
      resolveChild(code ?? 1);
    });
  });
}

function localDevPage(config: StatusPage): string {
  const escapedTitle = escapeHtml(config.title);
  const firstMonitor = config.monitors.find((monitor) => !monitor.private);
  // Every link is base-path relative so the dev server mirrors deployments.
  const base = config.basePath;
  const links = [
    `<a href="${base}/status">Status snapshot</a>`,
    ...(config.metrics.badges
      ? [
          `<a href="${base}/badge/${encodeURIComponent(firstMonitor?.name ?? "overall")}.svg">Status badge</a>`,
        ]
      : []),
    ...(config.metrics.prometheus
      ? [`<a href="${base}/metrics">Prometheus metrics</a>`]
      : []),
    `<a href="${base}/healthz">Health check</a>`,
  ].join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>body{font-family:ui-sans-serif,system-ui;margin:3rem;max-width:48rem;color:#172033}code{background:#eef2f7;padding:.15rem .3rem;border-radius:.25rem}</style></head><body><h1>${escapedTitle}</h1><p>Heyo Status local API is running. Use a generated framework project for the full status-page UI.</p><p>${links}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class CliInputError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
