# @heyo-sh/heyo-status

## 0.4.1

### Patch Changes

- e3d87a3: Format daily status tooltips with a full UTC date, a clear status or downtime summary, and separate lines for uptime, unavailability, checks, and failures.

## 0.4.0

### Minor Changes

- e1828b6: Upgrade heyo-ui and show focusable daily status tooltips with exact unavailability percentages, plus proportional healthy/unavailable fills for partially degraded days in the slate, fern and reed themes.

## 0.3.3

### Patch Changes

- 61ec5ac: Show incident and maintenance sections with clear empty states whenever their features are enabled. Pass the feature flags through all generated status pages so disabled sections stay hidden.

## 0.3.2

### Patch Changes

- 3fcc38b: Run initial and scheduled status checks through the local framework server in generated Cloudflare projects, so `bun run dev` populates the same D1 database used by the status page.

## 0.3.1

### Patch Changes

- b168aba: Show the bundled Heyo mark in dark mode. The header logo was inverted with `filter: invert(light-dark(0, 1))`, but `light-dark()` resolves to a colour rather than the number `invert()` takes, so browsers dropped the declaration and the near-black mark stayed invisible on a dark canvas. The amount now comes from `--status-logo-invert`, driven by the `data-mode` attribute the theme toggle writes and falling back to `prefers-color-scheme` in system mode.

## 0.3.0

### Minor Changes

- 83fc996: Remove adoption telemetry and implicit environment-variable configuration. Configure the management token and Vercel cron secret explicitly in `heyo-status.config.ts`; the CLI uses `--config` and `--port` or their defaults. Generated starters configure SQLite and PostgreSQL directly in `heyo-status.database.ts` instead of reading environment variables.

### Patch Changes

- 4b387f9: Prevent private monitors from opening automatic incidents. Hide previously stored automatic incidents for private monitors from public status snapshots, incident APIs, feeds, badges, metrics and subscriber notifications while preserving direct database access and operational monitor alerts.

## 0.2.0

### Minor Changes

- f66d29c: Serve the HTTP API from the catch-all mount point and protect the management
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

- f66d29c: Rebuild the status page on heyo-ui.

  The page used to carry its own design system: a 1,068-line stylesheet, a private
  set of shadcn-ish tokens, and hand-written markup for cards, badges, bars,
  timelines and a modal. It is now assembled from `@heyo-sh/heyo-ui` components —
  `Card`, `Badge`, `Button`, `StatusBar`, `StatusDot`, `Meter`, `Timeline`,
  `Empty`, `Dialog`, `Tabs`, `Input`, `Separator` — on that library's semantic
  tokens, so a status page looks like the rest of the platform and inherits its
  accessibility and colour-mode work instead of re-implementing them.

  - **Colour mode is now `data-mode` on `<html>`,** not a `.dark` class. heyo-ui
    resolves both palettes from one set of tokens through `light-dark()`, which
    reads `color-scheme`, which `data-mode` sets. `statusThemeBootstrapScript()`
    and `DarkModeToggle` write the attribute, and system mode removes it instead
    of freezing today's preference into the document.
  - **`colors.primary` / `colors.secondary` now map to the heyo-ui brand tokens**
    (`--color-heyo-brand` and its tint) rather than `--primary` / `--secondary`.
    Only those two move; every surface, edge and status colour still comes from
    the design system, so an override cannot produce unreadable text.
  - **The stylesheet shrank from 1,068 lines to 50.** It imports Tailwind and the
    heyo-ui tokens, registers the compiled components as a Tailwind source — which
    Tailwind otherwise skips inside `node_modules` — and declares the four status
    colours. `minimal.css` is now a radius scale rather than a second stylesheet.
  - **Every region exposes a `data-slot`** (`status-page`, `status-header`,
    `status-overall`, `status-monitor`, `status-monitor-group`, `status-footer`),
    which replaces the old `heyo-*` class names as the way to restyle the page
    from a project.
  - **`SubscribeDialog` moved to `@heyo-sh/heyo-status/ui/subscribe-dialog`** and
    is loaded on demand. A modal, tabs and a form are around 95 KB of component
    code; re-exporting it from `/ui` pinned all of it into the first chunk of
    every status page. Splitting it took the client bundle for the page itself
    from 169 KB to 73 KB, and the dialog now downloads when a visitor asks to
    subscribe.

  Monitor groups and incidents remain native `<details>` disclosures rather than
  the library's `Accordion`: a status page has to stay readable when the
  JavaScript bundle fails, which is exactly when people come looking for it.

