---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Resolve TCP and TLS modules through the native runtime so framework bundlers do not replace Node sockets with browser shims or emit dynamic-import warnings. Keep Astro/Cloudflare and React Router/Cloudflare renderers on one React instance in generated projects, and require Node versions with the native builtin-module API for Node deployments.
