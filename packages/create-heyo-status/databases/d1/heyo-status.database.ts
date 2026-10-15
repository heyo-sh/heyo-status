import { lazyStatusDatabase } from "@heyo-sh/heyo-status/db/lazy";
import {
  d1,
  type D1Database,
} from "@heyo-sh/heyo-status/deployments/cloudflare";

/**
 * The Cloudflare overlay publishes the request's D1 binding here before the
 * framework handles it. Resolution is deferred to the first query, so importing
 * this configuration outside a Worker — a framework dev server, `next build`,
 * or the `heyo-status` CLI — never crashes the process.
 *
 * There is no local fallback on purpose: a standalone dev command cannot
 * manufacture a Cloudflare binding, and silently writing somewhere else would
 * hide the fact that the deployed database was never touched. Use
 * `wrangler dev` for a local D1 binding.
 */
export const database = lazyStatusDatabase(() => {
  const binding = (
    globalThis as typeof globalThis & {
      HEYO_STATUS_D1?: D1Database;
    }
  ).HEYO_STATUS_D1;

  if (!binding) {
    throw new Error(
      "Cloudflare D1 is not bound. Run this project with wrangler (`bun run start` or `bun run deploy`); a standalone dev server has no Cloudflare binding.",
    );
  }
  return d1(binding);
});
