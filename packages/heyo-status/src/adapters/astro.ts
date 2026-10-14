import { requestHandler, type StatusRequestHandler } from "./shared";

export interface AstroApiContext {
  request: Request;
}

export type AstroStatusEndpoint = (
  context: AstroApiContext,
) => Promise<Response>;

/** The framework-free endpoint shape exported from an Astro API route. */
export interface AstroStatusRouteHandlers {
  GET: AstroStatusEndpoint;
  POST: AstroStatusEndpoint;
  PATCH: AstroStatusEndpoint;
  PUT: AstroStatusEndpoint;
  DELETE: AstroStatusEndpoint;
}

/**
 * Creates endpoint handlers for `src/pages/api/heyo-status/[...path].ts`.
 * No Astro package is imported so this module is safe in every runtime.
 */
export function statusHandler(
  statusPage: StatusRequestHandler,
): AstroStatusRouteHandlers {
  const handle = requestHandler(statusPage);
  const endpoint: AstroStatusEndpoint = ({ request }) => handle(request);
  return {
    GET: endpoint,
    POST: endpoint,
    PATCH: endpoint,
    PUT: endpoint,
    DELETE: endpoint,
  };
}
