---
"@heyo-sh/heyo-status": patch
---

Show the bundled Heyo mark in dark mode. The header logo was inverted with `filter: invert(light-dark(0, 1))`, but `light-dark()` resolves to a colour rather than the number `invert()` takes, so browsers dropped the declaration and the near-black mark stayed invisible on a dark canvas. The amount now comes from `--status-logo-invert`, driven by the `data-mode` attribute the theme toggle writes and falling back to `prefers-color-scheme` in system mode.
