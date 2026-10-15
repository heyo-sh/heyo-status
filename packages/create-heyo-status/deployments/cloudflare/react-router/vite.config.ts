import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [cloudflareDevProxy(), reactRouter()],
  resolve: { dedupe: ["react", "react-dom"] },
  // Production Workers must bundle the renderer and heyo-ui with one React.
  // In dev, Vite must still prebundle React's CommonJS modules itself.
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
}));
