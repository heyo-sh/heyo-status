import { statusHandler } from "@heyo-sh/heyo-status/next";

import { statusPage } from "../../../../heyo-status.config";

const route = statusHandler(statusPage);
export const { GET, POST, PATCH, PUT, DELETE } = route;
