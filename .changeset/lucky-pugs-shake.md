---
"@heyo-sh/heyo-status": minor
"@heyo-sh/create-heyo-status": minor
---

Serve the HTTP API from the catch-all mount point and protect the management
endpoints.

- `defineStatusPage` now accepts `basePath` (default `/api/heyo-status`) and
  strips it before routing. Previously the router only answered absolute paths
  such as `/api/status`, so every request that arrived through the generated
  catch-all route returned 404.
- Management endpoints moved to `/admin/*` and require
  `Authorization: Bearer <token>` from `adminToken` or `HEYO_STATUS_API_TOKEN`.
  Without a token they refuse every request, so incidents, maintenance windows
  and the notification log can no longer be written or read by anonymous
  visitors.
- Added `GET /status/summary`, `GET /monitors/:name/uptime`,
  `POST /admin/checks/run`, `PATCH /admin/maintenance/:id` and
  `DELETE /admin/maintenance/:id`, plus `getMaintenance`, `updateMaintenance`
  and `deleteMaintenance` on the database adapters.
- Channel `events` accept wildcard selectors such as `"incident.*"` and `"*"`.
- Atom and RSS feeds publish a self link that resolves to the mounted route,
  `StatusPage` derives feed and subscription URLs from `basePath`, and
  `handler` always returns a promise.
