---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Fix generated Cloudflare projects, silent CLI failures and a broken lockfile.

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
