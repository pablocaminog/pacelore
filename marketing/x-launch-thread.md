# X / Twitter launch thread

Post ~4h after Show HN goes live (different audience, but HN signal helps).

Tone: build-in-public, specific numbers, no hype words. One screenshot or GIF per tweet that has one.

---

## Tweet 1 (the hook)

> I built a free, source-available alternative to Strava and TrainingPeaks.
>
> It runs on Cloudflare's edge and costs $0.012 per athlete per month to operate.
>
> Here's what's in it, what's not, and what I learned 👇

[ATTACH: dashboard screenshot — PMC chart + peak power curve + calendar heatmap, dark mode]

---

## Tweet 2

> Strava paywalls TSS, IF, peak power curve, training load. TrainingPeaks charges $240/yr.
>
> Pacelore computes all of them. The math fits in 200 lines of TypeScript per metric.
>
> Source: github.com/pablocaminog/pacelore/tree/main/packages/metrics

---

## Tweet 3

> The wedge isn't features. It's economics.
>
> Cloudflare D1, R2, Workers, KV, Queues. A 10K-athlete instance bills ~$120/month. Strava reportedly spends ~$1/user/month on infra — we're ~80× cheaper.
>
> When infra costs almost nothing, you can stop charging for math.

[ATTACH: cost breakdown table from ARCHITECTURE.md §8]

---

## Tweet 4

> Imports work today:
>
> • Garmin Connect (OAuth + push webhooks)
> • Strava (OAuth + 90-day backfill)
> • Apple Health (companion app, HealthKit)
> • FIT / TCX / GPX upload
>
> Activity → R2 → parse → metrics → persist → fanout. All on Cloudflare Queues, idempotent on activity ID.

[ATTACH: pipeline diagram]

---

## Tweet 5

> Built-in social: follow graph, feed, kudos, threaded comments, public/followers/private visibility.
>
> User-created segments with bbox + DTW polyline matching. Per-segment leaderboards. Clubs, events, RSVPs, calendar invites.
>
> Same surface area as Strava social. Open API, no rate-limit hostility.

[ATTACH: feed + segment leaderboard screenshot]

---

## Tweet 6

> Public API + MCP endpoint at /mcp.
>
> With a scoped key, an AI agent can read your activities and post kudos / comments / follows for you.
>
> Wiring this up to Claude as a "training coach" agent is the most fun I've had with this codebase.

[ATTACH: short MCP demo GIF]

---

## Tweet 7

> Decentralization opt-ins for the paranoid (👋):
>
> • Arweave — permanent on-chain backup of every raw FIT file. ~$0.001 per ride.
> • ATProto — export your activities to your own Bluesky-style PDS.
> • Quarterly anonymized dataset on Hugging Face.
>
> Strava sells access to its dataset. We give it away.

---

## Tweet 8

> What it isn't, yet:
>
> • Mobile app (web only, the iOS client is in the queue)
> • Audited (one set of eyes on the auth code, mine)
> • Load-tested past ~50 activities/min
> • Stable — schema has broken once already
>
> Pre-alpha. Run it alongside Strava/Garmin, not as a replacement.

---

## Tweet 9

> License: PolyForm Noncommercial 1.0.0.
>
> Source is open. Personal use, research, education, nonprofit, self-host — all fine. Reselling it as a SaaS — not fine.
>
> "Source-available" not OSI-OSS. I picked the rule that keeps the project from being eaten.

---

## Tweet 10

> The full architecture write-up — including why blockchain is the wrong tool for the hot path, the cost math, and the failure modes — is here:
>
> github.com/pablocaminog/pacelore/blob/main/ARCHITECTURE.md
>
> Repo: github.com/pablocaminog/pacelore
> Demo: demo.pacelore.com

---

## Tweet 11 (the ask)

> Three things I'd love right now:
>
> 1. Eyes on the metrics implementations — packages/metrics
> 2. Cyclists/runners who'll break the demo and tell me what hurt
> 3. A star on the repo if any of this resonates 🌟
>
> I'll be in the replies for the next 6 hours.

---

## Reply templates (have these ready)

- **"Why not AGPL?"** → see Show HN comment §1.
- **"Strava will sue you."** → "Don't scrape Strava. OAuth import only, with explicit user consent, like 100 other apps."
- **"Solo dev, vaporware."** → "Demo's live, repo has 200+ commits in the last 60 days, Cloudflare bill is real, screenshot here →"
- **"Cloudflare lock-in?"** → "D1 schema is Postgres-portable. R2 is S3-API. Worst case I port out in a weekend."
- **"What about a mobile app?"** → "iOS client is in the queue. Web works on phones today, just not native — HealthKit needs the app."
- **"How do you make money?"** → "I don't. License forbids it. Sustainability comes from infra being so cheap one person can run it forever."
