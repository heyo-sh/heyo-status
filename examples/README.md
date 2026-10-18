# Deployment examples

Each directory is an SSR reference project for one supported framework and
platform combination. Install dependencies from the selected directory, provide
the listed database binding/connection string, then apply migrations before the
first deployment. Use Node.js 20.19+ for Next.js and React Router TCP/TLS
checks, or Node.js 22.12+ for Astro 7.

| Framework    | Cloudflare D1 + Workers                                | Vercel + Postgres                              |
| ------------ | ------------------------------------------------------ | ---------------------------------------------- |
| React Router | [`react-router-cloudflare`](./react-router-cloudflare) | [`react-router-vercel`](./react-router-vercel) |
| Next.js      | [`next-cloudflare`](./next-cloudflare)                 | [`next-vercel`](./next-vercel)                 |
| Astro        | [`astro-cloudflare`](./astro-cloudflare)               | [`astro-vercel`](./astro-vercel)               |

## Running them locally

`bun run example` boots any of the six against a real database and asserts the
same contract against each, so a change can be checked everywhere before it is
released:

```bash
bun run example list                  # every example, its database and its port
bun run example up next-vercel        # boot one with its database ready, seeded
bun run example smoke                 # walk all six and assert the API contract
bun run example smoke astro-vercel    # or just one
bun run example reset                 # drop the local databases and D1 state
bun run example stop                  # kill anything left on ports 4310-4315
```

Nothing is left running when a command ends. Dev servers are stopped with their
whole process group, the ports are then verified to be free (a framework worker
that re-parents itself is killed by port), and a command refuses to start an
example whose port is still busy rather than testing a stale server.

Each example gets a fixed port (4310–4315) and its own database, so nothing
collides and no run reads another's rows:

- **Vercel examples** use `DATABASE_URL` when it is set, otherwise a Postgres
  already listening on `localhost:5432`, otherwise a Docker container on an
  automatically assigned localhost-only port. The harness removes that
  container when the command ends (`--keep-db` leaves it up). A server that
  was already running is never started or stopped by the
  harness: it only creates `heyo_status_<example>` databases in it, which
  `reset` drops again. A container already present before the harness starts
  is never removed, even if it has the harness name. With an explicit
  `DATABASE_URL`, all selected examples use that URL; use separate URLs if you
  need isolated data. Migrations run through the project's own
  `bun run db:migrate`.
- **Cloudflare examples** apply the bundled migrations to the local D1 state
  with `wrangler d1 migrations apply heyo-status --local`. Next and React
  Router reach that state through their framework dev proxies. Astro/Cloudflare
  runs `astro dev` on macOS and uses a built Worker fallback on Linux, where
  the Astro/Cloudflare dev runner crashes with a split Vite 7/8 tree. Generated
  starters use the framework dev server, so changing `theme` refreshes the page.

The Vercel configs explicitly read the harness-provided `HEYO_STATUS_API_TOKEN`
and `CRON_SECRET` and pass them as `adminToken` and `cronSecret`. Cloudflare
configs read the management token from a Worker binding; the harness writes a
temporary `.dev.vars` file for each local Worker. The library never reads
either variable implicitly. The smoke run exercises the write half of the API
— running checks, opening and resolving an incident, then reading it back out
of the snapshot, incident list and feed — through each adapter. `up` runs one check before printing the URLs so the
page is never empty. Dev-server output lands in `.heyo-playground/<name>.log`.
CI also builds all six projects, bundles the Cloudflare targets and boots their
actual Workers in `wrangler dev`; the Next and React Router framework dev
proxies alone cannot catch Worker-only startup errors.

Cloudflare examples declare all three scheduler expressions and point
`migrations_dir` at the package migrations. Run
`wrangler d1 migrations apply heyo-status --remote` before deployment.
Vercel examples declare checks, history compaction, and cleanup in `vercel.json`;
set `DATABASE_URL` and run `bun run db:migrate` before deployment.
`D1StatusDatabase` and `PostgresStatusDatabase` expose `await database.migrate()`
for one-off deployment migration jobs; production request handlers do not run
migrations automatically.