- f66d29c: Make `theme` the only thing that selects a theme, add the `reed` theme,
  quieten the repeated status labels in `dune` and `fern`, and widen every page.

  - **Changing `theme` only half worked.** Page width and the radius scale were
    `:root` declarations in five separate stylesheets, so `theme` in
    `heyo-status.config.ts` picked the React layout while the _imported_
    stylesheet picked the width. Editing `theme` swapped the layout and left the
    width behind — silently, because nothing about the page had changed the
    stylesheet — and the documentation could only ask you to keep two files in
    sync by hand. Every theme's tokens now ship in the one shared stylesheet,
    scoped to the `data-theme` attribute the page already published, so
    `@heyo-sh/heyo-status/theme/<name>.css` is an alias and `theme` is the whole
    switch. Existing imports keep working and need no change.

  - **New `reed` theme.** A narrow single column and nothing else: no cards
    around monitors, no status badges, no group boxes — a name, ninety days of
    history and one uptime figure per service, at a 40rem page width — the
    narrowest of the bundled themes by a wide margin. The theme for a status page
    that should not look like an application. Groups are still drawn, as one
    quiet label above their rows, because a layout must not silently discard what
    the configuration asked for.
  - **`dune` rows no longer repeat the group's badge.** Every row carried its own
    "Operational" pill directly under a group header that said the same thing, so
    the right edge was a column of identical labels and the one row that was _not_
    operational was the hardest thing on the page to find. A row now leads with a
    bare status dot, and its name and description share a line — which is also
    the density the theme exists for.
  - **`fern` rows align.** The leading indicator was a dot plus its label, so it
    was as wide as the word it happened to carry and "Operational", "Outage" and
    "No data" each started the service name at a different x. The dot now stands
    alone and the names line up.
  - **Page widths are retuned.** `fern` 48→64rem, `onyx` 56→64rem, `dune`
    64→60rem, `slate` 72→64rem. `fern` moves the most because the ninety-day bar
    _is_ that page, and much below 64rem a single bad day is a hairline nobody
    notices — which is the one thing the theme is for. `slate`, `fern` and `onyx`
    now share one measure; only `dune` (denser rows) and `reed` (minimal by
    design) step away from it.

  The status dots that lost their visible text keep it as an accessible name, so
  nothing is lost to a screen reader.

- f66d29c: Rename the entry point to `heyoStatus()` and ship four real themes.

  - `defineStatusPage()` is now `heyoStatus()`. It is the one way a page is
    declared, and it belongs in `heyo-status.config.ts` in the project root: the
    CLI, the generated routes and every example load the page from that path.
    `--config` and `HEYO_STATUS_CONFIG` stay for projects that cannot.
  - `theme` used to pick a stylesheet while every page rendered the same layout.
    It now selects a layout from a registry, the way `heyo-docs` resolves its
    themes, and `<StatusPage theme={...} />` is what carries the choice into the
    page. The bundled themes are `slate` (default: grouped cards, daily uptime
    bars and latency sparklines), `fern` (one uptime figure per service over a
    dense ninety-day history), `onyx` (a global banner, a flat component list and
    a dated incident timeline) and `dune` (a directory of service categories with
    per-subcomponent status rows).
  - `theme/default.css` and `theme/minimal.css` are replaced by
    `theme/slate.css`, `theme/fern.css`, `theme/onyx.css` and `theme/dune.css`.
    `default` maps to `slate` and `minimal` to `onyx`.
  - Shared page components moved to `@heyo-sh/heyo-status/ui`'s `primitives`
    module and are still exported from `@heyo-sh/heyo-status/ui`, together with
    `resolveStatusTheme`, `builtInStatusThemeNames` and the `StatusLayoutProps`
    contract a theme is written against.

