import {
  vercelCronHandler,
  type VercelCronTask,
} from "@heyo-sh/heyo-status/deployments/vercel";

import { statusPage } from "../../heyo-status.config";

const tasks = new Set<VercelCronTask>(["checks", "summarize", "cleanup"]);

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { task?: string };
}) {
  const task = params.task as VercelCronTask;
  if (!tasks.has(task)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return vercelCronHandler(statusPage, task, {
    secret: process.env.CRON_SECRET,
  })(request);
}
