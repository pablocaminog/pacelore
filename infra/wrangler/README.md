# Cloudflare infra

This directory holds the **D1 schema migrations**. The Wrangler config
itself lives next to the worker at `apps/api/wrangler.toml`, which
references this directory via `migrations_dir`.

## First-time setup

```sh
cd apps/api

# Create the resources (capture each ID and paste into wrangler.toml):
pnpm wrangler d1 create open-strava
pnpm wrangler kv:namespace create KV_SESSIONS
pnpm wrangler kv:namespace create KV_LEADERBOARDS
pnpm wrangler kv:namespace create KV_FEED
pnpm wrangler r2 bucket create open-strava-raw
pnpm wrangler r2 bucket create open-strava-parsed
pnpm wrangler r2 bucket create open-strava-exports
pnpm wrangler queues create activity-ingest
pnpm wrangler queues create activity-ingest-dlq

# Apply migrations:
pnpm wrangler d1 migrations apply open-strava --local        # for `wrangler dev`
pnpm wrangler d1 migrations apply open-strava --remote       # for production

# Set required secrets (production):
pnpm wrangler secret put SESSION_SIGNING_KEY
```

## Local development

`apps/api/.dev.vars` provides per-developer secrets for `wrangler dev`.
Copy `.dev.vars.example` and adjust. **Never commit `.dev.vars`.**
