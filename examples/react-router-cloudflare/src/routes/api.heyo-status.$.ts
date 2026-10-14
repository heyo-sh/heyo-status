import { statusHandler } from "@heyo-sh/heyo-status/react-router";

import { statusPage, type CloudflareRouteArgs } from "../../heyo-status.config";

export async function loader({ request, context }: CloudflareRouteArgs) {
  return statusHandler(statusPage(context.cloudflare.env)).loader({ request });
}

export async function action({ request, context }: CloudflareRouteArgs) {
  return statusHandler(statusPage(context.cloudflare.env)).action({ request });
}
