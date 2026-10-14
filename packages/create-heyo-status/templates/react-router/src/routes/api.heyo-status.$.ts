import { statusHandler } from "@heyo-sh/heyo-status/react-router";

export async function loader({ request }: { request: Request }) {
  const { statusPage } = await import("../../heyo-status.config");
  return statusHandler(statusPage).loader({ request });
}

export async function action({ request }: { request: Request }) {
  const { statusPage } = await import("../../heyo-status.config");
  return statusHandler(statusPage).action({ request });
}
