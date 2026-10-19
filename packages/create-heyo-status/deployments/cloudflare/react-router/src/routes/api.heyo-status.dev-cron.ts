import type { D1Database } from "@heyo-sh/heyo-status/deployments/cloudflare";
import { runLocalDevCron } from "@heyo-sh/heyo-status/deployments/cloudflare";

type CloudflareArgs = {
  request: Request;
  context: { cloudflare: { env: { DB: D1Database } } };
};

export async function action({ request, context }: CloudflareArgs) {
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });
  (
    globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
  ).HEYO_STATUS_D1 = context.cloudflare.env.DB;
  const { statusPage } = await import("../../heyo-status.config");
  return runLocalDevCron(statusPage, request, true);
}
