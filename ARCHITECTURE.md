# Open-Source Strava + TrainingPeaks Alternative — Architecture

Working name: **OpenLap** (placeholder).

Product: web app + mobile companion. Pulls activities from Garmin/Apple Watch/iPhone HealthKit/manual FIT-TCX-GPX upload. Computes training-load metrics. Renders Strava-style social feed + segments + leaderboards + TrainingPeaks-style PMC/CTL/ATL/TSB charts. Events/clubs/invites.

Constraints driven by research-agent run:
- **Data sovereignty** (#1 finding) — user owns their data. Free export, open formats, public API.
- **No silent paywalls** (#2 finding) — pricing transparent, no renewal hikes, free tier covers all core analytics.
- **Open API** — third parties welcome, attribution-only.
- Runs **entirely on Cloudflare** — minimum ops, low fixed cost, global edge.
- Source-available under **PolyForm Noncommercial 1.0.0** — read, run, fork for personal/nonprofit use; no commercial productization.

---

## 1. Stack — entirely Cloudflare

| Layer | Service | Purpose |
|---|---|---|
| Edge compute | Workers (TypeScript) | API routes, ingestion, processing |
| Static + SSR | Pages (with Workers Functions) | React/SvelteKit/Solid app |
| Relational | **D1** | Users, activities-index, segments, social graph, events |
| Object storage | **R2** | Raw FIT/TCX/GPX files, generated images, exports. Zero egress fee |
| Hot KV | **KV** | Session tokens, leaderboard top-N caches, hot feed slices |
| Queues | **Queues** | Async ingest pipeline (parse → compute → segment-detect → fanout) |
| Real-time | **Durable Objects** | Live group rides, real-time leaderboard racing, presence |
| Background | **Cron Triggers** | Daily PMC rollups, segment leaderboard recompute, weekly digests |
| Search | **Vectorize** + D1 FTS | Search activities, athletes, routes, segments |
| Images | **Images** | Route map renders, profile photos |
| Auth | **Access** (org) + custom for public | OAuth (Garmin, Apple Sign-In, Strava import), WebAuthn |
| Email | **Email Workers** + Routing | Invites, weekly summaries, password resets |
| Logs | **Logpush → R2** | Audit trail, debugging |
| Analytics | **Analytics Engine** | Metric counters w/o D1 writes |
| AI features | **Workers AI** | Activity captions, route descriptions, anomaly detection |

No external SaaS. No always-on VMs. Everything autoscales to zero.

---

## 2. Data ingestion

### Garmin

- **Garmin Health API** (OAuth 2.0). Webhook push: `Activities Service` POSTs FIT-summary to our Worker on every new activity.
- Worker validates signature → enqueues `activity.ingest` job → 200 OK in <50ms.
- Real activity FIT file pulled via `Activity Files` endpoint, stored in R2.
- Backfill: user-initiated import (last 90 days / all time), paginated cron job.

### Apple / iPhone

- Native iOS app (Swift) using **HealthKit** — read workouts, heart rate, GPS samples.
- App constructs a FIT/TCX-equivalent JSON payload and uploads via `/api/activities/ingest/apple`.
- For Apple Watch: same path; app reads `HKWorkout` post-hoc.
- Background: `HKObserverQuery` triggers upload when new workout finishes.

### Strava migration

- One-shot OAuth import. Pull all activities + kudos history. Tag origin `strava-import`. Lets users defect with their data intact.

### Manual upload

- Drag-and-drop FIT/TCX/GPX in web UI. Direct R2 upload via signed PUT, then enqueue `activity.ingest`.

### Generic public ingest API

- `POST /api/v1/activities` with FIT/TCX/GPX/JSON.
- API key per third-party app. No rate limit on user-owned reads. Open by default. (Direct counter to research-agent finding #2: API hostility.)

---

## 3. Activity processing pipeline (Queues)

```
ingest        →  parse        →  metrics       →  segments       →  fanout
(R2 put)         (FIT parser)    (TSS, NP, IF,    (R-tree match    (feed write,
                                  pace/power       on stored          notifications,
                                  zones, HRV,      segments)          PMC update)
                                  CTL/ATL/TSB)
```

Each stage is a **Queue consumer** Worker. Independent, retryable, idempotent (keyed on `activity_id`).

### Parser

- **fit-decoder** (TypeScript port — sub-50ms parse for 2hr ride). Extracts records, laps, sessions, events.
- TCX/GPX parsed with lightweight XML stream parser.
- Output: normalized `ActivityRecord` JSON written to R2 as `<activity_id>.parsed.json`.

### Metrics

Pure functions over `ActivityRecord`:
- **Power**: NP (4th-power 30s rolling), IF (NP/FTP), TSS (`(seconds * NP * IF) / (FTP * 3600) * 100`), VI, kJ, peak power curve (1s/5s/30s/1m/5m/20m/60m).
- **HR**: HRR zones, time-in-zone, decoupling (Pw:HR ratio drift), TRIMP.
- **Pace**: GAP (grade-adjusted pace), peak pace curve, NGP, rTSS.
- **Run**: vertical oscillation, ground contact balance (if Garmin Running Dynamics present).
- **Cycling-specific**: VAM, cadence avg/peak.
- **Swim**: SWOLF, stroke rate, distance per stroke.
- **HRV**: rMSSD overnight (from sleep recordings).
- **Training Load**: CTL (42d EMA of TSS), ATL (7d EMA), TSB = CTL − ATL. Recomputed for the affected date forward.

All computed on commodity CPU in <2s per activity. Workers CPU limit (50ms-30s) is fine.

### Segment detection

- Segments stored as polylines in D1 + spatial index in **D1's R-tree** virtual table (or KV-backed grid index).
- For each activity GPS track: bbox match → candidate segments → resample to 1Hz → DTW match against segment shape → record `segment_effort` if matched within tolerance.
- Time / power / HR computed from corresponding sample window.
- Segment KOM/CR leaderboard cache in KV invalidated → recomputed on next read.

### Fanout

- Write activity row to D1 `activities` (one source of truth) + R2 raw + R2 parsed.
- Fan-out to followers' feed via D1 insert into `feed_items` (denormalized).
- Trigger notifications (kudos eligible, segment KOM stolen, friend's first activity, weekly summary).
- Recompute affected day's PMC.

---

## 4. Storage model

### D1 (relational, indexed)

```
users           : id, handle, email, ftp, hrmax, weight, plan_tier, created_at
athletes        : extends users — bio, location, units_pref
follows         : follower_id, followee_id, created_at
activities      : id, athlete_id, started_at, sport, duration, distance, elevation,
                  tss, np, if, hr_avg, hr_max, kj, raw_path, parsed_path, visibility
activity_metrics: activity_id, key, value      (long-form metrics, indexable)
activity_streams: activity_id, stream_type, sample_count, r2_path  (large arrays in R2)
segments        : id, name, polyline, sport, distance, avg_grade, created_by
segment_efforts : id, segment_id, athlete_id, activity_id, time, watts, hr, started_at
kudos           : activity_id, athlete_id
comments        : id, activity_id, athlete_id, body, created_at
clubs           : id, name, sport_focus, visibility, owner_id
club_members    : club_id, athlete_id, role
events          : id, club_id?, owner_id, name, type, starts_at, route_id, location
event_invites   : event_id, athlete_id, status (invited|accepted|declined|maybe)
routes          : id, name, polyline, distance, elevation, created_by
pmc_daily       : athlete_id, date, ctl, atl, tsb, tss
notifications   : id, athlete_id, kind, payload, read_at
```

D1 free tier: 5GB storage, 5M reads/day, 100K writes/day. Generous.

### R2 (large blobs, zero egress)

```
raw/<athlete>/<yyyy>/<mm>/<activity_id>.fit
parsed/<athlete>/<activity_id>.parsed.json     (full sample arrays)
images/segments/<segment_id>.png               (route map render)
images/activities/<activity_id>.png            (preview map)
images/profiles/<athlete_id>.jpg
exports/<athlete>/<job_id>.zip                 (user data export)
```

R2 cost: $0.015/GB-month. **Zero egress.** A 2hr ride FIT ≈ 200 KB. 1000 athletes × 5 activities/week × 200 KB ≈ 4 GB/month → $0.06.

### KV (hot reads)

```
session:<sid>          → user_id (15min TTL)
leaderboard:<seg>      → top 100 efforts (1 day TTL, push-invalidated)
feed:<user>:<page>     → feed slice (5min TTL)
ftp:<user>             → FTP for fast TSS computation
```

KV: $0.50/M reads, $5/M writes. Plenty.

### Durable Objects (real-time only)

- One DO per active group ride / live event.
- Holds presence, broadcast positions, computes live segment race.
- Self-destructs after end + 1hr.

### Vectorize (search)

- Embed activity titles + descriptions + segment names with Workers AI.
- Used for "find similar activities", route search, athlete discovery.

---

## 5. Frontend

- **SvelteKit** or **SolidStart** (better for charts than React for this scale).
- Renders entirely on Cloudflare Pages with Functions.
- Client-side rendering for charts. **Apache ECharts** or **uPlot** (uPlot is faster for time-series).
- Maps: **MapLibre GL JS** + **Protomaps** tiles served from R2 (vector tiles, no per-tile billing).
- All chart types Strava + TrainingPeaks have:
  - Time-series: HR, power, cadence, speed, elevation, temp, gear ratio, smoothness.
  - Peak power/pace curves (mean-max).
  - PMC chart (CTL/ATL/TSB over time, planned vs actual).
  - Calendar heatmap (yearly training volume).
  - Zone distribution bars (HR/power/pace).
  - Cluster scatter (TSS vs duration, weekly).
  - Route map with segments highlighted, kudos overlay.
  - Comparison overlay (this ride vs PR vs friend's).
- All chart data fetched as JSON streams, lazy-loaded.

---

## 6. Auth

- **Email + WebAuthn** (passkeys) primary.
- OAuth: Sign in with Apple, Google, Garmin, Strava (for migration).
- Session token in HttpOnly cookie, signed by Worker secret. Rotated daily.
- For API: per-key tokens, scope-based (`read:activities`, `write:activities`, `read:social`).
- No password stored ever (passkey-first); fallback to magic-link.

---

## 7. Social + segments + events specifics

### Feed

- Push on activity write (D1 insert into `feed_items` for each follower).
- Pull from KV for top of feed; fall back to D1 for older.
- Reverse chronological + boost from clubs the user is in.
- "Kudos" = single-tap reaction. "Comments" threaded one level.

### Segments

- User-creatable. Admin-mod. Sport-tagged.
- Detection: activity upload → R-tree bbox match → DTW polyline match.
- Leaderboards: overall KOM/QOM/CR + age/weight categories + "this year" + "last 90 days".
- Anti-cheat: speed-anomaly detection on segment effort, manual flag review.

### Events

- Public event pages with RSVP.
- Calendar invite (.ics) export.
- Group ride / race / training session types.
- Optional waitlist + capacity.
- Post-event auto-aggregation: every participant's activity that overlaps event time + route → "official results".

### Challenges

- Distance-based, time-bound. Auto-progress as activities ingest.
- User-created + platform-curated.

---

## 8. Costs — concrete

Assume **10,000 active athletes, 5 activities/week each = 217k activities/month**.

| Item | Volume | Cost |
|---|---|---|
| Workers requests | ~50M/mo (API + page) | $0.30/M after 10M free → ~$12 |
| Workers CPU | ~50M × ~5ms median | included in plan |
| D1 reads | ~150M/mo | $0.001/M after 25M → ~$0.13 |
| D1 writes | ~5M/mo | $1/M after 50K → ~$5 |
| D1 storage | ~5 GB | $0.75/GB-mo → ~$3.75 |
| R2 storage | ~50 GB (raw + parsed) | $0.015/GB-mo → ~$0.75 |
| R2 ops | ~10M class-A, ~50M class-B | ~$5 |
| KV reads | ~100M/mo | $0.50/M after 10M → ~$45 |
| KV writes | ~5M/mo | $5/M after 1M → ~$20 |
| Queues | 217K activities × 4 stages = 870K | included in $5/M |
| Durable Objects | 1000 hours/mo of live rides | ~$15 |
| Workers AI | 100K inferences/mo | ~$10 |
| Pages | unlimited | free |
| Vectorize | 5M queries | ~$5 |
| **Total** | | **~$120/mo** |

Strava charges $80–120/year per user. 10K users at $20/yr supporter tier = **$200K/yr revenue against ~$1.4K/yr infra cost**. Even with 1% conversion to paid, sustainable. Free tier viable.

Per-user infra cost: **$0.012/month**. Strava reportedly spends ~$1/month/active. So ~**80× cheaper** than incumbent on infra alone.

---

## 9. Blockchain / public-DB analysis

User asked: can we use blockchain or public database instead of Cloudflare for activities + social, to minimize cost?

### Hot path (per-activity writes, feed, leaderboards) — **NO**

Per-write cost benchmark (April 2026):

| Chain | Per-write cost | Notes |
|---|---|---|
| Ethereum L1 | $0.50–$5 per tx | absurd for activity writes |
| Ethereum L2 (Base, Arb) | $0.001–$0.01 per tx | still 100× more than D1 |
| Solana | $0.00025 per tx | cheap, but social-graph queries need an indexer (back to centralized) |
| Polygon PoS | $0.001 per tx | cheap, 2-block finality |
| **Cloudflare D1** | **~$0.0000002 per write** | 5K× cheaper than Solana |

Activity ingest = 1 main write + ~5 metric writes + 1 feed-fanout per follower (avg 30) = ~36 writes/activity. 5 activities/week/user × 10K users × 36 = 7.2M writes/week. On Solana: $1800/week = $7K/month. On D1: $7/month. **1000× more expensive on chain.**

Plus blockchain doesn't give you indexed queries — you need The Graph or your own indexer, which is centralized infra anyway. So you'd pay both.

### Cold path (raw activity archive permanence) — **MAYBE, OPT-IN**

| Option | Cost | Permanence |
|---|---|---|
| **Arweave** | ~$0.005 / MB one-time | 200-year endowment |
| **Filecoin** | ~$0.00002 / GB-month, 5-yr deals | renewal needed |
| **IPFS pinning (web3.storage)** | $5/mo per 1TB | depends on pinner |
| **R2** | $0.015 / GB-month | as long as you pay |

For a 200KB FIT file: Arweave one-shot ≈ $0.001. Reasonable as **opt-in "permanent backup" tier** — user pays once, file is provably preserved on a decentralized network. Good marketing, real differentiator vs Strava.

Implementation: nightly cron uploads opted-in users' new activities to Arweave via Bundlr/Turbo. Store TX hash in D1. Verify on demand.

**Verdict for cold path:** add an "Arweave permanence" toggle. Worth it for trust narrative + a few cents per user/year.

### Decentralized social — **PARTIAL, FEDERATION**

Two real candidates:

- **AT Protocol** (Bluesky's protocol). Open, federated, third-party PDSs (personal data servers) work today. We could ship an OpenLap PDS that stores activity records as ATProto records, letting other clients consume them. Marketing win + real interop.
- **Nostr**. Cheaper, simpler. Activity events as kind-30000+ records. Less polished tooling.

**Cost:** trivial. Federation == cheap. The win is **portability**, not cost.

Practical recommendation: ship the standard (Cloudflare-only) build first. Add ATProto export adapter in v0.3. Anyone can self-host their own PDS and pull their data into our system.

### Anonymized public dataset — **YES, FREE WIN**

Quarterly anonymized dump (no GPS coords near home addresses, no names, hashed user IDs):

- Publish as **Hugging Face dataset** + GitHub Releases parquet.
- Lets the community train ML on a real fitness corpus. Strava sells access to its dataset to academic researchers; we give it away.
- Storage and bandwidth: free (HF + GitHub).
- Direct counter to research-agent finding #1: data sovereignty. Users opt in; their data benefits the field.

---

## 10. Source-available posture

- **License**: [PolyForm Noncommercial 1.0.0](./LICENSE) — source open, all noncommercial use permitted (personal, research, nonprofit, government); commercial use prohibited. Not OSI-OSS by definition; the source is just as open, the commercial path isn't.
- Repo: monorepo with `apps/web`, `apps/api`, `apps/ios`, `packages/fit-parser`, `packages/metrics`, `packages/segments`, `infra/wrangler`.
- Wrangler-based deploy. Anyone can fork + deploy their own instance to their Cloudflare account in <10 min.
- Public roadmap. RFC process for major features (CONTRIBUTING.md).
- Transparent rate limits, transparent pricing, transparent shutdown clauses.

---

## 11. Phased rollout

### Phase 0 — proof (4 weeks, 1 dev)
- Web app, login (passkey).
- Manual FIT/TCX/GPX upload. R2 store, parse, metrics compute.
- Display single-activity charts (HR, power, pace, peak curves).
- D1 schema. No social yet.

### Phase 1 — single-user training tool (8 weeks)
- All metrics: TSS/IF/NP, peak power curve, GAP, decoupling.
- PMC dashboard (CTL/ATL/TSB).
- Calendar view. Activity list. Search.
- iOS app — HealthKit upload. Garmin OAuth + webhook.

### Phase 2 — social (8 weeks)
- Follow graph. Feed.
- Kudos / comments.
- Activity privacy (public / followers / private).

### Phase 3 — segments + events (8 weeks)
- Segment detection pipeline. Leaderboards.
- Public events + RSVP. Clubs.

### Phase 4 — polish + import (4 weeks)
- Strava migration tool. TrainingPeaks export.
- Public API + docs.
- Anonymized dataset publishing.

### Phase 5 — decentralization opt-ins (ongoing)
- Arweave permanent backup tier.
- ATProto / Nostr export.
- Self-host docs.

Total to MVP-with-social: ~5 months solo dev. Faster with a small team.

---

## 12. Risks

- **Garmin API access** — they can revoke. Mitigation: support direct device USB upload + Connect IQ data field on watch + iOS Health bridge as fallback path.
- **Apple HealthKit changes** — they restrict export from time to time. Mitigation: native app stays current.
- **Strava lawsuit** — they sued Garmin over heatmap patents (research-agent confirmed). Could come after a competitor that uses public segment data. Mitigation: only user-uploaded activity data + user-created segments. No scraping Strava.
- **Cloudflare lock-in** — D1 + DOs are CF-specific. Mitigation: keep schema portable (Postgres-compatible), all blob storage in R2 is S3-API compatible (could move to Backblaze/AWS).
- **D1 scale ceiling** — 10GB per database. Beyond ~50K active athletes, need sharding. Plan: shard by athlete_id range. Done at infra layer, transparent to app.

---

## 13. What this directly answers from the research-agent run

- **Top complaint: Aggressive monetization** → free tier covers all core analytics. Paid tier is convenience (priority email, advanced ML insights, Arweave permanence).
- **Top complaint: API restrictions** → public, free, attribution-only API from day 1.
- **Top complaint: Corporate aggression / lawsuits** → noncommercial license blocks competitive forks while keeping source open for everyone else.
- **Top complaint: Infrastructure failures** → Cloudflare global edge, autoscaling, no single region.
- **Top opportunity: data sovereignty** → free export, Arweave optional, ATProto/Nostr export.
- **Switching destination Garmin Connect (#1)** → first-class Garmin import, day 1.

The research-agent found the wedge. This architecture is the wedge.