### Patch Changes

- f66d29c: Keep the page title in metadata, feeds and notifications rather than repeating it in the header and footer. Make the header brand name optional and ship the Heyo mark as the default logo-only branding in generated projects.
- f66d29c: Fix the PostgreSQL adapter, the embedded SQLite runtime, unprotected cron
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

- f66d29c: Resolve TCP and TLS modules through the native runtime so framework bundlers do not replace Node sockets with browser shims or emit dynamic-import warnings. Keep Astro/Cloudflare and React Router/Cloudflare renderers on one React instance in generated projects, and require Node versions with the native builtin-module API for Node deployments.
- f66d29c: Fix generated Cloudflare projects, silent CLI failures and a broken lockfile.

  - **Every Cloudflare project failed on its first command.** The generated D1
    adapter read the Worker binding while `heyo-status.database.ts` was being
    imported and threw when it was absent, so `bun run dev`, `bun run check` and
    `bun run db:seed` all died with a module-level stack trace before the
    framework started. Platform adapters are now built on the first query through
    the new `lazyStatusDatabase()` helper, which turns a missing binding or
    `DATABASE_URL` into a normal error on the request that needs persistence.
  - **Cloudflare projects advertised commands a Worker binding cannot serve.**
    The overlay now generates `dev` (framework only) and `start`
    (`wrangler dev` with local D1), and omits `check` and `db:seed`. Package
    overlays can delete an inherited key, so a Cloudflare or Vercel Astro project
    no longer ships the unused `@astrojs/node` adapter.
  - **The CLI swallowed every command failure.** Subcommands were returned rather
    than awaited inside the error handler, so a rejected promise escaped it: the
    process printed a raw stack trace instead of `heyo-status failed: <reason>`
    and never returned a deliberate exit code.
  - **`POST /subscribers` created a row per request.** The public endpoint never
    checked for an existing subscription, so one address could be signed up any
    number of times: each request mailed it again, and every duplicate row then
    received its own copy of every incident. Subscriptions are now identified by
    their destination and a pending confirmation is reused for fifteen minutes.
  - **`/rss.xml` and `/atom.xml` serialised the entire incident history.** Both
    public feeds grew without limit; they now publish the fifty newest incidents.
  - **A project name disabled the generator's prompts.** `create-heyo-status
