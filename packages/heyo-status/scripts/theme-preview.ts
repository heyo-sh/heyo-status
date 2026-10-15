#!/usr/bin/env bun
/**
 * Renders every bundled theme to a standalone HTML file.
 *
 * A theme is a layout, and a layout can only be judged by looking at it. The
 * alternative is booting an example, which pins one theme per project and
 * needs a database before it draws anything — so themes were being changed
 * without anyone seeing the other three. This script renders all of them from
 * the same snapshot, with the real compiled stylesheet, into files a browser
 * or a screenshot tool can open directly.
 *
 *   bun run --filter @heyo-sh/heyo-status theme:preview
 *   bun run --filter @heyo-sh/heyo-status theme:preview dune fern
 *   bun run --filter @heyo-sh/heyo-status theme:preview --dark
 *
 * The snapshot is fabricated on purpose: fixed dates, a seeded history and one
 * monitor in every interesting state, so two runs are byte-identical and a
 * diff in the output is a diff in the theme.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { StatusPage } from "../src/ui";
import { builtInStatusThemeNames } from "../src/theme/names";
import type {
  DaySnapshot,
  LatencySample,
  MonitorSnapshot,
  StatusSnapshot,
} from "../src/types";

const packageRoot = join(import.meta.dirname, "..");
const outputDirectory = join(
  packageRoot,
  "..",
  "..",
  ".heyo-playground",
  "themes",
);

/** Fixed so a rebuilt preview differs only where the theme differs. */
const generatedAt = new Date("2026-03-18T09:20:00.000Z");
const displayDays = 90;

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
  const names = argv.filter((argument) => !argument.startsWith("--"));
  const selected =
    names.length > 0
      ? builtInStatusThemeNames.filter((theme) => names.includes(theme))
      : [...builtInStatusThemeNames];

  if (selected.length === 0) {
    console.error(
      `Unknown theme. Known: ${builtInStatusThemeNames.join(", ")}`,
    );
    return 1;
  }

  await mkdir(outputDirectory, { recursive: true });
  const dark = flags.has("--dark");
  const snapshot = buildSnapshot();
  // Compiled once and reused for every theme on purpose: each theme's tokens
  // are scoped to `data-theme` inside the one stylesheet, so one build has to
  // be able to render all five. If a preview ever comes out with the wrong
  // width, that scoping has regressed.
  const css = await compileStylesheet();

  for (const theme of selected) {
    const body = renderToStaticMarkup(
      createElement(StatusPage, {
        snapshot,
        title: "Acme Status",
        branding: { name: "Acme" },
        theme,
        subscribersEnabled: true,
        basePath: "/api/heyo-status",
      }),
    );
    const path = join(outputDirectory, `${theme}.html`);
    await writeFile(path, document(theme, css, body, dark));
    console.log(`  ${theme.padEnd(8)} ${path}`);
  }
  return 0;
}

/**
 * Compiles the published stylesheet, not the source one: `dist/theme/status.css`
 * is what a consumer imports, and its `@source` points at the compiled
 * components, so this is the only build that proves a class survives to a real
 * page.
 */
