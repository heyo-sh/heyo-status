import nextWorker from "../.open-next/worker.js";

import {
  cloudflareWorker,
  type CloudflareExecutionContext,
  type CloudflareScheduledEvent,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

import { statusPage, type Env } from "../heyo-status.config";

export default {
  fetch(request: Request, env: Env, context: CloudflareExecutionContext) {
    return nextWorker.fetch(request, env, context);
  },
  /**
   * `scheduled` runs outside a request, where `getCloudflareContext()` is not
   * available, so the page is built from the Worker `env` binding. It is the
   * same `heyo-status.config.ts` every route uses; only the binding differs.
   */
  scheduled(
    event: CloudflareScheduledEvent,
    env: Env,
    context: CloudflareExecutionContext,
  ) {
    return cloudflareWorker(statusPage(env)).scheduled(event, env, context);
  },
};
