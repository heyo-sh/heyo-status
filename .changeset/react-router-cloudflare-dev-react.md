---
"@heyo-sh/create-heyo-status": patch
---

Render the status page in React Router + Cloudflare development. `cloudflareDevProxy` puts the renderer on Vite's module graph while leaving heyo-ui and Base UI externalised, so Node resolved a second `react` for them and every request failed with `Cannot read properties of null (reading 'useRef')` in the first Base UI button. The generated Vite configuration now inlines `@base-ui/*` and `@heyo-sh/*` in development, which is what makes the deduped React the only one in the graph.
