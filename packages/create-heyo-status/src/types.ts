export type Template = "react-router" | "next" | "astro";
export type Deployment = "cloudflare" | "vercel" | "later";
export type Database = "sqlite" | "d1" | "postgres";
/**
 * Themes bundled with `@heyo-sh/heyo-status`, in the order they are offered.
 * Keep in sync with `builtInStatusThemeNames` in the runtime package.
 */
export const themes = ["slate", "fern", "onyx", "dune", "reed"] as const;

export type Theme = (typeof themes)[number];
export type PackageManager = "bun" | "pnpm" | "npm" | "yarn";

export interface CreateOptions {
  projectName: string;
  template: Template;
  deployment: Deployment;
  database: Database;
  theme: Theme;
  packageManager: PackageManager;
  install: boolean;
  cwd?: string;
  /** Override used by integration tests and local package consumers. */
  heyoStatusVersion?: string;
}

/**
 * Databases each deployment target can actually run.
 *
 * Cloudflare Workers have no filesystem and no `bun:sqlite`/`node:sqlite`, and
 * the overlay binds `env.DB` to D1. Vercel functions have an ephemeral,
 * read-only filesystem and no D1 binding at all. Offering the other
 * combinations produced projects that threw on their first request, so the
 * matrix is enforced instead of documented.
 */
export const deploymentDatabases: Record<Deployment, readonly Database[]> = {
  cloudflare: ["d1"],
  vercel: ["postgres"],
  // Without a Worker deployment overlay there is no request-scoped D1 binding.
  later: ["sqlite", "postgres"],
};

/** The database preselected for a deployment target. */
export function defaultDatabaseFor(deployment: Deployment): Database {
  return deploymentDatabases[deployment][0]!;
}

/** Returns why a database cannot be used with a deployment, or undefined. */
export function deploymentDatabaseError(
  deployment: Deployment,
  database: Database,
): string | undefined {
  const supported = deploymentDatabases[deployment];
  if (supported.includes(database)) return undefined;
  return `The ${database} database cannot run on ${deployment}. Use ${supported.join(" or ")}.`;
}

export interface DetectedPackageManager {
  name: PackageManager;
  version?: string;
}
