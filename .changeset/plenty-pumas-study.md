---
"@heyo-sh/heyo-status": minor
"@heyo-sh/create-heyo-status": minor
---

Rename the entry point to `heyoStatus()` and ship four real themes.

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
