import type { StatusPage } from "../types";

/** The only runtime contract framework adapters need from Heyo Status. */
export type StatusRequestHandler = Pick<StatusPage, "handler">;

export type StatusHandler = (request: Request) => Promise<Response>;

export function requestHandler(
  statusPage: StatusRequestHandler,
): StatusHandler {
  return (request) => statusPage.handler(request);
}
