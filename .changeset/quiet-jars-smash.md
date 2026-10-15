---
"@heyo-sh/heyo-status": patch
---

Harden public subscriptions, make record ordering deterministic and stop a
per-monitor query on every check run.

- **Public webhook subscriptions could reach the deployment's own network.**
  `POST /subscribers` accepted any HTTP(S) URL, so an anonymous visitor could
  point a subscription at `127.0.0.1`, a private range or the cloud metadata
  address and turn the status page into a request-forgery proxy. Destinations
  that are not publicly routable are now rejected, along with URLs carrying
  credentials.
- **Nothing stopped two concurrent subscriptions for one destination.** The API
  de-duplicates before inserting, but both requests passed that check together.
  A new migration adds a unique index on `subscribers(type, target)`, and the
  request that loses the race reports the winner's subscription instead of an
  error. Existing duplicates are collapsed when the migration runs.
- **Records written in the same millisecond were ordered arbitrarily.** Every
  list uses its identifier as the tie-breaker of a timestamp column, and one
  check run routinely opens several incidents at once, so an incident list or a
  feed could publish the newer record first. Identifiers are now time-sortable
  and monotonic, including across a clock that steps backwards.
- **A check run read the full retained history once per monitor.** Transition
  detection and automatic-incident reconciliation now share one history read
  per run instead of one per monitor.
- **The subscribe dialog claimed `aria-modal` without honouring it.** Focus
  stayed behind the dialog, Tab walked out into content the visitor could not
  reach, and Escape did nothing. It now takes focus, traps it, closes on Escape
  and restores focus to whatever opened it.
