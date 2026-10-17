import { sqlite } from "@heyo-sh/heyo-status/db";

/** Embedded SQLite is ideal for local development and Bun-hosted deployments. */
export const database = sqlite("status.sqlite");