async function compileStylesheet(): Promise<string> {
  const input = join(packageRoot, "dist", "theme", "status.css");
  const result = Bun.spawnSync(
    ["bunx", "@tailwindcss/cli", "--input", input, "--minify"],
    { cwd: packageRoot, stderr: "pipe", stdout: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`tailwind failed:\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function document(
  theme: string,
  css: string,
  body: string,
  dark: boolean,
): string {
  return [
    "<!doctype html>",
    // The same attribute `statusThemeBootstrapScript` writes before first
    // paint, so a preview is in the mode a real page would be in.
    `<html lang="en"${dark ? ' data-mode="dark"' : ""}>`,
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${theme} — Heyo Status theme preview</title>`,
    `<style>${css}</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * The monitor set the examples configure, with one monitor held in each state
 * a theme has to draw: healthy, degraded history, currently down, and never
 * checked.
 */
function buildSnapshot(): StatusSnapshot {
  const monitors: MonitorSnapshot[] = [
    monitor({
      name: "Website",
      description: "Public marketing site.",
      group: "Web",
      latestStatus: true,
      latencyMs: 74,
      downDays: [],
    }),
    monitor({
      name: "Dashboard",
      description: "Signed-in customer dashboard.",
      group: "Web",
      latestStatus: true,
      latencyMs: 182,
      downDays: [11, 47],
    }),
    monitor({
      name: "API",
      description: "Public REST API.",
      group: "API",
      latestStatus: false,
      latencyMs: 2_410,
      downDays: [0, 1, 23],
    }),
    monitor({
      name: "Webhooks",
      description: "Outbound webhook delivery.",
      group: "API",
      latestStatus: true,
      latencyMs: 310,
      downDays: [62],
    }),
    monitor({
      name: "DNS",
      description: "Public A record resolution.",
      group: "Infrastructure",
      latestStatus: true,
      latencyMs: 41,
      downDays: [],
    }),
    monitor({
      name: "TLS certificate",
      description: "Certificate lifetime for the public hostname.",
      group: "Infrastructure",
      latestStatus: true,
      latencyMs: 53,
      downDays: [],
    }),
    monitor({
      name: "Edge network",
      description: "TCP reachability of the public edge.",
      group: "Infrastructure",
      latestStatus: null,
      latencyMs: null,
      downDays: [],
    }),
    monitor({
      name: "Platform",
      description: "Everything needed to sign in and get work done.",
      latestStatus: false,
      latencyMs: 2_410,
      downDays: [0, 1, 23],
    }),
  ];

  return {
    generatedAt,
    retentionDays: 90,
    displayDays,
    overall: "degraded",
    hasConfig: true,
    hasData: true,
    groups: [
      {
        name: "Web",
        status: "operational",
        monitors: ["Website", "Dashboard"],
      },
      { name: "API", status: "degraded", monitors: ["API", "Webhooks"] },
      {
        name: "Infrastructure",
        status: "operational",
        monitors: ["DNS", "TLS certificate", "Edge network"],
      },
    ],
    monitors,
    activeIncidents: [
      {
        id: "inc_preview",
        title: "Elevated API error rate",
        status: "identified",
        severity: "major",
        affectedMonitors: ["API", "Platform"],
        auto: false,
        resolvedAt: null,
        createdAt: new Date("2026-03-18T07:40:00.000Z"),
        updatedAt: new Date("2026-03-18T08:55:00.000Z"),
        updates: [
          {
            id: "iu_2",
            status: "identified",
            message: "A bad deploy is being rolled back.",
            createdAt: new Date("2026-03-18T08:55:00.000Z"),
          },
          {
            id: "iu_1",
            status: "investigating",
            message: "We are seeing elevated 5xx on the public API.",
            createdAt: new Date("2026-03-18T07:40:00.000Z"),
          },
        ],
      },
    ],
    scheduledMaintenances: [
      {
        id: "mnt_preview",
        title: "Database upgrade",
        description: "Read-only for about twenty minutes.",
        affectedMonitors: ["API", "Dashboard"],
        scheduledStart: new Date("2026-03-21T02:00:00.000Z"),
        scheduledEnd: new Date("2026-03-21T04:00:00.000Z"),
        status: "scheduled",
        createdAt: new Date("2026-03-10T09:00:00.000Z"),
      },
    ],
  };
}

function monitor(input: {
  name: string;
  description: string;
  group?: string;
  latestStatus: boolean | null;
  latencyMs: number | null;
  /** Days back from today which should render as an outage. */
  downDays: number[];
}): MonitorSnapshot {
  const down = new Set(input.downDays);
  const days: DaySnapshot[] = [];

  for (let offset = displayDays - 1; offset >= 0; offset -= 1) {
    const at = new Date(generatedAt.getTime() - offset * 86_400_000);
    const key = at.toISOString().slice(0, 10);
    const label = key;
    if (input.latestStatus === null) {
      days.push(day(key, label, "empty", 0, 0));
      continue;
    }
    if (down.has(offset)) {
      days.push(
        day(key, label, offset % 2 === 0 ? "down" : "degraded", 288, 46),
      );
      continue;
    }
    days.push(day(key, label, "up", 288, 0));
  }

  const failing = input.downDays.length;
  const uptime =
    input.latestStatus === null
      ? null
      : Math.round((1 - (failing * 0.16) / displayDays) * 10_000) / 100;

  return {
    name: input.name,
    type: "http",
    description: input.description,
    ...(input.group ? { group: input.group } : {}),
    latestStatus: input.latestStatus,
    latestCheckedAt: input.latestStatus === null ? null : generatedAt,
    latestLatencyMs: input.latencyMs,
    uptimePercent: uptime,
    uptimePercent24h: input.latestStatus === false ? 91.6 : uptime,
    uptimePercent7d: uptime,
    uptimePercent30d: uptime,
    uptimePercent90d: uptime,
    avgLatencyMs: input.latencyMs,
    days,
    latencySeries: latencySeries(input.latencyMs),
  };
}

function day(
  key: string,
  label: string,
  status: DaySnapshot["status"],
  totalChecks: number,
  downChecks: number,
): DaySnapshot {
  const downPercent =
    totalChecks === 0 ? 0 : Math.round((downChecks / totalChecks) * 1000) / 10;
  return {
    key,
    label,
    status,
    tooltip: `${100 - downPercent}% uptime — ${totalChecks} checks`,
    totalChecks,
    downChecks,
    downMinutes: downChecks * 5,
    downPercent,
  };
}

/** A deterministic 24-point sparkline that wobbles around the given latency. */
function latencySeries(latencyMs: number | null): LatencySample[] {
  if (latencyMs === null) return [];
  return Array.from({ length: 24 }, (_, index) => {
    const at = new Date(generatedAt.getTime() - (23 - index) * 3_600_000);
    const wobble = Math.sin(index / 2.2) * 0.22 + Math.cos(index / 1.3) * 0.1;
    return {
      key: at.toISOString(),
      label: at.toISOString().slice(0, 16).replace("T", " "),
      at,
      latencyMs: Math.max(1, Math.round(latencyMs * (1 + wobble))),
      totalChecks: 12,
    };
  });
}

process.exitCode = await main(process.argv.slice(2));
