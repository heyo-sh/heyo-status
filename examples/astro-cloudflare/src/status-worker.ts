import astroWorker from "@astrojs/cloudflare/entrypoints/server";

import {
  cloudflareWorker,
  type CloudflareExecutionContext,
  type CloudflareScheduledEvent,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

import { statusPage, type Env } from "../heyo-status.config";

export default {
  fetch(request: Request, env: Env, context: CloudflareExecutionContext) {
    return astroWorker.fetch(request, env, context);
  },
  scheduled(
    event: CloudflareScheduledEvent,
    env: Env,
    context: CloudflareExecutionContext,
  ) {
    return cloudflareWorker(statusPage(env)).scheduled(event, env, context);
  },
};
