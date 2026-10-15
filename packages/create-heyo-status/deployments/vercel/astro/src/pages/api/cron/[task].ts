import type { APIRoute } from "astro";

import {
  vercelCronHandler,
  type VercelCronTask,
} from "@heyo-sh/heyo-status/deployments/vercel";
import { statusPage } from "../../../../heyo-status.config";

const tasks = new Set<VercelCronTask>(["checks", "summarize", "cleanup"]);
export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const task = params.task as VercelCronTask;
  if (!tasks.has(task)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return vercelCronHandler(statusPage, task, {
    secret: import.meta.env.CRON_SECRET,
  })(request);
};
