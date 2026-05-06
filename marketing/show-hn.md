# Show HN post

Tue–Thu, 9–11am ET. Single shot.

---

## Title

```
Show HN: Pacelore – source-available Strava/TrainingPeaks alternative on Cloudflare
```

(80 chars. HN cuts at 80.)

## URL field

```
https://github.com/pablocaminog/pacelore
```

(Use the repo, not the demo. Show-HN ranking favors links to the artifact, and HN readers want code first.)

## Body (text field — keep short, the comment carries the detail)

```
Hi HN,

Pacelore is a training platform I've been building solo for a few months. It pulls activities from Garmin, Strava (one-shot import), Apple Health, and direct FIT/TCX/GPX upload, and computes the analytics most cyclists and runners actually care about — TSS, NP, IF, peak power curve, GAP, decoupling, and the CTL/ATL/TSB Performance Manager Chart. There's also a social feed, kudos, comments, segments with leaderboards, clubs, events, and a public REST + MCP API.

It runs entirely on Cloudflare's edge — Workers, D1, R2, KV, Queues, Pages, Durable Objects. Per-user infra cost is around $0.012/month, which is the whole reason this can stay free.

License is PolyForm Noncommercial 1.0.0 — source-available, free for personal/nonprofit/research/self-host use, no commercial productization. I know that's a sore spot for some of the OSI-OSS purists here; happy to talk about why I picked it in the comments.

Status is pre-alpha. The pipeline works end-to-end on a single instance. It hasn't been load-tested, security-audited, or run at scale. APIs and schema can still break.

Demo: https://demo.pacelore.com (read-only, sample athlete)
Architecture write-up: https://github.com/pablocaminog/pacelore/blob/main/ARCHITECTURE.md
Deploy your own to Cloudflare: there's a button in the README.

I'd love feedback on the metrics implementations (packages/metrics), the segment-matching DTW (packages/segments), and on the license choice. Both flame and praise welcome.
```

## First comment from author (post immediately after submission lands)

```
Author here. A few things I expected to come up:

1. Why PolyForm Noncommercial and not AGPL?

   I considered AGPL for a long time. The practical worry: a well-funded incumbent could fork, white-label, integrate it into a Premium tier, and AGPL doesn't stop that — it just makes them publish their changes. PolyForm Noncommercial blocks productization while leaving every other use (personal, research, nonprofit, government, education, self-host) wide open. I'd rather the source be readable, runnable, and forkable for everyone who isn't trying to resell it. Open to debate, this is the part I'm least sure about.

2. The cost numbers.

   With Cloudflare's pricing, a 10K-athlete instance comes in around $120/month. Per-athlete that's ~$0.012. Strava reportedly spends ~$1/active/month on infra, so we're roughly 80× cheaper. Breakdown is in ARCHITECTURE.md §8 — I'd love a sanity check from anyone running real Workers/D1 workloads.

3. What about Garmin / Strava / Apple cutting off API access?

   Real risk. Mitigations are in ARCHITECTURE.md §12 — direct device USB upload, a Connect IQ data field on the watch, and the iOS HealthKit bridge as a fallback path. None of the ingests are scraped — Garmin and Strava are official OAuth, Apple is HealthKit on a native client.

4. "Pre-alpha" — what does that actually mean?

   The end-to-end pipeline (ingest → parse → metrics → persist → fanout) works for a single instance with one contributor's data. It hasn't been load-tested past ~50 activities/min. The auth surface uses passkeys + KV sessions; it's been reviewed by me and one friend, not professionally audited. Migrations have already broken backward-compat once. I would not put your race-week data on it as your only copy yet — it can run alongside Strava/Garmin Connect, not replace them.

5. AI / MCP angle.

   There's a JSON-RPC MCP endpoint at /mcp. Given a scoped API key, an agent can read your activities and post kudos/comments/follows on your behalf. The fun version is wiring this up to Claude or another agent and asking it to summarize your week's training, suggest a workout, or analyze a specific ride. Demo coming.

Ask anything.
```

## Pre-launch checklist

- [ ] Demo URL up and stable, with a public read-only sample athlete loaded
- [ ] README hook in place
- [ ] Repo topics + description filled in
- [ ] `og:image` rendering correctly when URL pasted into a Slack/Discord
- [ ] `good-first-issue` labels on 5 issues
- [ ] Author signed in to HN with at least 100 karma (older account wins flag battles; if no aged account exists, post anyway, flagged-on-launch is recoverable)
- [ ] 6 hours blocked on the calendar starting at submission time
- [ ] Pre-written replies for the predictable critiques: license, vaporware, Strava lawsuit, Garmin API, Cloudflare lock-in, mobile app missing
- [ ] r/Velo + r/selfhosted posts queued for ~2h after HN, different titles + lead images
- [ ] X thread queued for ~4h after HN

## Post-launch

- Reply to every comment within an hour for the first 6h.
- If flagged, email hn@ycombinator.com with one calm sentence: "First-time poster, this is my own project, here's the link." Don't argue.
- 24h later: write a retro tweet thread with screenshots of the HN page rank over time, traffic graph, GitHub star graph, signups. Honesty + numbers travel further than the launch itself.
