import { createRequestHandler } from "@react-router/cloudflare";

import * as build from "../build/server/index.js";
import {
  cloudflareWorker,
  type CloudflareExecutionContext,
  type CloudflareScheduledEvent,
  type D1Database,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

// The Worker serves assets as well as the app, so it sees one binding the
// routes never do; everything else comes from heyo-status.config.ts.
import { statusPage } from "../heyo-status.config";

type Env = {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

// The Pages adapter mutates request.headers, which are immutable on Workers.
const fetchHandler = createRequestHandler({ build });

export default {
  fetch(request: Request, env: Env, context: CloudflareExecutionContext) {
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
  scheduled(
    event: CloudflareScheduledEvent,
    env: Env,
    context: CloudflareExecutionContext,
  ) {
    return cloudflareWorker(statusPage(env)).scheduled(event, env, context);
  },
};
