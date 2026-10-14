import nextWorker from "../.open-next/worker.js";

import {
  cloudflareWorker,
  type CloudflareExecutionContext,
  type CloudflareScheduledEvent,
  type D1Database,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

type Env = { DB: D1Database };

export default {
  fetch(request: Request, env: Env, context: CloudflareExecutionContext) {
    (
      globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
    ).HEYO_STATUS_D1 = env.DB;
    return nextWorker.fetch(request, env, context);
  },
  async scheduled(
    event: CloudflareScheduledEvent,
    env: Env,
    context: CloudflareExecutionContext,
  ) {
    (
      globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
    ).HEYO_STATUS_D1 = env.DB;
    const { statusPage } = await import("../heyo-status.config");
    return cloudflareWorker(statusPage).scheduled(event, env, context);
  },
};
