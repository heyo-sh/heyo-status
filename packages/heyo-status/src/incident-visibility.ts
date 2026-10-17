import type { Incident, StatusPageConfig } from "./types";

/** Existing automatic incidents must stay private if their monitor is private. */
export function isPublicIncident(
  config: Pick<StatusPageConfig, "monitors">,
  incident: Pick<Incident, "auto" | "affectedMonitors">,
): boolean {
  // Manual incidents are explicitly published by an operator.
  if (!incident.auto) return true;
  return !incident.affectedMonitors.some((name) =>
    config.monitors.some((monitor) => monitor.private && monitor.name === name),
  );
}
