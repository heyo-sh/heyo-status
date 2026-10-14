import { requestHandler, type StatusRequestHandler } from "./shared";

/** Shape accepted by a Next.js App Router route module, without importing Next. */
export interface NextStatusRouteHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
}

/**
 * Creates handlers for `app/api/heyo-status/[...all]/route.ts`.
 * The package deliberately avoids a Next runtime dependency.
 */
export function statusHandler(
  statusPage: StatusRequestHandler,
): NextStatusRouteHandlers {
  const handle = requestHandler(statusPage);
  return {
    GET: handle,
    POST: handle,
    PATCH: handle,
    PUT: handle,
    DELETE: handle,
  };
}
