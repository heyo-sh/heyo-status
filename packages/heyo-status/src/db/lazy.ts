import type {
  CheckResult,
  Incident,
  IncidentListOptions,
  IncidentUpdate,
  Maintenance,
  MaintenanceUpdate,
  NewIncident,
  NewMaintenance,
  NewNotificationLog,
  NewSubscriber,
  NotificationLog,
  NotificationLogOptions,
  SnapshotData,
  StatusDatabaseAdapter,
  Subscriber,
  SubscriberListOptions,
  SummarizeResult,
} from "../types";

/** Builds the real adapter. It runs at most once, on the first query. */
export type StatusDatabaseResolver = () =>
  StatusDatabaseAdapter | Promise<StatusDatabaseAdapter>;

/**
 * Defers adapter construction to the first query.
 *
 * A status configuration is a module-level value, so a database that can only
 * be built from a per-request platform binding (Cloudflare D1) or a deployment
 * secret (`DATABASE_URL`) would otherwise have to throw while the module is
 * being imported. That turns a missing binding into an unhandled module error
 * which takes down the whole framework process, including the pages that do
 * not touch the database, and makes every template import order-sensitive.
 *
 * Wrapping the adapter keeps `heyoStatus()` importable everywhere and
 * moves the failure to the request that actually needs persistence, where it
 * can be reported as a normal API error.
 */
export function lazyStatusDatabase(
  resolve: StatusDatabaseResolver,
): StatusDatabaseAdapter & { migrate(): Promise<void> } {
  let pending: Promise<StatusDatabaseAdapter> | undefined;

  const database = async (): Promise<StatusDatabaseAdapter> => {
    // A failed resolution is not cached: a missing environment variable can be
    // fixed by a restart-free redeploy, and retrying costs one call.
    pending ??= (async () => resolve())().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };

  return {
    async migrate(): Promise<void> {
      const adapter = (await database()) as StatusDatabaseAdapter & {
        migrate?: () => Promise<void>;
      };
      if (typeof adapter.migrate !== "function") {
        throw new Error(
          "The configured database adapter does not support migrations.",
        );
      }
      await adapter.migrate();
    },
    async insertCheckResults(results: CheckResult[]): Promise<void> {
      return (await database()).insertCheckResults(results);
    },
    async getSnapshot(
      monitors: string[],
      displayDays: number,
      now?: Date,
    ): Promise<SnapshotData> {
      return (await database()).getSnapshot(monitors, displayDays, now);
    },
    async summarizeHistory(before: Date): Promise<SummarizeResult> {
      return (await database()).summarizeHistory(before);
    },
    async cleanup(retentionDays: number, now?: Date): Promise<void> {
      return (await database()).cleanup(retentionDays, now);
    },

    async createIncident(incident: NewIncident): Promise<Incident> {
      return (await database()).createIncident(incident);
    },
    async updateIncident(
      id: string,
      update: IncidentUpdate,
    ): Promise<Incident> {
      return (await database()).updateIncident(id, update);
    },
    async resolveIncident(id: string, message: string): Promise<Incident> {
      return (await database()).resolveIncident(id, message);
    },
    async listIncidents(options: IncidentListOptions): Promise<Incident[]> {
      return (await database()).listIncidents(options);
    },
    async getIncident(id: string): Promise<Incident | null> {
      return (await database()).getIncident(id);
    },
    async deleteIncident(id: string): Promise<void> {
      return (await database()).deleteIncident(id);
    },

    async createMaintenance(window: NewMaintenance): Promise<Maintenance> {
      return (await database()).createMaintenance(window);
    },
    async listUpcoming(now?: Date): Promise<Maintenance[]> {
      return (await database()).listUpcoming(now);
    },
    async getMaintenance(id: string): Promise<Maintenance | null> {
      return (await database()).getMaintenance(id);
    },
    async updateMaintenance(
      id: string,
      update: MaintenanceUpdate,
    ): Promise<Maintenance> {
      return (await database()).updateMaintenance(id, update);
    },
    async deleteMaintenance(id: string): Promise<void> {
      return (await database()).deleteMaintenance(id);
    },

    async createSubscriber(subscriber: NewSubscriber): Promise<Subscriber> {
      return (await database()).createSubscriber(subscriber);
    },
    async confirmSubscriber(confirmToken: string): Promise<Subscriber | null> {
      return (await database()).confirmSubscriber(confirmToken);
    },
    async listSubscribers(
      options?: SubscriberListOptions,
    ): Promise<Subscriber[]> {
      return (await database()).listSubscribers(options);
    },
    async deleteSubscriber(id: string): Promise<boolean> {
      return (await database()).deleteSubscriber(id);
    },

    async recordNotification(
      notification: NewNotificationLog,
    ): Promise<NotificationLog> {
      return (await database()).recordNotification(notification);
    },
    async listNotificationLog(
      options?: NotificationLogOptions,
    ): Promise<NotificationLog[]> {
      return (await database()).listNotificationLog(options);
    },
  };
}
