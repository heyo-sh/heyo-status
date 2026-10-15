import type {
  CheckResult,
  Incident,
  Maintenance,
  StatusDatabaseAdapter,
} from "../src/types";

const checkedAt = new Date("2026-01-15T12:00:00.000Z");

const incident: Incident = {
  id: "inc_1",
  title: "API unavailable",
  status: "investigating",
  severity: "major",
  affectedMonitors: ["API"],
  auto: false,
  updates: [],
  createdAt: checkedAt,
  updatedAt: checkedAt,
  resolvedAt: null,
};

const maintenance: Maintenance = {
  id: "mnt_1",
  title: "Database maintenance",
  description: "Routine maintenance.",
  affectedMonitors: ["API"],
  scheduledStart: checkedAt,
  scheduledEnd: new Date("2026-01-15T13:00:00.000Z"),
  status: "scheduled",
  createdAt: checkedAt,
};

export const checkResult: CheckResult = {
  name: "Website",
  type: "http",
  status: true,
  message: "HTTP 200",
  latencyMs: 12,
  checkedAt,
};

/** A complete in-memory adapter used exclusively to exercise the public contract. */
export const testDatabaseAdapter = {
  async insertCheckResults(_results) {},
  async getSnapshot(_monitors, _displayDays) {
    return { results: [checkResult], dailySummaries: [] };
  },
  async summarizeHistory(_before) {
    return { summarizedDays: 0, summarizedResults: 0, deletedResults: 0 };
  },
  async cleanup(_retentionDays) {},
  async createIncident(input) {
    return { ...incident, ...input, auto: input.auto ?? false };
  },
  async updateIncident(_id, update) {
    return { ...incident, status: update.status, updates: [update] };
  },
  async resolveIncident(_id, _message) {
    return { ...incident, status: "resolved" as const, resolvedAt: checkedAt };
  },
  async listIncidents(_options) {
    return [incident];
  },
  async getIncident(_id) {
    return incident;
  },
  async deleteIncident(_id) {},
  async createMaintenance(input) {
    return { ...maintenance, ...input, description: input.description ?? "" };
  },
  async listUpcoming() {
    return [maintenance];
  },
  async getMaintenance(_id) {
    return maintenance;
  },
  async updateMaintenance(_id, update) {
    return { ...maintenance, ...update };
  },
  async deleteMaintenance(_id) {},
  async createSubscriber(input) {
    return {
      id: "sub_1",
      type: input.type,
      target: input.target,
      confirmed: input.confirmed ?? false,
      monitors: input.monitors ?? null,
      createdAt: checkedAt,
    };
  },
  async confirmSubscriber(_token) {
    return {
      id: "sub_1",
      type: "email" as const,
      target: "ops@example.com",
      confirmed: true,
      monitors: null,
      createdAt: checkedAt,
    };
  },
  async listSubscribers(_options) {
    return [];
  },
  async deleteSubscriber(_id) {
    return true;
  },
  async recordNotification(input) {
    return {
      id: "ntf_1",
      channelId: input.channelId,
      channelType: input.channelType,
      eventType: input.eventType,
      status: input.status,
      attempts: input.attempts ?? 1,
      error: input.error ?? null,
      monitorName: input.monitorName ?? null,
      incidentId: input.incidentId ?? null,
      maintenanceId: input.maintenanceId ?? null,
      createdAt: input.createdAt ?? checkedAt,
    };
  },
  async listNotificationLog(_options) {
    return [];
  },
} satisfies StatusDatabaseAdapter;
