"use client";

import { lazy, Suspense, useState, type MouseEventHandler } from "react";

import { defaultStatusBasePath } from "../base-path";
import { defaultStatusThemeName } from "../theme/names";
import { StatusThemeProvider, StatusThemeTokens } from "../theme/provider";
import { resolveStatusTheme } from "../theme/registry";
import type { ResolvedMonitorGroup } from "../theme/contract";
import type {
  ResolvedStatusBranding,
  StatusColors,
  StatusMode,
  StatusSnapshot,
  StatusThemeName,
  SubscriberMethod,
} from "../types";
import type { StatusMetricsOptions } from "./primitives";

/**
 * The dialog is the only part of the page that needs a modal, tabs and a form
 * — most of the component code a status page would otherwise ship. Loading it
 * when a visitor asks to subscribe keeps it off the critical path for the many
 * who only read the page.
 */
const SubscribeDialog = lazy(async () => ({
  default: (await import("./subscribe-dialog")).SubscribeDialog,
}));

export interface StatusPageProps {
  snapshot: StatusSnapshot;
  title?: string;
  branding?: ResolvedStatusBranding;
  /** One of the bundled themes; defaults to `slate`. */
  theme?: StatusThemeName;
  mode?: StatusMode;
  colors?: StatusColors;
  subscribersEnabled?: boolean;
  /** Show the incidents section, including its empty state. */
  incidentsEnabled?: boolean;
  /** Show the maintenance section, including its empty state. */
  maintenanceEnabled?: boolean;
  subscriberMethods?: readonly SubscriberMethod[];
  subscribeHref?: string;
  /** Defaults to `basePath`/subscribers when the built-in dialog is used. */
  subscriberApiUrl?: string;
  onSubscribe?: MouseEventHandler<HTMLButtonElement>;
  metrics?: StatusMetricsOptions;
  /**
   * Mount point of the catch-all status route. Feed and subscription links are
   * derived from it, so they keep working with a custom `basePath`.
   */
  basePath?: string;
  rssHref?: string;
  showPoweredBy?: boolean;
  className?: string;
}

/**
 * A complete, data-only status-page view. Framework adapters only need to load
 * a StatusSnapshot and pass configuration-derived presentation options here.
 *
 * The shell owns everything that is not visual — colour mode, brand tokens,
 * the lazily mounted subscribe dialog and the grouping of monitors — and hands
 * the result to the configured theme, which is the only thing that decides how
 * a page looks.
 */
export function StatusPage({
  snapshot,
  title = "Heyo Status",
  branding = {},
  theme = defaultStatusThemeName,
  mode = "system",
  colors,
  subscribersEnabled = false,
  incidentsEnabled = true,
  maintenanceEnabled = true,
  subscriberMethods,
  subscribeHref,
  subscriberApiUrl,
  onSubscribe,
  metrics,
  basePath = defaultStatusBasePath,
  rssHref = `${basePath}/rss.xml`,
  showPoweredBy = true,
  className,
}: StatusPageProps) {
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // The dialog is mounted lazily on first use: its form state and fetch logic
  // never run for the many visitors who only read the status page.
  const [subscribeRequested, setSubscribeRequested] = useState(false);
  const opensBuiltInSubscribeDialog =
    subscribersEnabled && !subscribeHref && !onSubscribe;
  const handleSubscribe =
    onSubscribe ??
    (opensBuiltInSubscribeDialog
      ? () => {
          setSubscribeRequested(true);
          setSubscribeOpen(true);
        }
      : undefined);
  const { Layout } = resolveStatusTheme(theme);
  const { groups, ungroupedMonitors } = resolveMonitorGroups(snapshot);

  return (
    <StatusThemeProvider defaultTheme={mode}>
      <StatusThemeTokens colors={colors}>
        <Layout
          basePath={basePath}
          branding={branding}
          className={className}
          groups={groups}
          incidentsEnabled={incidentsEnabled}
          maintenanceEnabled={maintenanceEnabled}
          metrics={metrics}
          onSubscribe={handleSubscribe}
          rssHref={rssHref}
          showPoweredBy={showPoweredBy}
          snapshot={snapshot}
          subscribeHref={subscribeHref}
          subscribersEnabled={subscribersEnabled}
          title={title}
          ungroupedMonitors={ungroupedMonitors}
        />
        {opensBuiltInSubscribeDialog && subscribeRequested ? (
          <Suspense fallback={null}>
            <SubscribeDialog
              apiUrl={subscriberApiUrl}
              basePath={basePath}
              methods={subscriberMethods}
              onOpenChange={setSubscribeOpen}
              open={subscribeOpen}
              rssHref={rssHref}
            />
          </Suspense>
        ) : null}
      </StatusThemeTokens>
    </StatusThemeProvider>
  );
}

/**
 * Resolves snapshot groups to the monitors they name, once, so every theme
 * reads the same view model instead of repeating the lookup four ways.
 */
function resolveMonitorGroups(snapshot: StatusSnapshot): {
  groups: ResolvedMonitorGroup[];
  ungroupedMonitors: StatusSnapshot["monitors"];
} {
  const monitorsByName = new Map(
    snapshot.monitors.map((monitor) => [monitor.name, monitor]),
  );
  const groupedMonitorNames = new Set(
    snapshot.groups.flatMap((group) => group.monitors),
  );

  return {
    groups: snapshot.groups.map((group) => ({
      group,
      monitors: group.monitors.flatMap((name) => {
        const monitor = monitorsByName.get(name);
        return monitor ? [monitor] : [];
      }),
    })),
    ungroupedMonitors: snapshot.monitors.filter(
      (monitor) => !groupedMonitorNames.has(monitor.name),
    ),
  };
}
