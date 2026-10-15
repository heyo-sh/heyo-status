import { env } from "cloudflare:workers";
import { statusHandler } from "@heyo-sh/heyo-status/astro";
import { statusPage, type Env } from "../../../../heyo-status.config";

interface AstroContext {
  request: Request;
}

export const prerender = false;

function handler() {
  return statusHandler(statusPage(env as Env));
}

export async function GET(context: AstroContext) {
  return handler().GET(context);
}
export async function POST(context: AstroContext) {
  return handler().POST(context);
}
export async function PATCH(context: AstroContext) {
  return handler().PATCH(context);
}
export async function PUT(context: AstroContext) {
  return handler().PUT(context);
}
export async function DELETE(context: AstroContext) {
  return handler().DELETE(context);
}
