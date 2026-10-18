import { env } from "cloudflare:workers";
import type { D1Database } from "@heyo-sh/heyo-status/deployments/cloudflare";

/** `astro dev` does not invoke the Worker entrypoint; bind D1 per request. */
export async function requestStatusPage() {
  (
    globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
  ).HEYO_STATUS_D1 = (env as unknown as { DB: D1Database }).DB;
  const { statusPage } = await import("./heyo-status.config");
  return statusPage;
}
