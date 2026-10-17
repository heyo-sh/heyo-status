<div align="center">
  <!-- Screenshot placeholder: add the status-page screenshot here before release.
  <img src="./docs/status-page-screenshot.webp" alt="Heyo Status page" />
  -->

  <p>
    <a href="https://npmjs.com/package/@heyo-sh/heyo-status"><img src="https://img.shields.io/npm/dm/%40heyo-sh%2Fheyo-status?style=flat&amp;colorA=000000&amp;colorB=000000" alt="npm downloads"/></a>
    <a href="https://www.npmjs.com/package/@heyo-sh/heyo-status"><img src="https://img.shields.io/npm/v/%40heyo-sh%2Fheyo-status.svg?style=flat&amp;colorA=000000&amp;colorB=000000" alt="npm version"/></a>
    <a href="https://github.com/heyo-sh/heyo-status/stargazers"><img src="https://img.shields.io/github/stars/heyo-sh/heyo-status?style=flat&amp;colorA=000000&amp;colorB=000000" alt="GitHub stars"/></a>
    <img src="https://img.shields.io/badge/React%20Router%20%C2%B7%20Next.js%20%C2%B7%20Astro-000000?style=flat&amp;colorA=000000&amp;colorB=000000" alt="React Router, Next.js and Astro"/>
  </p>

  <p style="margin-top: 0.375rem;">
    <a href="https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md">Documentation</a>
    ·
    <a href="./examples/README.md">Deployment examples</a>
    ·
    <a href="./RELEASING.md">Releasing</a>
  </p>
</div>

## Heyo Status

A themeable, TypeScript-first status page for React Router, Next.js and Astro.
Monitor services, track uptime, publish incident timelines and maintenance
windows, and notify subscribers. Deploy to Cloudflare Workers with D1, Vercel
with PostgreSQL, or self-host with SQLite.

## Get started

Start the creator and choose a framework, theme, deployment target, database
and package manager. It creates the status page, API route, sample monitors and
scheduler wiring, then prints the commands to run your project.

```bash
# pnpm
pnpm create @heyo-sh/heyo-status

# npm
npm create @heyo-sh/heyo-status@latest

# Yarn
yarn dlx @heyo-sh/create-heyo-status

# Bun
bun create @heyo-sh/heyo-status
```

The generated CLI and `dev` scripts require Bun 1.4.3+, even if you install
and run scripts with pnpm, npm or Yarn. Production servers can use their
framework's supported Node or Worker runtime (Node 20.19+ for native TCP/TLS
checks in Next.js and React Router, or Node 22.12+ for Astro 7).

For a Bun starter without prompts:

```bash
bun create @heyo-sh/heyo-status my-status-page --template react-router
cd my-status-page
bun dev
```

Cloudflare starters build a local Worker and migrate local D1 when you run
`bun dev`; they do not offer framework hot reload. Re-run the command after
changing application code. Replace the example.com monitors and configure
`heyo-status.config.ts` before publishing real status information. For a deployment target, see the
[deployment examples](./examples/README.md) and the
[deployment guide](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md).

## Minimum configuration

`heyo-status.config.ts` at the project root is the single source of truth for
the CLI, framework routes and scheduler. The CLI accepts `--config` for another
path and `dev --port` for the standalone server (default: 3000); it does not
read Heyo Status environment-variable defaults. Start with a database and a monitor:

```ts
import { heyoStatus } from "@heyo-sh/heyo-status/config";
import { sqlite } from "@heyo-sh/heyo-status/db";

export default heyoStatus({
  database: sqlite("status.sqlite"),
  title: "Acme Status",
  theme: "slate",
  monitors: [{ name: "Website", type: "http", url: "https://acme.com" }],
});
```

Use the D1 or PostgreSQL adapters in their respective deployment environments;
SQLite needs a writable local disk. The generated projects include the right
adapter and migration setup for their selected target. The page `title` remains
its metadata and notification name; `branding.logo` controls the header image,
and optional `branding.name` adds text beside it. Starters include a replaceable
Heyo mark at `/heyo.svg`.

## Status page and API

Each project renders an SSR status page and mounts one catch-all API route at
`/api/heyo-status` by default. Public endpoints include `/status`,
`/status/summary`, `/monitors/:name/uptime`, `/incidents`, `/maintenance`,
`/rss.xml`, `/atom.xml`, `/badge/:name.svg` and `/healthz`. Prometheus
`/metrics` is available when enabled in configuration.

`/admin/*` requires `Authorization: Bearer <token>` matching `adminToken` in
the config and is disabled without a configured token. It can run checks and manage incidents and
maintenance windows. Public subscriptions are disabled by default; webhook
subscriptions require an explicit `subscribers.methods` opt-in. If you enable
visitor-supplied webhooks, restrict outbound network access as well: URL
validation alone cannot prevent DNS rebinding. See the [HTTP API reference](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/api.md).

From a generated project, the CLI can run checks, apply database migrations,
seed historical data and manage incidents:

```bash
heyo-status check run
heyo-status db migrate
heyo-status db seed --uptime 99.95 --days 90
heyo-status incident list
heyo-status maintenance list
```

`heyo-status dev -- next dev` also starts the local scheduler. Deployed
schedules use the platform's cron integration; see the generated deployment
files for the configured routes or Worker handler.

## Themes and styling

Five layouts ship with Heyo Status: `slate`, `fern`, `onyx`, `dune` and `reed`.
Set `theme` in the configuration to choose the layout and its tokens. Import
one stylesheet in the application's root layout:

```ts
import "@heyo-sh/heyo-status/theme/status.css";
```

It includes Tailwind, heyo-ui tokens and the tokens for every theme, selected
via `data-theme`. Changing the theme needs no CSS import change. Use stable
`data-slot` attributes for project-level CSS overrides. Colour mode follows
the system by default, or can be set to `light` or `dark`.

See the [UI and theme documentation](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md) and the [metrics guide](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/metrics.md).

## License

[MIT](LICENSE)