my-status-page` silently chose the framework, deployment target and database
    instead of asking, contradicting the documented quickstart. A name now answers
    only the first question; flags still make a run fully non-interactive.
  - **`bun install --frozen-lockfile` failed.** The lockfile still referenced an
    example dependency that had been removed, which broke the install step of both
    the CI and the release workflow. The Vercel examples were also missing
    `@types/pg`, leaving their database wiring untyped.
  - Both packages now ship a README and declare `repository`, `homepage`, `bugs`
    and `keywords`, and the release workflow passes `NODE_AUTH_TOKEN` so the
    documented first publish can authenticate.

- f66d29c: Fix the latency sparkline, which was drawn wrong wherever a theme shows it —
  in the bundled themes that is only `slate`, because it is the one that renders
  `MonitorCard`.

  - The horizontal axis is time instead of the index in the array. Empty buckets
    are omitted from `latencySeries` rather than reported as zero latency, so
    even spacing drew an eleven-hour gap as the same step as a one-hour bucket
    and the line told a story the data did not support.
  - The newest reading is drawn as a zero-length round-capped stroke instead of a
    `<circle>`. The chart is stretched to the card width with
    `preserveAspectRatio="none"`, which scales a circle's geometry on each axis
    independently and rendered the marker as a flat ellipse several times wider
    than it was tall.
  - Hover targets tile the full width, each reaching halfway to its neighbours.
    They were fixed-width bands centred on every point, which left dead gaps
    between them, and once the spacing stopped being uniform most of a bucket's
    column no longer showed its tooltip.

- f66d29c: Stop bundling Hono into the published build.

  `hono` is declared as a runtime dependency, so every install already fetched it,
  yet the build inlined a second copy into `api.js`, `cli.js`, `config.js` and
  `index.js`. Installations carried five copies of the router, a Hono security
  release could only reach users through a republished package, and a project
  that already used Hono loaded two versions of it. The router is now external,
  like `zod` and `drizzle-orm`, which removes about 78 KB from the package and
  lets the declared semver range resolve as intended.

- f66d29c: Harden public subscriptions, make record ordering deterministic and stop a
  per-monitor query on every check run.

  - **Public webhook subscriptions could reach the deployment's own network.**
    `POST /subscribers` accepted any HTTP(S) URL, so an anonymous visitor could
    point a subscription at `127.0.0.1`, a private range or the cloud metadata
    address and turn the status page into a request-forgery proxy. Destinations
    that are not publicly routable are now rejected, along with URLs carrying
    credentials.
  - **Nothing stopped two concurrent subscriptions for one destination.** The API
    de-duplicates before inserting, but both requests passed that check together.
    A new migration adds a unique index on `subscribers(type, target)`, and the
    request that loses the race reports the winner's subscription instead of an
    error. Existing duplicates are collapsed when the migration runs.
  - **Records written in the same millisecond were ordered arbitrarily.** Every
    list uses its identifier as the tie-breaker of a timestamp column, and one
    check run routinely opens several incidents at once, so an incident list or a
    feed could publish the newer record first. Identifiers are now time-sortable
    and monotonic, including across a clock that steps backwards.
  - **A check run read the full retained history once per monitor.** Transition
    detection and automatic-incident reconciliation now share one history read
    per run instead of one per monitor.
  - **The subscribe dialog claimed `aria-modal` without honouring it.** Focus
    stayed behind the dialog, Tab walked out into content the visitor could not
    reach, and Escape did nothing. It now takes focus, traps it, closes on Escape
    and restores focus to whatever opened it.

- f66d29c: Harden public subscription responses, forward migrations from deferred database adapters, and keep Cloudflare-safe database imports out of Worker bundles. Make generated Cloudflare projects build, migrate and boot with `bun dev`; exclude the Next.js Worker from pre-OpenNext typechecking and keep Astro's server bundle out of public assets. Pin the verified Next.js release for the generated Worker, upgrade Astro and its deployment adapters to patched releases, and select patched transitive dependencies in generated projects. Use Bun 1.4.3's parent-scoped overrides to replace vulnerable `path-to-regexp` in Astro/Vercel's routing utilities and the generated Vercel CLI without changing Express's incompatible version.
- ba04330: Resolve Tailwind's explicit CSS export so Vite 8 can build React Router SSR pages.
- f66d29c: Pin the footer to the bottom of the viewport and ship a worked set of example
  monitors.

  - **The footer floated mid-page.** The page shell asked for `min-h-full`, but
    nothing requires the embedding application to give `html`/`body` a height,
    and a percentage minimum against an auto-height parent resolves to nothing.
    The footer's `mt-auto` therefore had no free space to claim, so a page with
    only a couple of monitors ended with the footer hanging under the last card.
    The shell now uses `min-h-screen`, which needs no cooperation from the host
    document.
  - **The footer credit now reads "Powered by heyo" and links to
    `https://heyo.sh`.**
  - **Generated projects start with a realistic page.** A new project used to
    come with two bare HTTP monitors, which left nothing to look at: no groups,
    no second monitor type, no aggregate. The templates now configure grouped
    Web and API services, a DNS check and a composite rolling them up, with a
    body assertion and a soft retry shown in place. They all point at
    `example.com`, so the first check is green and the page renders the way a
    working deployment does. `ssl` and `tcp` are included as commented examples,
    with a note that they need `node:tls`/`node:net` and so do not run on
    Cloudflare Workers.

- f66d29c: Compile the bundled theme, tighten the database contract and remove dead
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

- f66d29c: Publish running maintenance windows, reject undeployable generator
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
