---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Fix the PostgreSQL adapter, the embedded SQLite runtime, unprotected cron
routes and dropped theme configuration.

- **PostgreSQL was unusable.** Every timestamp column is epoch milliseconds,
  but the SQLite/D1 schema declares them `INTEGER`, which is 32-bit in
  Postgres. The first write overflowed with `value ... is out of range for
type integer`, so a Vercel deployment could not even record a migration.
  The dialect translation now widens `INTEGER` to `BIGINT`.
- **Embedded SQLite required Bun at runtime.** `bun:sqlite` was a static
  import, so bundlers hoisted it into every server build and a generated
  project failed to boot under `next start`, `react-router-serve` or a
  Node-hosted Astro server. `sqlite()` now selects `bun:sqlite` on Bun and
  `node:sqlite` elsewhere, and reports an actionable error when neither
  exists.
- **Vercel cron routes were open when `CRON_SECRET` was unset.**
  `vercelCronHandler` only checked a bearer token if a secret happened to be
  configured, leaving `/api/cron/cleanup` able to delete history and
  `/api/cron/checks` able to drive outbound traffic for anonymous callers. It
  now reads `CRON_SECRET` as a fallback, compares it in constant time and
  answers `503` until a secret exists, matching `/admin/*`.
- **`mode` and `colors` never reached the UI.** No template or example passed
  them to `StatusPage`, and none mounted `statusThemeBootstrapScript`, so the
  documented options did nothing and every page flashed the wrong palette
  before hydration. All three templates now forward both and run the
  bootstrap script in the document head.
- **The Astro status page shipped no JavaScript.** It rendered `StatusPage`
  without a client directive, leaving the colour-mode toggle and the
  subscribe dialog as inert markup. It is now a `client:load` island inside a
  complete document.
- **UI components crashed on a JSON snapshot.** `IncidentTimeline` and
  `ScheduledMaintenance` called `Date` methods directly, so rendering the
  payload from `GET /status` threw `toISOString is not a function` whenever an
  incident or maintenance window existed. Timestamps are now normalised.
- The generated `status-client.ts` takes `basePath` as an argument instead of
  importing `heyo-status.config`, which kept the database adapter out of the
  client bundle.
