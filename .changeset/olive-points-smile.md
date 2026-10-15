---
"@heyo-sh/heyo-status": minor
"@heyo-sh/create-heyo-status": minor
---

Make `theme` the only thing that selects a theme, add the `reed` theme,
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
