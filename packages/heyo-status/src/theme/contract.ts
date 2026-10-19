import type { ComponentType, MouseEventHandler } from "react";

import type {
  MonitorGroup,
  MonitorSnapshot,
  ResolvedStatusBranding,
  StatusSnapshot,
  StatusThemeName,
} from "../types";
import type { StatusMetricsOptions } from "../ui/primitives";

/** A snapshot group with its monitors already resolved by the page shell. */
export interface ResolvedMonitorGroup {
  group: MonitorGroup;
  monitors: MonitorSnapshot[];
}

/**
 * Everything a theme needs to draw a page.
 *
 * The shell owns data loading, colour mode, brand tokens and the subscribe
 * dialog, so a layout is a pure function of this view model. That is what
 * keeps four themes from forking the behaviour of the page four ways.
 */
export interface StatusLayoutProps {
  snapshot: StatusSnapshot;
  title: string;
  branding: ResolvedStatusBranding;
  /** Groups in snapshot order, each with the monitors it actually contains. */
  groups: ResolvedMonitorGroup[];
  /** Monitors that belong to no group, in snapshot order. */
  ungroupedMonitors: MonitorSnapshot[];
  metrics?: StatusMetricsOptions;
  incidentsEnabled: boolean;
  maintenanceEnabled: boolean;
  basePath: string;
  rssHref: string;
  subscribersEnabled: boolean;
  subscribeHref?: string;
  onSubscribe?: MouseEventHandler<HTMLButtonElement>;
  showPoweredBy: boolean;
  className?: string;
}

/** A built-in theme: a name and the layout it renders a snapshot with. */
export interface HeyoStatusTheme {
  name: StatusThemeName;
  Layout: ComponentType<StatusLayoutProps>;
}
