import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@heyo-sh/heyo-status/deployments/cloudflare";

/** Bind local D1 on every request; `next dev` does not run the Worker entrypoint. */
export async function requestStatusPage() {
  const { env } = await getCloudflareContext({ async: true });
  (
    globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
  ).HEYO_STATUS_D1 = (env as unknown as { DB: D1Database }).DB;
  const { statusPage } = await import("./heyo-status.config");
  return statusPage;
}
