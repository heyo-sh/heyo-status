# @heyo-sh/heyo-status

Framework-agnostic, TypeScript-first status pages: scheduled HTTP/SSL/TCP/DNS
monitoring, uptime history, incident timelines, maintenance windows,
notifications, public subscriptions and portable database adapters.

The fastest way in is the project generator:

```bash
bun create @heyo-sh/heyo-status my-status-page
```

## Install into an existing app

```bash
bun add @heyo-sh/heyo-status
```

A status page is declared once, by `heyoStatus()`, in `heyo-status.config.ts`
at the root of the project. The CLI, the routes and every example read it from
that path:

```ts
// heyo-status.config.ts
import { heyoStatus } from "@heyo-sh/heyo-status/config";
import { sqlite } from "@heyo-sh/heyo-status/db";

export const statusPage = heyoStatus({
  database: sqlite("status.sqlite"),
  title: "Acme Status",
  theme: "slate",
  monitors: [{ name: "Website", type: "http", url: "https://acme.com" }],
  checks: { interval: "*/5 * * * *", retentionDays: 90, displayDays: 90 },
  // adminToken: "your-private-token", // enables management routes
});
```

Mount one catch-all route; every endpoint is served beneath it:

```ts
// Next.js — app/api/heyo-status/[...path]/route.ts
import { statusHandler } from "@heyo-sh/heyo-status/next";
import { statusPage } from "../../../../heyo-status.config";

export const { GET, POST, PATCH, PUT, DELETE } = statusHandler(statusPage);
```

```ts
// Astro — src/pages/api/heyo-status/[...path].ts
import { statusHandler } from "@heyo-sh/heyo-status/astro";
// React Router — src/routes/api.heyo-status.$.ts
import { statusHandler } from "@heyo-sh/heyo-status/react-router";
```

Render the page with the bundled UI, and import the shared stylesheet once:

```tsx
import { StatusPage } from "@heyo-sh/heyo-status/ui";
import "@heyo-sh/heyo-status/theme/status.css";

const snapshot = await statusPage.api.getSnapshot();
<StatusPage
  basePath={statusPage.basePath}
  snapshot={snapshot}
  theme={statusPage.theme}
/>;
```

`title` identifies the page in metadata, feeds and notifications; it is not
shown as header or footer text. Set `branding.logo` for a logo-only header,
or add the optional `branding.name` to show a label beside the logo. If neither
is provided, the header has no brand label.

## Themes

| Theme   | Layout                                                              |
| ------- | ------------------------------------------------------------------- |
| `slate` | default: grouped cards, daily uptime bars, latency sparklines       |
| `fern`  | one uptime figure per service over a dense 90-day history           |
| `onyx`  | global banner, flat component list, dated incident timeline         |
| `dune`  | a directory of service categories with per-subcomponent status rows |
| `reed`  | minimal: a narrow single column, no cards, no badges, no groups     |

`theme` is the only switch. Import `@heyo-sh/heyo-status/theme/status.css`
once; it contains every bundled theme's tokens, scoped to the page's
`data-theme` attribute. Changing `theme` later does not change the import.

## Databases

| Adapter                                    | Use for                          |
| ------------------------------------------ | -------------------------------- |
| `sqlite()` from `@heyo-sh/heyo-status/db`  | local and self-hosted Bun / Node |
| `d1()` from `.../deployments/cloudflare`   | Cloudflare Workers               |
| `postgres()` from `.../deployments/vercel` | Vercel, Neon, Supabase           |

TCP and TLS monitoring on Node needs Node.js 20.19+ (or Bun 1.4.3+ for
local CLI checks); Cloudflare Workers do not expose native TCP/TLS modules.

Wrap an adapter that needs a per-request binding or a deployment secret in
`lazyStatusDatabase()` so it is constructed on the first query instead of at
import time.

## Documentation

- [Quickstart, configuration, deployment and UI customisation](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/README.md)
- [HTTP API](https://github.com/heyo-sh/heyo-docs/blob/main/docs/heyo-status/api.md)

MIT
