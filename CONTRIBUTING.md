# Contributing to Heyo Status

Thanks for helping improve the runtime, monitoring adapters, project creator,
themes, deployment examples or documentation.

Search existing issues first. Use [GitHub Discussions](https://github.com/heyo-sh/heyo-status/discussions)
for questions; report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Local development

Use Bun 1.4.3+ as required by `package.json`. For Node deployments use Node
20.19+ for Next.js/React Router or Node 22.12+ for Astro 7.

```bash
bun install --frozen-lockfile
bun run quality
bun run example smoke
bun run scaffold:smoke
bun audit
```

`quality` includes formatting, unused-dependency checks, types, unit tests and
package builds. The smoke tests exercise six framework/deployment examples,
and `scaffold:smoke` builds, installs and boots generated projects from the npm
tarballs. See [examples/README.md](examples/README.md) before running smoke
tests against a shared PostgreSQL server: the harness creates named databases,
and `reset` removes them. Provide an isolated `DATABASE_URL` if needed.

## Pull requests

Keep each PR focused, explain the user-facing effect, and include regression
tests. Update the template and example alongside a change to generated
behaviour. Include a Changeset (`bun run changeset`) for user-facing package
changes; CI, docs and test-only changes do not need one.

Do not commit framework build output, dependencies, credentials, local database
files or `.env` files. Builds and npm packaging recreate generated assets.
By submitting a contribution, you agree to license it under this repository's
[MIT License](LICENSE).
