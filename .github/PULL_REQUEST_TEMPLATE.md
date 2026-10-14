## Summary

Describe the user-visible change and link the issue it resolves.

## Validation

- [ ] `bun run quality`
- [ ] `bun run example smoke` (or explain which environments were tested)
- [ ] `bun run scaffold:smoke` for changes to the creator, assets, or deployment overlays
- [ ] Added or updated regression tests for behaviour changes
- [ ] Updated relevant templates, examples, and documentation

## Release and security

- [ ] Added a changeset for user-facing package changes (or this is CI/docs/tests only)
- [ ] Checked that no secrets, credentials, `.env` files, or local databases are included
- [ ] Identified any compatibility changes or new runtime requirements
