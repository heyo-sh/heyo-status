---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Publish running maintenance windows, reject undeployable generator
combinations and make feed links resolve.

- **A maintenance window disappeared the moment it started.** The snapshot
  only published windows with `status: "scheduled"`, but a window flips to
  `in-progress` as soon as its start time passes. From that point the page
  announced "Under Maintenance" with nothing to explain it, `/status`
  contradicted `/maintenance`, `heyo_status_scheduled_maintenances` under-
  reported, and the `ScheduledMaintenance` component's "In progress" branch
  was unreachable. `scheduledMaintenances` now carries every window that is
  not completed.
- **The creator generated projects that could not start.**
  `--deployment cloudflare --database sqlite` produced a Worker whose database
  module needs `bun:sqlite`/`node:sqlite`, neither of which exists in workerd,
  and `--deployment vercel --database d1` produced a module that threw
  "Cloudflare D1 is not bound." on import. Both were offered by the
  interactive prompt. The creator now pairs each target with the database that
  runtime can run — D1 on Cloudflare, PostgreSQL on Vercel, any of the three
  with `--deployment later` — defaults the database to the chosen target, and
  refuses the rest instead of scaffolding a broken project.
- **RSS and Atom items linked to an anchor that was never rendered.** Feed
  entries point at `#incident-<id>`, but `ActiveIncidents` emitted no `id`, so
  every feed link landed at the top of the page. The incident disclosure now
  carries that anchor.
- **The Cloudflare examples missed the colour-mode fix.** `next-cloudflare`
  and `react-router-cloudflare` never mounted `statusThemeBootstrapScript` and
  passed neither `mode` nor `colors`; `astro-cloudflare` dropped `colors`,
  `branding`, `metrics` and the subscription options. All three also typed
  their route arguments as `any` and repeated the page configuration in every
  file. Each example now has one shared status module, forwards every
  configured option and is covered by a test so the six projects cannot drift
  apart again.
- Removed the unused `tw-animate-css` dependency from all six examples,
  corrected the `heyo_status_latency_milliseconds` help text, which described
  the latest _successful_ check rather than the latest check, documented what
  `softFail` actually does — retry once after `softFailMs`, not report a
  degraded state — and replaced the README links that pointed outside the
  repository.
