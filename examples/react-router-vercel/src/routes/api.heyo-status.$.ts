import { statusHandler } from "@heyo-sh/heyo-status/react-router";

import { statusPage } from "../../heyo-status.config";

const route = statusHandler(statusPage);
export const loader = route.loader;
export const action = route.action;
