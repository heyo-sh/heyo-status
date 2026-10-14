import { createRequestHandler } from "@react-router/cloudflare";

import * as build from "../build/server/index.js";
import {
  cloudflareWorker,
  type CloudflareExecutionContext,
  type CloudflareScheduledEvent,
  type D1Database,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

type Env = {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

// Workers requests have immutable headers; the Pages adapter mutates them.
const fetchHandler = createRequestHandler({ build });

export default {
  fetch(request: Request, env: Env, context: CloudflareExecutionContext) {
    (
      globalThis as typeof globalThis & { HEYO_STATUS_D1?: D1Database }
    ).HEYO_STATUS_D1 = env.DB;
    return fetchHandler({
      request,
      env,
      data: {},
      functionPath: "",
      params: {},
      next(input: Request | string = request, init?: RequestInit) {
        const nextRequest =
          typeof input === "string"
            ? new Request(new URL(input, request.url), init)
            : init
              ? new Request(input, init)
              : input;
        return env.ASSETS.fetch(nextRequest);
      },
      passThroughOnException() {},
      waitUntil: context.waitUntil.bind(context),
    });
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
