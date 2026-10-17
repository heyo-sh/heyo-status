# @heyo-sh/create-heyo-status

Generates a ready-to-run [Heyo Status](https://github.com/heyo-sh/heyo-status)
project: a framework template, a database adapter and a deployment overlay.

```bash
bun create @heyo-sh/heyo-status my-status-page
cd my-status-page
bun run dev
```

The generator asks for a framework, theme, deployment target, database and
package manager. The generated CLI and `dev` scripts require Bun 1.4.3+ even
when running them with npm, pnpm or Yarn. Deployment servers can run on Node or
Cloudflare Workers. Next.js and React Router need Node.js 20.19+ for native
TCP/TLS checks; Astro 7 needs Node.js 22.12+ for local builds and Node
deployments. Passing a project name only answers the first question; pass flags
to skip the prompts entirely:

```
create-heyo-status [project-name]
  [--template react-router|next|astro]
  [--theme slate|fern|onyx|dune|reed]
  [--deployment cloudflare|vercel|later]
  [--database sqlite|d1|postgres]
  [--package-manager bun|pnpm|npm|yarn]
  [--no-install]
```

## Deployment and database pairs

Each target is paired with a supported database. Configure the database in
`heyo-status.database.ts`, and set `adminToken` and (for Vercel) `cronSecret` in
`heyo-status.config.ts`. Keep production credentials out of version control.
Apply remote migrations before publishing:

| Deployment   | Database             | Local workflow                                               |
| ------------ | -------------------- | ------------------------------------------------------------ |
| `cloudflare` | D1                   | `bun run dev` migrates local D1 and builds/serves the Worker |
| `vercel`     | PostgreSQL           | `bun run dev` after configuring PostgreSQL                   |
| `later`      | SQLite or PostgreSQL | `bun run dev` after configuring the database                 |

Cloudflare's `bun run dev` serves the actual bundled Worker, not a framework
hot-reload proxy. It rebuilds after each restart; re-run it after code changes.
Before deploying to Cloudflare run `wrangler d1 migrations apply <name> --remote`.
Vercel itself sends the platform `CRON_SECRET` as a bearer token to cron routes.
Set it in Vercel settings and configure the matching `cronSecret` in the status
config; the routes stay closed until you do. Run `bun run db:migrate` before
deploying. Heyo Status does not read `CRON_SECRET` or `DATABASE_URL` implicitly.

## Themes

| Theme   | Layout                                                              |
| ------- | ------------------------------------------------------------------- |
| `slate` | default: grouped cards, daily uptime bars, latency sparklines       |
| `fern`  | one uptime figure per service over a dense 90-day history           |
| `onyx`  | global banner, flat component list, dated incident timeline         |
| `dune`  | a directory of service categories with per-subcomponent status rows |
| `reed`  | minimal: a narrow single column, no cards, no badges, no groups     |

The generated project configures the chosen theme in `heyo-status.config.ts`
and forwards it to `<StatusPage />`. Changing it afterwards is one line: every
bundled theme ships in the stylesheet the project already imports, scoped to
the `data-theme` attribute the page renders. The starter uses the Heyo mark
from `public/heyo.svg` in a logo-only header. Replace it with your own logo
and change `branding.logo`, or set `branding.name` to show text beside the logo.
`title` stays in page metadata, feeds and notifications.

## What you get

`heyo-status.config.ts` in the project root — the one place a status page is
declared — with a worked set of example monitors, plus
`heyo-status.database.ts`, one catch-all API route, an SSR status page, the
shared theme stylesheet and a `src/styles/status.css` for your own overrides.

The monitors are grouped HTTP checks, a DNS check and a composite that rolls
them up, all pointing at `example.com`. They are there so the first check
renders a page that looks like a working one — groups, a body assertion, a soft
retry — rather than a single row. Replace them with your own services.

MIT
