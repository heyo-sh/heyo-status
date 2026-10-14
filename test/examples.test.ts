import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The examples are the reference deployments people copy, and nothing else in
 * the pipeline reads them: they are excluded from knip and only two of them
 * have a tsconfig. They have already drifted once, when the Cloudflare
 * projects kept rendering without the colour-mode wiring every other surface
 * had gained. These checks keep the six projects equivalent.
 */
const examples = [
  {
    name: "react-router-cloudflare",
    page: "src/routes/_index.tsx",
    document: "src/root.tsx",
  },
  {
    name: "react-router-vercel",
    page: "src/routes/_index.tsx",
    document: "src/root.tsx",
  },
  { name: "next-cloudflare", page: "app/page.tsx", document: "app/layout.tsx" },
  { name: "next-vercel", page: "app/page.tsx", document: "app/layout.tsx" },
  {
    name: "astro-cloudflare",
    page: "src/pages/index.astro",
    document: "src/pages/index.astro",
  },
  {
    name: "astro-vercel",
    page: "src/pages/index.astro",
    document: "src/pages/index.astro",
  },
];

/** Options that do nothing unless a page forwards them to `<StatusPage />`. */
const forwardedProps = [
  "basePath",
  "branding",
  "colors",
  "metrics",
  "mode",
  "snapshot",
  "subscribersEnabled",
  "subscriberMethods",
  "theme",
  "title",
];

const root = join(import.meta.dirname, "..", "examples");

/** Every project keeps its definition at the one documented path. */
const configPath = "heyo-status.config.ts";

describe("deployment examples", () => {
  test("React Router Workers use the Worker handler, not the Pages handler", async () => {
    for (const worker of [
      join(root, "react-router-cloudflare/src/status-worker.ts"),
      join(
        root,
        "../packages/create-heyo-status/deployments/cloudflare/react-router/src/status-worker.ts",
      ),
    ]) {
      const source = await readFile(worker, "utf8");
      expect(source).toContain("createRequestHandler");
      expect(source).not.toContain("createPagesFunctionHandler");
    }
  });

  test.each(examples)(
    "$name forwards every configured presentation option",
    async ({ name, page }) => {
      const source = await readFile(join(root, name, page), "utf8");
      const missing = forwardedProps.filter(
        (property) => !source.includes(`${property}=`),
      );
      expect({ name, missing }).toEqual({ name, missing: [] });
    },
  );

  test.each(examples)(
    "$name applies the colour mode before first paint",
    async ({ name, document }) => {
      const source = await readFile(join(root, name, document), "utf8");
      expect(source).toContain("statusThemeBootstrapScript");
    },
  );

  test.each(examples)(
    "$name declares its page in heyo-status.config.ts",
    async ({ name }) => {
      const source = await readFile(join(root, name, configPath), "utf8");
      expect(source).toContain("heyoStatus(");
    },
  );

  test.each(examples)(
    "$name does not ship a hard-coded management token",
    async ({ name }) => {
      const source = await readFile(join(root, name, configPath), "utf8");
      expect(source).not.toMatch(/adminToken:\s*["'`]/);
    },
  );

  test.each(examples)(
    "$name is written without any",
    async ({ name, page }) => {
      const source = await readFile(join(root, name, page), "utf8");
      expect(source).not.toMatch(/\bany\b/);
    },
  );
});
