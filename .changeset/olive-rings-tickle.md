---
"@heyo-sh/heyo-status": patch
---

Fix the latency sparkline, which was drawn wrong wherever a theme shows it —
in the bundled themes that is only `slate`, because it is the one that renders
`MonitorCard`.

- The horizontal axis is time instead of the index in the array. Empty buckets
  are omitted from `latencySeries` rather than reported as zero latency, so
  even spacing drew an eleven-hour gap as the same step as a one-hour bucket
  and the line told a story the data did not support.
- The newest reading is drawn as a zero-length round-capped stroke instead of a
  `<circle>`. The chart is stretched to the card width with
  `preserveAspectRatio="none"`, which scales a circle's geometry on each axis
  independently and rendered the marker as a flat ellipse several times wider
  than it was tall.
- Hover targets tile the full width, each reaching halfway to its neighbours.
  They were fixed-width bands centred on every point, which left dead gaps
  between them, and once the spacing stopped being uniform most of a bucket's
  column no longer showed its tooltip.
