import type {
  Maintenance,
  MaintenanceStatus,
  MaintenanceUpdate,
} from "../types";

/**
 * Applies a partial maintenance edit to a persisted window. Every database
 * adapter shares this so validation and the derived schedule status cannot
 * drift between SQLite, D1 and Postgres.
 */
export function mergeMaintenance(
  current: Maintenance,
  update: MaintenanceUpdate,
  now = new Date(),
): Maintenance {
  const title = update.title === undefined ? current.title : text(update.title);
  const description =
    update.description === undefined
      ? current.description
      : update.description.trim();
  const affectedMonitors =
    update.affectedMonitors === undefined
      ? current.affectedMonitors
      : monitorNames(update.affectedMonitors);
  const scheduledStart = date(
    update.scheduledStart ?? current.scheduledStart,
    "scheduledStart",
  );
  const scheduledEnd = date(
    update.scheduledEnd ?? current.scheduledEnd,
    "scheduledEnd",
  );
  if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
    throw new Error("Maintenance scheduledEnd must be after scheduledStart.");
  }

  return {
    ...current,
    title,
    description,
    affectedMonitors,
    scheduledStart,
    scheduledEnd,
    // An explicit status wins; otherwise the new schedule derives it, so a
    // rescheduled window cannot stay "completed" in the past.
    status: update.status ?? statusAt(scheduledStart, scheduledEnd, now),
  };
}

export function statusAt(start: Date, end: Date, now: Date): MaintenanceStatus {
  if (end.getTime() <= now.getTime()) return "completed";
  if (start.getTime() <= now.getTime()) return "in-progress";
  return "scheduled";
}

function text(value: string): string {
  const result = value.trim();
  if (!result) throw new Error("Maintenance title cannot be empty.");
  return result;
}

function monitorNames(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new Error("affectedMonitors must be an array of monitor names.");
  }
  const names = value.map((name) => {
    const result = name.trim();
    if (!result) throw new Error("Affected monitor cannot be empty.");
    return result;
  });
  return [...new Set(names)];
}

function date(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Maintenance ${name} must be a valid Date.`);
  }
  return new Date(value);
}
