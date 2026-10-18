import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArguments } from "../src";
import { projectNameError } from "../src/project-name";
import { scaffoldProject } from "../src/scaffold";

const temporaryDirectories: string[] = [];
const templates = ["react-router", "next", "astro"] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("create-heyo-status", () => {
  test("parses the documented non-interactive flags", () => {
    expect(
      parseArguments([
        "my-status-page",
        "--template=next",
        "--theme",
        "onyx",
        "--deployment",
        "vercel",
        "--database",
        "postgres",
        "--package-manager",
        "bun",
        "--no-install",
      ]),
    ).toMatchObject({
      interactive: false,
      showHelp: false,
      options: {
        projectName: "my-status-page",
        template: "next",
        theme: "onyx",
        deployment: "vercel",
        database: "postgres",
        packageManager: "bun",
        install: false,
      },
    });
  });

  /**
   * The documented quickstart passes a project name and then answers prompts.
   * A bare name used to disable them, so the framework, deployment and database
   * were chosen silently.
   */
  test("treats a project name as one answer, not as a full non-interactive run", () => {
    expect(parseArguments(["my-status-page"])).toMatchObject({
      interactive: true,
      options: { projectName: "my-status-page" },
    });
    expect(parseArguments([])).toMatchObject({ interactive: true });
    expect(parseArguments(["my-status-page", "--template=next"])).toMatchObject(
      { interactive: false },
    );
  });

  test("validates a project name before creating files", () => {
    expect(projectNameError("my-status-page")).toBeUndefined();
    expect(projectNameError("../outside")).toBe(
      "Use letters, numbers and hyphens only.",
    );
  });

  test("scaffolds every framework with a runnable local SQLite starter", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `status-${template}`,
        template,
        theme: "slate",
        deployment: "later",
        database: "sqlite",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const packageJson = JSON.parse(
        await readFile(join(projectPath, "package.json"), "utf8"),
      ) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      const config = await readFile(
        join(projectPath, "heyo-status.config.ts"),
        "utf8",
      );

      expect(packageJson.dependencies["@heyo-sh/heyo-status"]).toBe("latest");
      expect(packageJson.scripts.dev).toContain("heyo-status dev");
      expect(packageJson.scripts["db:seed"]).toContain("--uptime 99.95");
      expect(config).toContain('name: "Website"');
      expect(config).toContain('theme: "slate"');
      expect(config).toContain(
        'export const database = sqlite("status.sqlite")',
      );
      expect(config).not.toContain("heyo-status.database");
      expect(
        await Bun.file(join(projectPath, "heyo-status.database.ts")).exists(),
      ).toBe(false);
      expect(await Bun.file(join(projectPath, ".env.example")).exists()).toBe(
        false,
      );
      expect(config).toContain("// adminToken:");
      expect(config).not.toContain("process.env");
      expect(config).not.toContain("telemetry:");
      expect(config).toContain('branding: { logo: "/heyo.svg" }');
      const logo = await readFile(join(projectPath, "public/heyo.svg"), "utf8");
      expect(logo).toContain('viewBox="0 0 2408 2402"');
      const page = await readFile(
        join(
          projectPath,
          template === "next"
            ? "app/layout.tsx"
            : template === "astro"
              ? "src/pages/index.astro"
              : "src/routes/_index.tsx",
        ),
        "utf8",
      );
      expect(page).toContain("statusPage.title");
    }
  });

  // `mode` and `colors` are documented configuration, and the bootstrap script
  // is what stops a dark page from flashing light before hydration. Both were
  // silently dropped by every template before this was covered.
  test("passes the configured colour mode and brand colours to the UI", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const views: Record<(typeof templates)[number], [string, string]> = {
      "react-router": ["src/routes/_index.tsx", "src/root.tsx"],
      next: ["app/page.tsx", "app/layout.tsx"],
      astro: ["src/pages/index.astro", "src/pages/index.astro"],
    };

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `themed-${template}`,
        template,
        theme: "slate",
        deployment: "later",
        database: "sqlite",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const [viewPath, documentPath] = views[template];
      const view = await readFile(join(projectPath, viewPath), "utf8");
      const document = await readFile(join(projectPath, documentPath), "utf8");

      expect(view).toContain("mode={");
      expect(view).toContain("colors={");
      expect(document).toContain("statusThemeBootstrapScript");
    }
  });

  /**
   * A theme is two coupled choices: the layout the page renders and the
   * stylesheet it loads. A project that configures one and imports the other
   * looks broken in a way no type checker can catch.
   */
  test("wires the chosen theme to both its layout and its stylesheet", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const documents: Record<(typeof templates)[number], string> = {
      "react-router": "src/root.tsx",
      next: "app/layout.tsx",
      astro: "src/pages/index.astro",
    };

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `fern-${template}`,
        template,
        theme: "fern",
        deployment: "later",
        database: "sqlite",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const config = await readFile(
        join(projectPath, "heyo-status.config.ts"),
        "utf8",
      );
      const document = await readFile(
        join(projectPath, documents[template]),
        "utf8",
      );
      const view = await readFile(
        join(
          projectPath,
          template === "next"
            ? "app/page.tsx"
            : template === "astro"
              ? "src/pages/index.astro"
              : "src/routes/_index.tsx",
        ),
        "utf8",
      );

      expect(config).toContain('theme: "fern"');
      expect(document).toContain("@heyo-sh/heyo-status/theme/status.css");
      // Without this prop the configured theme styles a page the default
      // layout rendered.
      expect(view).toContain("theme={");
    }
  });

  // Astro renders React components to static markup unless an island is
  // requested, which leaves the colour-mode toggle and subscribe dialog inert.
  test("hydrates the Astro status page", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const { projectPath } = await scaffoldProject({
      projectName: "status-astro-island",
      template: "astro",
      theme: "slate",
      deployment: "later",
      database: "sqlite",
      packageManager: "bun",
      install: false,
      cwd,
    });

    const page = await readFile(
      join(projectPath, "src/pages/index.astro"),
      "utf8",
    );
    expect(page).toContain("client:load");

    // Astro's form-origin check rejects every DELETE without a JSON content
    // type and the unsubscribe confirmation form, none of which is a CSRF risk
    // for a bearer-token API.
    const astroConfig = await readFile(
      join(projectPath, "astro.config.mjs"),
      "utf8",
    );
    expect(astroConfig).toContain("checkOrigin: false");
    // Astro 7 uses Vite 8: its CSS import handling needs the Tailwind Vite
    // plugin rather than the PostCSS-only setup used by other frameworks.
    expect(astroConfig).toContain("@tailwindcss/vite");
  });

  // Tailwind compiles the bundled theme; without the PostCSS plugin the
  // `@apply` rules that colour the page ship unprocessed and browsers drop them.
  test("gives every template a Tailwind build step", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `styled-${template}`,
        template,
        theme: "slate",
        deployment: "later",
        database: "sqlite",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const postcss = await readFile(
        join(projectPath, "postcss.config.mjs"),
        "utf8",
      );
      const packageJson = JSON.parse(
        await readFile(join(projectPath, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };

      expect(postcss).toContain("@tailwindcss/postcss");
      expect(packageJson.dependencies["@tailwindcss/postcss"]).toBeDefined();
    }
  });

  /**
   * Workers cannot open an embedded SQLite file and Vercel has no D1 binding,
   * so these projects used to be generated and then throw on first request.
   */
  test("refuses databases the chosen deployment cannot run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);

    await expect(
      scaffoldProject({
        projectName: "status-broken",
        template: "next",
        theme: "slate",
        deployment: "cloudflare",
        database: "sqlite",
        packageManager: "bun",
        install: false,
        cwd,
      }),
    ).rejects.toThrow("The sqlite database cannot run on cloudflare. Use d1.");
    await expect(
      scaffoldProject({
        projectName: "status-broken",
        template: "next",
        theme: "slate",
        deployment: "vercel",
        database: "d1",
        packageManager: "bun",
        install: false,
        cwd,
      }),
    ).rejects.toThrow("The d1 database cannot run on vercel. Use postgres.");
    await expect(
      scaffoldProject({
        projectName: "status-broken",
        template: "next",
        theme: "slate",
        deployment: "later",
        database: "d1",
        packageManager: "bun",
        install: false,
        cwd,
      }),
    ).rejects.toThrow("The d1 database cannot run on later.");
    // A rejected combination must not leave a half-written project behind.
    expect(await Bun.file(join(cwd, "status-broken")).exists()).toBe(false);
  });

  test("defaults the database to the one its deployment target supports", () => {
    expect(
      parseArguments(["s", "--deployment=cloudflare"]).options,
    ).toMatchObject({ deployment: "cloudflare", database: "d1" });
    expect(parseArguments(["s", "--deployment=vercel"]).options).toMatchObject({
      deployment: "vercel",
      database: "postgres",
    });
    expect(parseArguments(["s"]).options).toMatchObject({
      deployment: "later",
      database: "sqlite",
    });
  });

  test("applies Cloudflare D1 overlays and replaces package placeholders", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const { projectPath } = await scaffoldProject({
      projectName: "status-cf",
      template: "astro",
      theme: "dune",
      deployment: "cloudflare",
      database: "d1",
      packageManager: "bun",
      install: false,
      cwd,
    });
    const packageJson = JSON.parse(
      await readFile(join(projectPath, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(await Bun.file(join(projectPath, "wrangler.jsonc")).exists()).toBe(
      true,
    );
    expect(
      await Bun.file(join(projectPath, "migrations/0000_initial.sql")).exists(),
    ).toBe(true);
    expect(packageJson.scripts["db:migrate"]).toBe(
      "wrangler d1 migrations apply status-cf --local",
    );
    expect(packageJson.scripts.deploy).toContain("wrangler deploy");
  });

  /**
   * A D1 binding only exists inside a Worker, so the scripts that drive the
   * database from a standalone process cannot work on Cloudflare. They used to
   * be generated anyway and every one of them crashed on the first import.
   */
  test("only offers Cloudflare scripts a Worker binding can serve", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `cf-${template}`,
        template,
        theme: "slate",
        deployment: "cloudflare",
        database: "d1",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const packageJson = JSON.parse(
        await readFile(join(projectPath, "package.json"), "utf8"),
      ) as {
        dependencies: Record<string, string>;
        overrides: Record<string, string>;
        engines?: { node: string };
        scripts: Record<string, string>;
      };

      expect(packageJson.overrides["sharp"]).toBe("0.35.5");
      expect(packageJson.overrides["source-map-js"]).toBe("1.2.2");
      expect(packageJson.scripts.dev).not.toContain("heyo-status");
      expect(packageJson.scripts.dev).toContain("db:migrate");
      expect(packageJson.scripts.dev).toBe(
        `bun run db:migrate && ${template === "react-router" ? "react-router" : template} dev`,
      );
      expect(packageJson.scripts.start).toContain("wrangler dev");
      if (template === "react-router") {
        for (const route of [
          "src/root.tsx",
          "src/routes/_index.tsx",
          "src/routes/api.heyo-status.$.ts",
        ]) {
          const source = await readFile(join(projectPath, route), "utf8");
          expect(source).toContain("context.cloudflare.env.DB");
        }
        const vite = await readFile(
          join(projectPath, "vite.config.ts"),
          "utf8",
        );
        expect(vite).toContain("cloudflareDevProxy()");
        const entry = await readFile(
          join(projectPath, "src/entry.server.tsx"),
          "utf8",
        );
        expect(entry).toContain("renderToReadableStream");
      }
      if (template === "astro") {
        const page = await readFile(
          join(projectPath, "src/pages/index.astro"),
          "utf8",
        );
        expect(page).toContain("requestStatusPage()");
        const binding = await readFile(
          join(projectPath, "cloudflare-status-page.ts"),
          "utf8",
        );
        expect(binding).toContain('from "cloudflare:workers"');
        const astroConfig = await readFile(
          join(projectPath, "astro.config.mjs"),
          "utf8",
        );
        expect(astroConfig).toContain("ssr: { noExternal:");
        expect(astroConfig).toContain("@heyo-sh/heyo-status/theme/script");
      }
      if (template === "next") {
        const nextConfig = await readFile(
          join(projectPath, "next.config.mjs"),
          "utf8",
        );
        expect(nextConfig).toContain("initOpenNextCloudflareForDev()");
        const binding = await readFile(
          join(projectPath, "cloudflare-status-page.ts"),
          "utf8",
        );
        expect(binding).toContain("getCloudflareContext({ async: true })");
      }
      expect(packageJson.scripts.check).toBeUndefined();
      expect(packageJson.scripts["db:seed"]).toBeUndefined();
      const config = await readFile(
        join(projectPath, "heyo-status.config.ts"),
        "utf8",
      );
      expect(config).toContain("lazyStatusDatabase");
      expect(config).toContain("HEYO_STATUS_D1");
      expect(config).not.toContain("DATABASE_SETUP");
      expect(
        await Bun.file(join(projectPath, "heyo-status.database.ts")).exists(),
      ).toBe(false);
      // The Node adapter cannot build a Worker, so the overlay has to remove it.
      expect(packageJson.dependencies["@astrojs/node"]).toBeUndefined();
      if (template === "astro") {
        expect(packageJson.engines?.node).toBe(">=22.12.0");
        // Wrangler otherwise uploads Astro's server-side _worker.js as a
        // public asset and refuses the deployment.
        expect(
          await readFile(join(projectPath, "public/.assetsignore"), "utf8"),
        ).toContain("_worker.js");
        const worker = await readFile(
          join(projectPath, "src/status-worker.ts"),
          "utf8",
        );
        expect(worker).toContain("@astrojs/cloudflare/entrypoints/server");
      }
      if (template === "next") {
        // Next typechecks before OpenNext creates the Worker entry it imports.
        const tsconfig = JSON.parse(
          await readFile(join(projectPath, "tsconfig.json"), "utf8"),
        ) as { exclude: string[] };
        expect(tsconfig.exclude).toContain("worker");
        // A newer Next minor has broken OpenNext Worker startup despite a
        // successful `next build`; upgrade only after testing the Worker.
        expect(packageJson.dependencies.next).toBe("16.3.8");
      }
    }
  });

  /**
   * The configuration is a module-level value. A database that needs a request
   * binding or a deployment secret must not throw while it is being imported,
   * or a missing value takes down the framework process instead of one route.
   */
  test("defers platform database construction to the first query", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const cloudflare = await scaffoldProject({
      projectName: "lazy-cf",
      template: "next",
      theme: "slate",
      deployment: "cloudflare",
      database: "d1",
      packageManager: "bun",
      install: false,
      cwd,
    });
    const vercel = await scaffoldProject({
      projectName: "lazy-vercel",
      template: "next",
      theme: "slate",
      deployment: "vercel",
      database: "postgres",
      packageManager: "bun",
      install: false,
      cwd,
    });

    for (const { projectPath } of [cloudflare, vercel]) {
      const source = await readFile(
        join(projectPath, "heyo-status.config.ts"),
        "utf8",
      );
      expect(source).toContain("lazyStatusDatabase");
      expect(source).toContain('from "@heyo-sh/heyo-status/db/lazy"');
      expect(source).not.toContain("{{PROJECT_NAME}}");
      expect(
        await Bun.file(join(projectPath, "heyo-status.database.ts")).exists(),
      ).toBe(false);
    }
  });

  test("patches only Vercel's vulnerable routing dependencies", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);

    for (const template of templates) {
      const { projectPath } = await scaffoldProject({
        projectName: `secure-${template}`,
        template,
        theme: "slate",
        deployment: "vercel",
        database: "postgres",
        packageManager: "bun",
        install: false,
        cwd,
      });
      const packageJson = JSON.parse(
        await readFile(join(projectPath, "package.json"), "utf8"),
      ) as {
        devDependencies: Record<string, string>;
        overrides: Record<string, { "path-to-regexp": string }>;
        pnpm: { overrides: Record<string, string> };
        resolutions: Record<string, string>;
      };
      expect(packageJson.devDependencies.vercel).toBe("63.1.2");
      for (const name of ["@vercel/node", "@vercel/remix-builder"]) {
        expect(packageJson.overrides[name]?.["path-to-regexp"]).toBe("6.3.0");
        expect(packageJson.pnpm.overrides[`${name}>path-to-regexp`]).toBe(
          "6.3.0",
        );
        expect(packageJson.resolutions[`${name}/path-to-regexp`]).toBe("6.3.0");
      }
      expect(
        packageJson.overrides["@vercel/backends"]?.["path-to-regexp"],
      ).toBe("8.4.2");
      if (template === "astro") {
        expect(
          packageJson.overrides["@vercel/routing-utils"]?.["path-to-regexp"],
        ).toBe("6.3.0");
      } else {
        expect(packageJson.overrides["@vercel/routing-utils"]).toBeUndefined();
      }
    }
  });

  test("applies Vercel cron overlays", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "create-heyo-status-"));
    temporaryDirectories.push(cwd);
    const { projectPath } = await scaffoldProject({
      projectName: "status-vercel",
      template: "next",
      theme: "slate",
      deployment: "vercel",
      database: "postgres",
      packageManager: "bun",
      install: false,
      cwd,
    });

    const vercel = await readFile(join(projectPath, "vercel.json"), "utf8");
    const cronRoute = await readFile(
      join(projectPath, "app/api/cron/[task]/route.ts"),
      "utf8",
    );
    expect(vercel).toContain("/api/cron/checks");
    expect(cronRoute).toContain("vercelCronHandler(statusPage");
    expect(cronRoute).not.toContain("process.env");
    const adapter = await Bun.file(
      join(projectPath, "heyo-status.config.ts"),
    ).text();
    expect(adapter).toContain(
      "postgres://postgres:postgres@localhost:5432/status-vercel",
    );
    expect(adapter).not.toContain("process.env");
  });
});
