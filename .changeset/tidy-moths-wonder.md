---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Pin the footer to the bottom of the viewport and ship a worked set of example
monitors.

- **The footer floated mid-page.** The page shell asked for `min-h-full`, but
  nothing requires the embedding application to give `html`/`body` a height,
  and a percentage minimum against an auto-height parent resolves to nothing.
  The footer's `mt-auto` therefore had no free space to claim, so a page with
  only a couple of monitors ended with the footer hanging under the last card.
  The shell now uses `min-h-screen`, which needs no cooperation from the host
  document.
- **The footer credit now reads "Powered by heyo" and links to
  `https://heyo.sh`.**
- **Generated projects start with a realistic page.** A new project used to
  come with two bare HTTP monitors, which left nothing to look at: no groups,
  no second monitor type, no aggregate. The templates now configure grouped
  Web and API services, a DNS check and a composite rolling them up, with a
  body assertion and a soft retry shown in place. They all point at
  `example.com`, so the first check is green and the page renders the way a
  working deployment does. `ssl` and `tcp` are included as commented examples,
  with a note that they need `node:tls`/`node:net` and so do not run on
  Cloudflare Workers.
