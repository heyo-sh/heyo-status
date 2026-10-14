import { statusHandler } from "@heyo-sh/heyo-status/next";

async function handle(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  request: Request,
) {
  const { statusPage } = await import("../../../../heyo-status.config");
  return statusHandler(statusPage)[method](request);
}

export const GET = (request: Request) => handle("GET", request);
export const POST = (request: Request) => handle("POST", request);
export const PATCH = (request: Request) => handle("PATCH", request);
export const PUT = (request: Request) => handle("PUT", request);
export const DELETE = (request: Request) => handle("DELETE", request);
