---
"@heyo-sh/heyo-status": minor
"@heyo-sh/create-heyo-status": minor
---

Rebuild the status page on heyo-ui.

The page used to carry its own design system: a 1,068-line stylesheet, a private
set of shadcn-ish tokens, and hand-written markup for cards, badges, bars,
timelines and a modal. It is now assembled from `@heyo-sh/heyo-ui` components —
`Card`, `Badge`, `Button`, `StatusBar`, `StatusDot`, `Meter`, `Timeline`,
`Empty`, `Dialog`, `Tabs`, `Input`, `Separator` — on that library's semantic
tokens, so a status page looks like the rest of the platform and inherits its
accessibility and colour-mode work instead of re-implementing them.

- **Colour mode is now `data-mode` on `<html>`,** not a `.dark` class. heyo-ui
  resolves both palettes from one set of tokens through `light-dark()`, which
  reads `color-scheme`, which `data-mode` sets. `statusThemeBootstrapScript()`
  and `DarkModeToggle` write the attribute, and system mode removes it instead
  of freezing today's preference into the document.
- **`colors.primary` / `colors.secondary` now map to the heyo-ui brand tokens**
  (`--color-heyo-brand` and its tint) rather than `--primary` / `--secondary`.
  Only those two move; every surface, edge and status colour still comes from
  the design system, so an override cannot produce unreadable text.
- **The stylesheet shrank from 1,068 lines to 50.** It imports Tailwind and the
  heyo-ui tokens, registers the compiled components as a Tailwind source — which
  Tailwind otherwise skips inside `node_modules` — and declares the four status
  colours. `minimal.css` is now a radius scale rather than a second stylesheet.
- **Every region exposes a `data-slot`** (`status-page`, `status-header`,
  `status-overall`, `status-monitor`, `status-monitor-group`, `status-footer`),
  which replaces the old `heyo-*` class names as the way to restyle the page
  from a project.
- **`SubscribeDialog` moved to `@heyo-sh/heyo-status/ui/subscribe-dialog`** and
  is loaded on demand. A modal, tabs and a form are around 95 KB of component
  code; re-exporting it from `/ui` pinned all of it into the first chunk of
  every status page. Splitting it took the client bundle for the page itself
  from 169 KB to 73 KB, and the dialog now downloads when a visitor asks to
  subscribe.

Monitor groups and incidents remain native `<details>` disclosures rather than
the library's `Accordion`: a status page has to stay readable when the
JavaScript bundle fails, which is exactly when people come looking for it.
