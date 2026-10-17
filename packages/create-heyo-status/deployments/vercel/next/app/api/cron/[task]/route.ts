import {
  vercelCronHandler,
  type VercelCronTask,
} from "@heyo-sh/heyo-status/deployments/vercel";

import { statusPage } from "../../../../heyo-status.config";

const tasks = new Set<VercelCronTask>(["checks", "summarize", "cleanup"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ task: string }> },
) {
  const { task } = await params;
  if (!tasks.has(task as VercelCronTask)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return vercelCronHandler(statusPage, task as VercelCronTask)(request);
}
