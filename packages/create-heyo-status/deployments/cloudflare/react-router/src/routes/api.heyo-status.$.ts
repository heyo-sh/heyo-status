import type { D1Database } from "@heyo-sh/heyo-status/deployments/cloudflare";
import { statusHandler } from "@heyo-sh/heyo-status/react-router";

type CloudflareArgs = {
  request: Request;
  context: { cloudflare: { env: { DB: D1Database } } };
};

function bindD1(context: CloudflareArgs["context"]) {
  (
    globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
  ).HEYO_STATUS_D1 = context.cloudflare.env.DB;
}

export async function loader({ request, context }: CloudflareArgs) {
  bindD1(context);
  const { statusPage } = await import("../../heyo-status.config");
  return statusHandler(statusPage).loader({ request });
}

export async function action({ request, context }: CloudflareArgs) {
  bindD1(context);
  const { statusPage } = await import("../../heyo-status.config");
  return statusHandler(statusPage).action({ request });
}
