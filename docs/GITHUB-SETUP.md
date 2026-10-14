# GitHub repository setup

The workflow definitions live in `.github/workflows/`. CI runs on pull
requests; `release.yml` runs only on pushes to `main` and calls the same CI
before it can open a version PR or publish packages. `codeql.yml` scans both
pull requests and `main` weekly. The release workflow explicitly dispatches
CI and CodeQL on Changesets version PRs: GitHub does not emit `pull_request`
workflow runs for pull requests created by `GITHUB_TOKEN`. Dependabot checks
the Bun workspace and GitHub Actions weekly.

## Branch protection

Protect `main`: require pull requests, disallow force pushes and deletion, and
require the `Quality`, `Deployment examples` and all three `Node runtime`
checks plus `Analyze JavaScript and TypeScript` (CodeQL) before merging. Keep
status checks up to date with `main`. Set an approval requirement only when
another maintainer can review pull requests:
a solo maintainer cannot approve their own PR. Revisit the protection rules
when the team grows.

The deployment job exercises all six example projects and boots each of the
three production Workers, including SSR pages; an API-only health check is not
sufficient to catch React runtime problems.

## npm release environment

Create the `npm` environment with required reviewer approval and allow only
`main` to deploy to it. Do not put a publish token in repository-wide secrets.
The first publish needs an npm token with publish access to both
`@heyo-sh/heyo-status` and `@heyo-sh/create-heyo-status`, stored as the
`NPM_TOKEN` **environment secret**. GitHub Actions must be allowed to create
pull requests and write repository contents for the version PR.

After the packages exist, configure npm Trusted Publishing for each package
(`heyo-sh/heyo-status`, `release.yml`, environment `npm`) and delete the
environment token. Do not publish from a local machine. Follow
[RELEASING.md](../RELEASING.md) for the release sequence.

## Security and community

Enable Issues, Discussions, Dependabot alerts/security updates and private
vulnerability reporting. Vulnerabilities belong in private advisories, not
public issues. Public issues and pull requests use the templates under
`.github/`; generated projects must not contain credentials or `.env` files.
