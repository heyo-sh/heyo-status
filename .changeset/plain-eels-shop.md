---
"@heyo-sh/heyo-status": patch
---

Stop bundling Hono into the published build.

`hono` is declared as a runtime dependency, so every install already fetched it,
yet the build inlined a second copy into `api.js`, `cli.js`, `config.js` and
`index.js`. Installations carried five copies of the router, a Hono security
release could only reach users through a republished package, and a project
that already used Hono loaded two versions of it. The router is now external,
like `zod` and `drizzle-orm`, which removes about 78 KB from the package and
lets the declared semver range resolve as intended.
