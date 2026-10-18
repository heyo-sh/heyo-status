import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  // The status API is a bearer-token JSON API with no cookie or session
  // authority, so Astro's form-origin check only blocks legitimate clients:
  // it rejects every DELETE without a JSON content-type and the unsubscribe
  // confirmation form.
  security: { checkOrigin: false },
  integrations: [react()],
  // Prebundle the status UI with Astro's React renderer. Otherwise Vite can
  // discover heyo-ui mid-request and briefly load two React instances.
  vite: {
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: {
      include: [
        "@heyo-sh/heyo-ui",
        "@heyo-sh/heyo-status/ui",
        "@heyo-sh/heyo-status/theme/script",
      ],
    },
    ssr: { noExternal: [/^@heyo-sh\//, /^@base-ui\//] },
  },
});
