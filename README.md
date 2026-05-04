# pacelore

Open-source training platform. Web + mobile companion. Pulls activities from Garmin / Apple Watch / iPhone HealthKit / FIT-TCX-GPX upload. Strava-style social feed + segments + leaderboards. TrainingPeaks-style PMC / CTL / ATL / TSB charts.

Runs entirely on Cloudflare (Workers, D1, R2, KV, Queues, Durable Objects). Autoscales to zero.

## Principles

- **Data sovereignty** — user owns their data. Free export, open formats.
- **No silent paywalls** — free tier covers all core analytics.
- **Open API** — third parties welcome, attribution-only.
- **Open source** — AGPL-3.0.

## Stack

| Layer          | Tech                            |
| -------------- | ------------------------------- |
| Edge compute   | Cloudflare Workers (TypeScript) |
| Web            | Astro on Cloudflare Pages       |
| Relational     | Cloudflare D1                   |
| Object storage | Cloudflare R2                   |
| Hot KV         | Cloudflare KV                   |
| Queues         | Cloudflare Queues               |
| Real-time      | Durable Objects                 |
| Search         | Vectorize + D1 FTS              |
| AI             | Workers AI                      |

## Repo layout

```
apps/
  web/            Astro site, served from Cloudflare Pages
  api/            Workers API (Hono router)
packages/
  fit-parser/     FIT / TCX / GPX parsing
  metrics/        TSS, NP, IF, GAP, PMC, peak curves
  segments/       R-tree bbox + DTW polyline matching
infra/
  wrangler/       wrangler config, D1 migrations
```

## Status

Phase 0 — proof. See `ARCHITECTURE.md` for full architecture.

## License

AGPL-3.0. See `LICENSE`.

## Trademark notice

"Strava" is a registered trademark of Strava, Inc. This project is not affiliated with, endorsed by, or sponsored by Strava, Inc. The name `pacelore` is a placeholder pending rename.
