# Pacelore

Source-available, noncommercial training platform. Imports activities from Garmin, Strava, Zwift (via Strava bridge), Apple Health, and direct FIT/TCX/GPX upload. Computes the analytics that Strava paywalls and TrainingPeaks charges \$20/mo for — TSS, IF, NP, peak power curve, GAP, decoupling, CTL/ATL/TSB. Adds a social feed, kudos, comments, segments with leaderboards, clubs, challenges, and events on top.

Runs entirely on Cloudflare's edge. Autoscales to zero. Costs effectively nothing for a hobby instance.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pablocaminog/pacelore)

> **Status: pre-alpha.** The core works end-to-end on a single instance, but nothing in this repo has been load-tested, security-audited, or deployed at scale. APIs and schema can still break. Use it, fork it, file issues — just don't bet a business on it yet.

## Why this exists

Strava locked away the analytics most cyclists and runners actually use. TrainingPeaks costs ~\$240/yr. Garmin Connect is fine until you want to share with friends. Nobody owns their data — every platform is one acquisition or pricing change away from breaking workflows people built over a decade.

Pacelore is an attempt to put all that under one roof, on infrastructure cheap enough that the project can stay free, and under a license ([PolyForm Noncommercial 1.0.0](./LICENSE)) that keeps it that way: source is open for anyone to read, run, learn from, and self-host for personal or nonprofit use — but nobody gets to wrap it in a paywall and resell it. Modest goals: be useful, be honest about limitations, don't paywall the things that matter.

## What it does today

- **Ingest** — FIT, TCX, GPX upload. Strava OAuth + 90-day backfill. Garmin Connect OAuth1.0a + push webhooks.
- **Pipeline** — parse → metrics → persist via Cloudflare Queues. Idempotent on activity ID.
- **Analytics** — TSS, NP, IF, VI, kJ, peak power curve, HR zones, TRIMP, decoupling, GAP (Minetti), rTSS.
- **PMC dashboard** — CTL / ATL / TSB with a configurable date range. Calendar heatmap of training load.
- **Social** — follow graph, activity feed, kudos, threaded comments, public/followers/private visibility.
- **Segments** — user-created. Bbox prefilter + DTW polyline match. Per-segment leaderboards.
- **Clubs + events** — public and private, RSVP, member roles.
- **Public API** — REST + an MCP JSON-RPC endpoint at `/mcp` so agentic AI can read activities and act (kudos/comment/follow) on behalf of users who issue keys.
- **Decentralization opt-ins** — Arweave permanent backup of raw files, ATProto export to a user's own PDS.
- **Web app** — Astro + Tailwind. MapLibre routes via OpenFreeMap. uPlot charts.

## Built on the shoulders of giants

This project is a thin layer of glue. The hard parts are someone else's work, and credit belongs to:

- **[Cloudflare](https://developers.cloudflare.com/)** — Workers, D1, R2, KV, Queues, Pages, Durable Objects. Whole stack.
- **[Hono](https://hono.dev/)** — the API router.
- **[Astro](https://astro.build/)** — the web framework.
- **[MapLibre GL](https://maplibre.org/)** + **[OpenFreeMap](https://openfreemap.org/)** — maps without Mapbox lock-in.
- **[uPlot](https://github.com/leeoniya/uPlot)** — fast time-series charts.
- **[SimpleWebAuthn](https://simplewebauthn.dev/)** — passkey auth.
- **[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)** — TCX/GPX parsing.
- **[Andrew Coggan](<https://en.wikipedia.org/wiki/Power_meter_(cycling)>)** for popularizing TSS / NP / IF.
- **[Alberto Minetti](https://journals.physiology.org/doi/full/10.1152/japplphysiol.01177.2001)** for the GAP energy-cost model.
- **[Tim Banister](https://www.trainingpeaks.com/blog/the-science-of-the-performance-manager/)** for the impulse-response Performance Manager Chart.
- **[Strava](https://www.strava.com/)**, **[TrainingPeaks](https://www.trainingpeaks.com/)**, **[Intervals.icu](https://intervals.icu/)** — for proving demand exists. Pacelore is not affiliated with any of them.

If you find a missing attribution, please open an issue.

## Stack

| Layer          | Tech                            |
| -------------- | ------------------------------- |
| Edge compute   | Cloudflare Workers (TypeScript) |
| Web            | Astro 5 on Cloudflare Pages     |
| Relational     | Cloudflare D1                   |
| Object storage | Cloudflare R2                   |
| Hot KV         | Cloudflare KV                   |
| Queues         | Cloudflare Queues               |
| Real-time      | Durable Objects (planned)       |
| Search         | Vectorize + D1 FTS (planned)    |
| Maps           | MapLibre GL + OpenFreeMap       |
| Charts         | uPlot                           |
| Auth           | WebAuthn passkeys + KV sessions |

## Repo layout

```
apps/
  web/            Astro site, served from Cloudflare Pages
  api/            Workers API (Hono router) + queue consumer + cron
packages/
  fit-parser/     FIT / TCX / GPX → normalized ActivityRecord
  metrics/        TSS, NP, IF, GAP, peak curves, PMC
  segments/       Haversine + bbox + DTW polyline matching
infra/
  wrangler/       wrangler config, D1 migrations, schema test
```

## Quick start (local)

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm dev:api   # in one shell — Hono worker on :8787
pnpm dev:web   # in another  — Astro on :4321
```

## Deploy to Cloudflare

The button at the top of this README forks the repo and runs the standard Cloudflare deploy flow. Manually:

```bash
cd apps/api
wrangler d1 create pacelore
wrangler d1 migrations apply pacelore --remote
wrangler r2 bucket create pacelore-raw
wrangler r2 bucket create pacelore-parsed
wrangler r2 bucket create pacelore-exports
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_LEADERBOARDS
wrangler kv namespace create KV_FEED
wrangler queues create pacelore-ingest

# put your bindings in wrangler.toml, then:
wrangler secret put SESSION_SIGNING_KEY
wrangler secret put STRAVA_CLIENT_ID         # optional
wrangler secret put STRAVA_CLIENT_SECRET     # optional
wrangler secret put GARMIN_CONSUMER_KEY      # optional
wrangler secret put GARMIN_CONSUMER_SECRET   # optional
wrangler deploy

cd ../web
wrangler pages deploy ./dist
```

See `ARCHITECTURE.md` for the full topology.

## Contributing

PRs welcome. The codebase is intentionally small — read `ARCHITECTURE.md`, pick something from the open issues, or open one to discuss before larger changes.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE).

In plain language: you can read, fork, run, modify, and self-host Pacelore for any noncommercial purpose — personal training, hobby projects, research, education, government, charity. You can not run it as a commercial product, charge for access, or build a business on top of it. If you want a commercial license, open an issue.

This is a "source-available" license, not OSI-certified open source — open source by OSI's definition forbids field-of-use restrictions, and "no commercial use" is one. The source is fully open; the commercial path isn't.

## Trademark notice

"Strava", "TrainingPeaks", "Garmin Connect", "Zwift", and other product names are trademarks of their respective owners. This project is not affiliated with, endorsed by, or sponsored by any of them. Pacelore reads user-uploaded activity data and (with explicit user OAuth consent) data from third-party APIs the user is entitled to.
