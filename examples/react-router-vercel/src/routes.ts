import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("api/heyo-status/*", "routes/api.heyo-status.$.ts"),
  route("api/cron/:task", "routes/api.cron.$task.ts"),
] satisfies RouteConfig;
