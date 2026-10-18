import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [cloudflareDevProxy(), reactRouter()],
  resolve: { dedupe: ["react", "react-dom"] },
  ssr: {
    /*
     * The status page is React components from `@heyo-sh/heyo-status/ui`,
     * which render through heyo-ui and Base UI. Vite's dev SSR externalises
     * dependencies by default, so those packages were loaded by Node rather
     * than by Vite — and Node resolved `react` through their own
     * `node_modules` while the renderer used the copy Vite had deduped. Two
     * module instances of the same file means two hook dispatchers, and every
     * request died on `Cannot read properties of null (reading 'useRef')`
     * inside the first Base UI button.
     *
     * `resolve.dedupe` cannot fix that: it only governs what Vite resolves,
     * and an externalised module never asks Vite. Inlining the component
     * packages is what puts them on Vite's module graph, where the deduped
     * React is the only one there is. `@base-ui/*` covers the transitive
     * `@base-ui/utils`, which is where the failure actually surfaced.
     *
     * The list stays narrow on purpose. `noExternal: true` in dev pulls
     * CommonJS dependencies such as `cookie` and React's own `jsx-dev-runtime`
     * into Vite's ESM evaluator, which has no `module`/`exports` to give them.
     * A production Worker has no Node resolution to fall back on, so the build
     * still bundles everything.
     */
    noExternal: command === "build" ? true : [/^@base-ui\//, /^@heyo-sh\//],
  },
}));
