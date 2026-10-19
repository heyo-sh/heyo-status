import type { APIRoute } from "astro";
import { runLocalDevCron } from "@heyo-sh/heyo-status/deployments/cloudflare";
import { requestStatusPage } from "../../../../../cloudflare-status-page";

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });
  return runLocalDevCron(await requestStatusPage(), request, true);
};
