import { requestHandler, type StatusRequestHandler } from "./shared";

export interface ReactRouterDataArgs {
  request: Request;
}

export interface ReactRouterStatusRouteHandlers {
  loader(args: ReactRouterDataArgs): Promise<Response>;
  action(args: ReactRouterDataArgs): Promise<Response>;
}

/**
 * Creates `loader` and `action` exports for a React Router catch-all route.
 * React Router passes the Web Request object through unchanged.
 */
export function statusHandler(
  statusPage: StatusRequestHandler,
): ReactRouterStatusRouteHandlers {
  const handle = requestHandler(statusPage);
  return {
    loader: ({ request }) => handle(request),
    action: ({ request }) => handle(request),
  };
}
