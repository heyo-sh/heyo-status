import { statusHandler } from "@heyo-sh/heyo-status/next";

import { requestStatusPage } from "../../../../cloudflare-status-page";

async function handle(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  request: Request,
) {
  return statusHandler(await requestStatusPage())[method](request);
}

export const GET = (request: Request) => handle("GET", request);
export const POST = (request: Request) => handle("POST", request);
export const PATCH = (request: Request) => handle("PATCH", request);
export const PUT = (request: Request) => handle("PUT", request);
export const DELETE = (request: Request) => handle("DELETE", request);
