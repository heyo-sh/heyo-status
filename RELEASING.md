# Releasing Heyo Status

Packages are versioned with [Changesets](https://github.com/changesets/changesets)
and published only by GitHub Actions. Both packages are MIT licensed and ship a
copy of `LICENSE`.

| Package                       | Contents                           |
| ----------------------------- | ---------------------------------- |
| `@heyo-sh/heyo-status`        | runtime, adapters, CLI, UI, themes |
| `@heyo-sh/create-heyo-status` | project generator and templates    |

## One-time repository setup

Configure branch protection, security reporting and CI as described in
[docs/GITHUB-SETUP.md](docs/GITHUB-SETUP.md). The `npm` environment is the
manual approval gate; a pull request or version PR cannot publish packages.

1. In npm, verify that the account creating the token is a member of the
   `@heyo-sh` organization and can publish organization packages. Do not create
   either package in npm's UI: the first approved release creates
   `@heyo-sh/heyo-status` and `@heyo-sh/create-heyo-status` automatically.
2. For the first publish only, create an npm automation or granular token with
   publish access to those two packages (or to the `@heyo-sh` scope).
3. In GitHub, create an environment named `npm`, restrict it to `main`, and add
   the reviewers required for a production release.
4. Add the token as the `NPM_TOKEN` secret in that `npm` environment, not as a
   repository-wide secret. The publish job reads it as `NODE_AUTH_TOKEN`.
5. In npm, enable 2FA for the owning account or organization and grant publish
   access only to the required maintainers.
6. In GitHub Actions settings, allow the workflow `GITHUB_TOKEN` to create pull
   requests and write repository contents.
7. Once the packages exist on npm, configure each package's **Trusted
   Publisher** for the `heyo-sh/heyo-status` repository, the `release.yml`
   workflow and the `npm` environment, then remove `NPM_TOKEN`. The workflow
   already requests `id-token: write`, so publishing continues over OIDC and
   the now-empty `NODE_AUTH_TOKEN` is ignored.

## Initial 0.1.0 release

Both packages are currently at `0.1.0`, but this repository already contains
unreleased changesets. The first run on `main` will **open a version PR**, not
publish `0.1.0` directly. Review the versions and changelogs in that PR before
merging; the publish job then requests approval from the protected `npm`
environment. Do not delete pending changesets merely to force an initial publish.

1. Run `bun run quality`, `bun run example smoke`, and
   `bun run scaffold:smoke` locally (the latter installs packed tarballs and
   boots generated Cloudflare Workers). Use Node.js 20.19+ for native TCP/TLS
   checks with Next.js or React Router and 22.12+ for Astro 7. CI also verifies
   the compiled checkers on Node 20.19, 22.12 and 24, builds all six examples
   and boots all three production Workers including SSR pages. Run `bun audit`
   before approval. Until `@vercel/routing-utils` updates its
   fixed `path-to-regexp@6.1.0` dependency, this repository and generated
   Vercel projects apply parent-scoped overrides to patched versions 6.3.0 and
   8.4.2. Keep Bun at 1.4.3+ (older versions ignore scoped overrides) and revisit
   the override when the upstream package is fixed. Also audit installed
   generated projects separately: the Vercel CLI has other upstream advisories
   not covered by this routing fix.
2. Inspect the published file lists with `bun pm pack --dry-run` in each package
   and confirm `dist`, `templates`, `README.md` and `LICENSE` are present, and
   that no `.env`, database file or source map of a private file is included.
3. Merge to `main` only after the `Quality`, `Deployment examples`, three
   `Node runtime` and CodeQL jobs pass. Review the version PR, including its
   computed versions and changelogs; merge it, then approve the protected
   `npm` environment. With unreleased minor changesets, the first published
   version may be newer than `0.1.0`.

## Normal release flow

1. For every user-facing change, run `bun run changeset`, choose the smallest
   correct semver bump and commit the generated file.
2. Merge the pull request into `main`.
3. The **Release** workflow opens or updates a version pull request.
4. Review and merge it. The workflow then asks for approval of the `npm`
   environment and publishes the versioned packages.

`src/version.ts` reports the package version to anonymous telemetry;
`test/telemetry.test.ts` fails if it drifts from `package.json`.
`bun run version-packages` runs Changesets and syncs this file automatically.
Update it in the same commit as a manual version change.

Never publish from a local machine.
