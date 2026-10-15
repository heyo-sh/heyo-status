# Theme architecture

`ui/primitives.tsx` contains the reusable status-page experience: the header,
the overall-status card and banner, monitor cards and groups, the uptime
meters, the incident timeline, the maintenance list and the footer. These
components read heyo-ui tokens and must not import a concrete theme.

`theme/<name>` contains only the theme itself: how a page is composed from
those components and which of them it uses. A theme may lead with a banner or
a card, group monitors into tables or cards, and put incidents above or below
the services — it may not fork data loading, colour mode, or the subscribe
dialog, all of which belong to the shell in `ui/status-page.tsx`.

`status.css` holds the CSS tokens of _every_ theme, each block scoped to the
`data-theme` attribute `StatusShell` publishes. They used to live at `:root`
in five separate stylesheets, which quietly split one decision in two: the
configured `theme` chose the layout while the _imported_ stylesheet chose the
width and the radius scale. Changing `theme` moved the layout and left the
width behind, and nothing anywhere said so. One attribute, one source of
truth. Import `theme/status.css` once; the older `theme/<name>.css` paths remain
aliases for compatibility.

`names.ts` is the dependency-free list of bundled themes. Add a name there and
its implementation to `registry.ts` together. Keeping the list free of React
imports means config validation never has to load a theme implementation.

## Adding a theme

1. Create `src/theme/<name>/index.tsx` exporting a `HeyoStatusTheme` whose
   `name` is `<name>`, and `src/theme/<name>/global.css` importing
   `../status.css` for the backwards-compatible named alias. The public import
   path is `theme/status.css`. Add the theme's tokens in a
   `[data-theme="<name>"]` block in `status.css`, never at `:root` in the
   theme's own stylesheet — a token only that stylesheet carries is a token
   that does not follow the configuration.
2. Compose `ui/primitives`. Write a new component only for a genuine layout
   difference, and keep it inside the theme directory.
3. Register the name in `names.ts` and the implementation in `registry.ts`.
   `satisfies Record<StatusThemeName, HeyoStatusTheme>` keeps the two in sync.
4. Keep the contract: render `StatusShell` so the page publishes
   `data-slot="status-page"` and `data-theme`, keep `data-slot` on monitors and
   the overall status, and keep the `#incident-<id>` anchor the RSS and Atom
   feeds link to. `test/ui.test.tsx` asserts all of it for every registered
   name.
5. Add the theme to the generator's `themes` list, to the legacy
   `./theme/<name>.css` export in `package.json`, to the theme tables in the
   READMEs, and to one example so the smoke harness renders it.

## Looking at them

`bun run theme:preview` renders every registered theme to
`.heyo-playground/themes/<name>.html` from one fabricated snapshot — fixed
dates, seeded history and a monitor in each state — using the published
stylesheet rather than the source one. Pass names to narrow it and `--dark` for
the other colour mode.

A layout is only reviewable by looking at it, and the alternative is booting an
example, which pins one theme per project and needs a database first. Two runs
are byte-identical, so a diff in the output is a diff in the theme.
