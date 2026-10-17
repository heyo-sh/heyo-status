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

  test("React Router packages share one major across examples and scaffolds", async () => {
    const manifests = [
      "react-router-cloudflare/package.json",
      "react-router-vercel/package.json",
      "../packages/create-heyo-status/templates/react-router/package.json",
      "../packages/create-heyo-status/deployments/cloudflare/react-router/package.json",
    ];
    const majors = new Set<number>();

    for (const manifest of manifests) {
      const { dependencies } = JSON.parse(
        await readFile(join(root, manifest), "utf8"),
      ) as { dependencies: Record<string, string> };
      for (const [name, version] of Object.entries(dependencies)) {
        if (name === "react-router" || name.startsWith("@react-router/")) {
          const major = Number(/^\^(\d+)/.exec(version)?.[1]);
          expect(Number.isInteger(major)).toBe(true);
          majors.add(major);
        }
      }
    }

    expect(majors.size).toBe(1);
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

  test.each(["next-cloudflare", "astro-cloudflare", "react-router-cloudflare"])(
    "%s reads the management token from the Worker binding",
    async (name) => {
      const source = await readFile(join(root, name, configPath), "utf8");
      expect(source).toContain("adminToken: env.HEYO_STATUS_API_TOKEN");
    },
  );

  test("provides .dev.vars to every D1 example in the smoke harness", async () => {
    const source = await readFile(join(root, "../scripts/examples.ts"), "utf8");
    expect(source).toContain('if (example.database === "d1")');
    expect(source).toContain(
      'writeFile(localVars, `HEYO_STATUS_API_TOKEN="${adminToken}"\\n`)',
    );
  });

  test.each(examples)(
    "$name is written without any",
    async ({ name, page }) => {
      const source = await readFile(join(root, name, page), "utf8");
      expect(source).not.toMatch(/\bany\b/);
    },
  );
});
