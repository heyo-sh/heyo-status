import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: vercel(),
  // The status API is a bearer-token JSON API with no cookie or session
  // authority, so Astro's form-origin check only blocks legitimate clients:
  // it rejects every DELETE without a JSON content-type and the unsubscribe
  // confirmation form.
  security: { checkOrigin: false },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
