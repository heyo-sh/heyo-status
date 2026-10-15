import { statusHandler } from "@heyo-sh/heyo-status/astro";

import { statusPage } from "../../../../heyo-status.config";

export const prerender = false;
export const { GET, POST, PATCH, PUT, DELETE } = statusHandler(statusPage);
