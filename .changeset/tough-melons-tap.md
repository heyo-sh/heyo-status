---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Compile the bundled theme, tighten the database contract and remove dead
surface area.

- **Generated projects had no Tailwind build step.** The bundled theme starts
  with `@import "tailwindcss"`, but no template shipped a PostCSS config, so
  `@theme`, `@custom-variant` and three `@apply` rules reached the browser
  unprocessed and were dropped. Pages rendered with no background colour, no
  text colour and no font, and dark mode never repainted the document.
  Every template now ships `postcss.config.mjs` and `@tailwindcss/postcss`.
- **Astro rejected part of its own status API.** Astro's form-origin check
  answered `403` for every `DELETE` sent without a JSON content type — so
  removing an incident, a maintenance window or a subscription failed — and
  for the unsubscribe form. The status API carries no cookie or session
  authority, so the generated Astro configuration opts out.
- **Unsubscribe links did not work.** Subscriber mail linked to
  `DELETE /subscribers/:id`, which no mail client can send. A
  `GET /subscribers/:id/unsubscribe` confirmation page and a
  `POST /subscribers/:id/unsubscribe` action replace it; `GET` never mutates,
  so a mail scanner prefetching the link cannot unsubscribe anyone.
- **`"90d"` did not mean ninety days.** The UI, badges, Prometheus metrics and
  `GET /monitors/:name/uptime` all reported the `checks.displayDays` window
  under a `90d` label. `MonitorSnapshot` gained `uptimePercent90d`, the uptime
  endpoint reports the configured window separately as `window`, and the three
  copies of the period lookup were merged into one.
- **`monitor.degraded` never existed.** It was in the event catalogue, accepted
  by channel filters and stored by every adapter, but nothing emitted it.
  Removed.
- **`ssl.expiring` was detected with a regular expression** over the check's
  human-readable message, so rewording a check silently downgraded the event to
  `monitor.down`. The SSL checker now reports `expiring` and `expiresInDays`.
- `StatusDatabaseAdapter` no longer marks `deleteIncident`, `getMaintenance`,
  `updateMaintenance`, `deleteMaintenance`, `recordNotification` and
  `listNotificationLog` optional. All shipped adapters implement them, the
  configuration schema now requires them, and the unreachable `501` branches
  are gone.
- Removed the 36 one-line component re-exports and the unused
  `status-client.ts` from the templates, along with `components.json`, which
  pointed at paths no template contains.
- The portable SQL repository behind D1 and Postgres is now covered against a
  real SQLite engine instead of hand-written mocks.
