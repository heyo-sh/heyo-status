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

Bun 1.4.3+ must be installed regardless of which package manager installs
dependencies: the generated development scripts and `heyo-status` CLI run with
Bun, and older versions ignore the Vercel security overrides. Production
framework servers can run on their supported Node or Worker runtime.

For a Bun starter without prompts:

```bash
bun create @heyo-sh/heyo-status my-status-page
cd my-status-page
cp .env.example .env
bun dev
```

Cloudflare starters build a local Worker and migrate local D1 when you run
`bun dev`; they do not offer framework hot reload. Re-run the command after
changing application code. Replace the example.com monitors and configure
your environment before publishing real status information. For a deployment target, see the
[deployment examples](./examples/README.md) and the
[deployment guide](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md).

## Minimum configuration

`heyo-status.config.ts` at the project root is the single source of truth for
the CLI, framework routes and scheduler. Start with a database and a monitor:

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
adapter and migration setup for their selected target.

## Status page and API

Each project renders an SSR status page and mounts one catch-all API route at
`/api/heyo-status` by default. Public endpoints include `/status`,
`/status/summary`, `/monitors/:name/uptime`, `/incidents`, `/maintenance`,
`/rss.xml`, `/atom.xml`, `/badge/:name.svg` and `/healthz`. Prometheus
`/metrics` is available when enabled in configuration.

`/admin/*` requires `Authorization: Bearer <HEYO_STATUS_API_TOKEN>` and is
disabled without a configured token. It can run checks and manage incidents and
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
Set `theme` in the configuration to choose the layout. Import one stylesheet
in the application's root layout; it includes Tailwind, heyo-ui tokens and
the tokens for every theme:

```ts
import "@heyo-sh/heyo-status/theme/slate.css";
```

The import is an alias for the shared stylesheet: changing the `theme` value
also selects the appropriate theme tokens via `data-theme`. Use stable
`data-slot` attributes for project-level CSS overrides. Colour mode follows
the system by default, or can be set to `light` or `dark`.

See the [UI and theme documentation](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md) and the [metrics guide](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/metrics.md).

## Development

Run `bun run quality` for formatting, types, unit tests and package builds.
Run `bun run example smoke` to exercise all six framework/deployment examples
against local D1 and PostgreSQL (an existing server or Docker). These checks
also run in CI. See [examples/README.md](./examples/README.md) for setup and
cleanup details.

## License

[MIT](LICENSE)
