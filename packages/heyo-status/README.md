# @heyo-sh/heyo-status

Framework-agnostic, TypeScript-first status pages: scheduled HTTP/SSL/TCP/DNS
monitoring, uptime history, incident timelines, maintenance windows,
notifications, public subscriptions and portable database adapters.

## Create a status page

Use the project generator for a complete, supported installation. It creates
the framework routes, page, database setup and deployment scheduler together;
installing the runtime package alone does not schedule checks.

```bash
bun create @heyo-sh/heyo-status my-status-page
cd my-status-page
bun dev
```

Edit the generated `heyo-status.config.ts` to set your monitors, title, theme
and secrets. The page, API and scheduler all read that config. Follow the
[quickstart](https://heyo.sh/heyo-status/quickstart) and the
[deployment guides](https://heyo.sh/heyo-status/deploying/cloudflare)
before publishing. The generated scripts and CLI require Bun 1.4.3+.

## Themes

| Theme   | Layout                                                              |
| ------- | ------------------------------------------------------------------- |
| `slate` | default: grouped cards, daily uptime bars, latency sparklines       |
| `fern`  | one uptime figure per service over a dense 90-day history           |
| `onyx`  | global banner, flat component list, dated incident timeline         |
| `dune`  | a directory of service categories with per-subcomponent status rows |
| `reed`  | minimal: a narrow single column, no cards, no badges, no groups     |

Change `theme` in the generated config; the shared stylesheet already
includes every theme. `title` identifies the page in metadata, feeds and
notifications, not in the header. Set `branding.logo` and, optionally,
`branding.name` for the header.

## Databases

| Adapter                                    | Use for                          |
| ------------------------------------------ | -------------------------------- |
| `sqlite()` from `@heyo-sh/heyo-status/db`  | local and self-hosted Bun / Node |
| `d1()` from `.../deployments/cloudflare`   | Cloudflare Workers               |
| `postgres()` from `.../deployments/vercel` | Vercel, Neon, Supabase           |

The generator configures the adapter for your deployment. TCP and TLS
monitoring on Node needs Node.js 20.19+ (or Bun 1.4.3+ for local CLI checks);
Cloudflare Workers do not expose native TCP/TLS modules.

## Documentation

- [Quickstart](https://heyo.sh/heyo-status/quickstart)
- [Databases and migrations](https://heyo.sh/heyo-status/databases/schema-and-migrations)
- [HTTP API](https://heyo.sh/heyo-status/http-api/overview)

MIT
