---
"@heyo-sh/heyo-status": minor
"@heyo-sh/create-heyo-status": minor
---

Remove adoption telemetry and implicit environment-variable configuration. Configure the management token and Vercel cron secret explicitly in `heyo-status.config.ts`; the CLI uses `--config` and `--port` or their defaults. Generated starters configure SQLite and PostgreSQL directly in `heyo-status.database.ts` instead of reading environment variables.
