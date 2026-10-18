import { statusHandler } from "@heyo-sh/heyo-status/astro";
import { requestStatusPage } from "../../../../cloudflare-status-page";

type AstroContext = { request: Request };
export const prerender = false;

async function handler() {
  return statusHandler(await requestStatusPage());
}

export async function GET(context: AstroContext) {
  return (await handler()).GET(context);
}
export async function POST(context: AstroContext) {
  return (await handler()).POST(context);
}
export async function PATCH(context: AstroContext) {
  return (await handler()).PATCH(context);
}
export async function PUT(context: AstroContext) {
  return (await handler()).PUT(context);
}
export async function DELETE(context: AstroContext) {
  return (await handler()).DELETE(context);
}
