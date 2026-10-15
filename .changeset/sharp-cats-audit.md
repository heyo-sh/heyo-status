---
"@heyo-sh/heyo-status": patch
"@heyo-sh/create-heyo-status": patch
---

Harden public subscription responses, forward migrations from deferred database adapters, and keep Cloudflare-safe database imports out of Worker bundles. Make generated Cloudflare projects build, migrate and boot with `bun dev`; exclude the Next.js Worker from pre-OpenNext typechecking and keep Astro's server bundle out of public assets. Pin the verified Next.js release for the generated Worker, upgrade Astro and its deployment adapters to patched releases, and select patched transitive dependencies in generated projects. Use Bun 1.4.3's parent-scoped overrides to replace vulnerable `path-to-regexp` in Astro/Vercel's routing utilities and the generated Vercel CLI without changing Express's incompatible version.
