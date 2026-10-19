import { runLocalDevCron } from "@heyo-sh/heyo-status/deployments/cloudflare";
import { requestStatusPage } from "../../../../../cloudflare-status-page";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  return runLocalDevCron(await requestStatusPage(), request, true);
}
