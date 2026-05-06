# Pacelore — Zero-Budget Marketing Plan

Source-available training platform competing directly with Strava and TrainingPeaks. No ad spend. Distribution comes from owned content, community, and the product's own honesty about what incumbents charge for.

---

## 1. Positioning

**One-liner:** *Pacelore is what Strava and TrainingPeaks would be if they were free, open, and respected your data.*

**Wedge (pick one per channel, never mix):**

1. **"Free what they paywall."** TSS, IF, NP, CTL/ATL/TSB, peak power curve, GAP, decoupling — all free, forever. TrainingPeaks charges $240/yr. Strava paywalls them inside Strava Premium.
2. **"Own your data."** Free export, open formats, public API on day one. Optional Arweave permanent backup. Optional ATProto export to your own PDS. No platform can hold your decade of rides hostage.
3. **"Built for $0.012 per athlete per month."** Cloudflare edge means a 10K-user instance costs ~$120/mo to run. The economics that justify Strava's paywall don't exist anymore.
4. **"Source you can read. Self-host you can run."** Fork it, deploy it to your own Cloudflare account in 10 minutes.

**What we don't say:**
- Don't claim "open source" — license is PolyForm Noncommercial, not OSI-OSS. Say "source-available" or "open source code, noncommercial license."
- Don't trash-talk Strava staff or TrainingPeaks staff. Critique pricing, feature paywalls, API hostility — not people.
- Don't promise stability: it's pre-alpha. Be honest. That honesty is itself the brand.

---

## 2. Target audiences (priority order)

| Tier | Audience | Why they convert | Where they live |
|------|----------|------------------|-----------------|
| 1 | **Power-data cyclists** (FTP, intervals, structured plans) | Already pay TrainingPeaks. Already mad about it. | r/Velo, r/cycling, TrainerRoad forums, Slowtwitch, Discord cycling servers |
| 2 | **Self-quantifiers / dev-curious athletes** | Want to read the code, run their own instance, hit the API | HN, Lobsters, dev Twitter, r/selfhosted, GitHub trending |
| 3 | **Privacy-minded runners + triathletes** | Strava heatmap leak, opaque data sales | r/running, r/triathlon, r/privacy |
| 4 | **Coaches who hate TrainingPeaks pricing** | $240/yr × N athletes adds up | LinkedIn endurance-coach circles, Twitter coach community |
| 5 | **Garmin-faithful but Strava-skeptical** | Want social without giving Strava another login | r/Garmin, Garmin forums |

Build for tier 1 first. They're loud, technical, and will write the threads that pull tiers 2–4 in.

---

## 3. Content pillars

Every piece of content fits one of five pillars. Rotate them; don't drift.

1. **Build-in-public dev logs** — what shipped this week, what broke, what cost $0.03 to run. Audience: tier 2 + 4.
2. **"Strava paywalled this. Here's the math behind it."** — explainer per metric (TSS, NP, IF, CTL, GAP, decoupling). Audience: tier 1 + 3.
3. **"Run your own training platform"** — self-host walkthroughs, API tutorials, MCP/agentic demos. Audience: tier 2.
4. **Athlete spotlights** — real users (once they exist) showing their PMC chart, their data export, their fork. Audience: all tiers.
5. **Industry commentary** — Strava pricing changes, TrainingPeaks roadmap, Garmin API drama, data-leak news. React fast, in our voice.

---

## 4. Channel playbook

Free channels only. Each one has a job, a cadence, and a hook style. **Do not** post the same thing across all channels — repurpose with channel-native framing.

### 4.1 GitHub (the homepage)

The repo *is* the landing page for tier 2.

- Pin a 5-line README hook: "Source-available Strava/TrainingPeaks alternative. Free what they paywall. Cloudflare edge. Pre-alpha."
- Add a `SHOWCASE.md` with screenshots of every chart Strava/TrainingPeaks paywalls.
- Topics: `strava-alternative`, `trainingpeaks-alternative`, `cycling`, `running`, `cloudflare-workers`, `fitness-tracker`, `self-hosted`.
- Aim for **GitHub Trending in TypeScript / Cloudflare Workers** during launch week. Trending threshold ≈ 60–100 stars in 24h. Hit it by coordinating Reddit/HN/X launch on the same day.
- Issues labeled `good-first-issue` from week 1.

### 4.2 Hacker News

One **Show HN** post. One shot. Don't waste it before the product is presentable.

- Title: `Show HN: Pacelore – source-available Strava/TrainingPeaks alternative on Cloudflare`
- Post Tue–Thu, 9–11am ET.
- First comment from author: cost breakdown ($120/mo for 10K users), explanation of license choice, what's pre-alpha, what isn't.
- Be online for 6 hours after. Reply to every comment. Don't get defensive on license criticism — it's the most-asked question; have a calm, prepared answer.
- Follow-up Shows ~quarterly when major capabilities ship (mobile app, segments leaderboards, MCP for AI agents, Arweave permanence).

### 4.3 Reddit

Highest-leverage channel for tier 1 + 3. Subreddits, ranked:

| Sub | Members | Angle | Cadence |
|---|---|---|---|
| r/Velo | 200K+ | TSS/PMC nerds. Lead with power analytics screenshot. | Quarterly major posts, weekly comments |
| r/cycling | 1M+ | Broad. Lead with "free Strava alternative." | Once at launch, then only when major. |
| r/running | 3M+ | rTSS, GAP, training load. | Quarterly |
| r/triathlon | 200K+ | Multi-sport PMC. | Quarterly |
| r/Garmin | 200K+ | Garmin import as hero feature. | Once at launch |
| r/selfhosted | 600K+ | "Self-host your fitness platform." | Once at launch, again per major release |
| r/AdvancedRunning | 350K+ | Threshold/zone analytics. | Quarterly |
| r/Strava | small | They watch this sub. Be careful, but honest. | Comments only at first |
| r/TrainingPeaks | small | Direct competitor sub. Don't post promotional — comment helpfully. | Comments only |

Rules of engagement:
- Read each sub's self-promo rules. Most allow Show-and-Tell with caveats; some require flair.
- Never post the same title to two subs. Rewrite for the audience.
- Comment 10× more than you post. Build karma + recognition before asking for attention.
- When someone complains about Strava pricing or TrainingPeaks: link without shilling. "There's a free alt I'm working on if useful — [link]. Pre-alpha, fair warning."

### 4.4 X / Twitter

Build-in-public account. Daily-ish.

- Bio: "Building Pacelore — source-available Strava/TrainingPeaks alt. Free what they paywall. On Cloudflare. Pre-alpha."
- Pinned thread: "Why I'm building this and why it costs me $4/mo to run."
- Daily cadence:
  - **Mon** — what shipped last week (1 screenshot + bullet diff vs Strava).
  - **Wed** — "metric explainer of the week" with chart.
  - **Fri** — cost report ($X for Y users this week).
- Reply game: every Strava pricing tweet, every TrainingPeaks complaint, every "I wish Garmin Connect did X" — respectfully reply with link, only if relevant.
- Tag potential amplifiers: @cyclingtips, @velonews, @SelfHosted, @Cloudflare, @astrodotbuild, @hono_js. Don't spam — tag only when content directly relates.

### 4.5 YouTube

Highest-leverage long-form channel for tier 1. Don't need a face — screen-recordings work.

Series ideas:
1. **"What is [TSS / NP / CTL / GAP] really?"** — 5–8 min, whiteboard the math, then show it computed live in Pacelore. SEO hits forever.
2. **"Strava charges $X for this. Here's the source code."** — show the metric paywalled, show our implementation, link to repo.
3. **"Self-host your training platform in 10 minutes"** — wrangler deploy walkthrough.
4. **"Migrate 10 years of Strava in 90 seconds"** — the migration tool demo, dramatic.

Cadence: 1 video / 2 weeks. SEO compounds. No need to chase trends.

### 4.6 TikTok / Reels / Shorts

Repurpose YouTube cuts into 30–60s clips. One hook each:
- "Strava charges $80/yr for this chart. Here's what it actually costs to compute." [show cost] [show chart]
- "Your training data is stuck in Strava. Here's a free export." [drag-drop demo]
- "Built a Strava alternative for $4/month. Here's the bill." [screenshot]
- "FTP, NP, IF in 60 seconds." [pure educational, no pitch]

Cadence: 3×/week. Reuse aggressively across TikTok, IG Reels, YouTube Shorts, X video.

### 4.7 Instagram

Lower priority but cheap. Convert YouTube/TikTok cuts.
- Carousel posts: "5 metrics Strava paywalls (and how to compute them yourself)."
- Story polls: "Would you self-host your training data?"
- Tag location at popular climbs/segments to surface to local cyclists.

### 4.8 LinkedIn

Coaches and endurance-industry decision-makers live here.
- 1 post / week, longer-form.
- Angle: economics of training platforms, data sovereignty for coaches, MCP/agentic AI for athlete coaching workflows.
- Connect with endurance coaches directly. Don't pitch — share posts. They'll DM.

### 4.9 Discord + community forums

- **Slowtwitch**, **TrainerRoad**, **Zwift Insider** forums — long-form thread per quarter. Be the helpful person.
- Cycling Discord servers (search Disboard for "cycling", "cyclocross", "gravel", "triathlon").
- Don't post-and-leave. Hang out. Answer threshold-zone questions, then once trust is earned, mention the project when relevant.

### 4.10 HN-adjacent / dev channels

- **Lobsters** (need invite) — Show post when post-Show-HN.
- **Indie Hackers** — build-in-public, MRR replaced with "infra cost / month" since this is noncommercial.
- **Dev.to / Hashnode** — repost YouTube explainers as written form. Good for SEO.
- **Cloudflare Discord + Workers community** — they love seeing real apps shipped on the stack. Great signal-boost source.

### 4.11 SEO content (the long game)

Domain authority compounds. One blog post a week, hosted on the marketing site (`pacelore.com/blog` or whatever).

Target queries (low-CPC, high-intent):
- "free trainingpeaks alternative"
- "free strava premium alternative"
- "how to compute TSS yourself"
- "calculate normalized power from FIT file"
- "self-host strava"
- "open source training peaks"
- "FIT file parser javascript"
- "PMC chart explained"
- "GAP grade adjusted pace formula"

Each post = a metric explainer + a Pacelore screenshot + a "here's the source link." Wikipedia-grade explainer + product demo = ranks.

### 4.12 Cold-but-cheap

- **Wikipedia edits** — add Pacelore to the "Comparison of training platforms" article (only if reliable secondary sources exist; needs HN coverage first).
- **Awesome lists** — submit to `awesome-selfhosted`, `awesome-cloudflare`, `awesome-cycling`, `awesome-fitness`.
- **Hugging Face dataset** — publish anonymized public training dataset (per architecture doc §9). Free distribution, academic citation pull.
- **Podcasts** — pitch *Marginal Gains*, *Empirical Cycling*, *Fast Talk*, *That Triathlon Show*, *Self-Hosted Show*. One pitch / week.

---

## 5. 90-day launch sequence

Three phases. Each phase has one job.

### Phase A — Days 0–30: build in private, harden the public surface

Goal: when you launch, the demo doesn't break. Not chasing audience yet.

- **Week 1**
  - Make a public demo instance (read-only, sample data) at `demo.pacelore.com`.
  - Fill `SHOWCASE.md` with annotated screenshots — every chart, every metric.
  - Record 5 short demo loops as GIFs / WebMs for embedding everywhere.
  - Set up X account, GitHub topics, repo metadata, social cards (`og:image`).
- **Week 2**
  - Write 4 cornerstone blog posts: "What is TSS", "What is NP/IF", "What is the PMC", "What is GAP". Each ~1500 words + interactive Pacelore embed.
  - Record 3 YouTube videos (one per cornerstone metric + intro tour).
- **Week 3**
  - Soft-soft launch in 3 Discord servers and 1 forum. Invite 20–50 friendlies. Get feedback. Fix the 5 worst things they trip on.
  - Submit to `awesome-selfhosted`, `awesome-cloudflare`.
- **Week 4**
  - Final polish. Hammer the demo. Pre-write Show HN post + first comment. Pre-write 5 tweet threads. Schedule.

### Phase B — Days 30–60: launch week

One coordinated multi-channel push. Everything fires within 36 hours so signals stack.

- **Day 30 (Tue or Wed) 9am ET** — Show HN goes live. First comment with cost breakdown + license rationale.
- **Same day 11am ET** — r/Velo "I built a free TrainingPeaks alt" post with screenshots. Different framing than HN.
- **Same day 1pm ET** — X thread, 8–12 tweets, build-in-public origin story + 4 GIFs.
- **Day 31** — r/selfhosted post, r/cycling post (different titles, different lead images).
- **Day 32** — Email/DM 10 cycling/running newsletter authors, 5 podcast hosts, 5 endurance YouTubers. Plain text. One ask: "Worth a mention?"
- **Days 33–36** — show up everywhere comments are happening. Reply to every issue. Ship 1 visible improvement per day so the changelog moves while attention is on you.
- **Day 40** — write the launch retro post: "What 30 days of Show HN got me." Honest numbers. That post gets its own HN bump.

Targets for launch week (realistic for a solo, source-available, niche project):
- 500–2000 GitHub stars
- 100–500 demo signups
- 30–80 newsletter signups
- 5–15 PRs/issues from new contributors
- 1–3 podcast/YouTube mentions queued

### Phase C — Days 60–90: compound

After launch, the trap is to chase another launch. Don't. Compound.

- Ship every Friday. Tweet the diff.
- 1 cornerstone blog post / week.
- 1 YouTube video / 2 weeks.
- 3 short-form videos / week (TikTok/Reels/Shorts).
- 1 LinkedIn post / week.
- 1 podcast pitch / week.
- Reply to every Strava-pricing-rage tweet for 30 days, only if you have something genuinely useful to say.
- At day 90: second Show HN: "Show HN: Pacelore 90 days later — here's what shipped, here's what we learned, here's the AGPL/PolyForm question revisited."

---

## 6. Weekly cadence (steady-state, post-launch)

| Day | Activity | Time |
|---|---|---|
| Mon | Ship recap tweet/thread + LinkedIn post | 30m |
| Tue | Long-form blog post draft | 2h |
| Wed | Metric explainer thread + YouTube short clip | 1h |
| Thu | Reddit / forum engagement (comments, not posts) | 1h |
| Fri | Ship + post changelog + cost-of-the-week tweet | 30m |
| Sat | Long-form YouTube video (every other week) | 3h |
| Sun | Off, or planning week ahead | — |

Total ≈ 6–8h / week. If it ever balloons past that, kill the lowest-performing channel.

---

## 7. Hooks and one-liners (steal these)

For the swipe file. Each lives in a tweet, a post title, a YouTube title, or a video opener.

- "Strava paywalls TSS. The math is one line of code. Here it is."
- "Your training data shouldn't live in someone's funnel."
- "TrainingPeaks: $240/yr. Pacelore: $0. Same metrics. Source on GitHub."
- "I built a Strava clone for $4/month. AMA."
- "Free what they paywall."
- "It's not that Strava can't make TSS free. It's that they won't."
- "10 years of rides. One CSV. You should be able to take it with you."
- "An open-source training platform you can fork in 10 minutes."
- "If you can read JavaScript, you can audit how your training load is computed."
- "AI agents can now log your kudos for you. Here's the MCP endpoint."

---

## 8. Defensive playbook (things that will go wrong)

Pre-write the response. Don't improvise the first time it happens.

- **"This isn't real open source — PolyForm is restrictive."** Calm answer: license is honest about commercial restrictions; source is fully readable, runnable, forkable for any noncommercial use; FAQ link.
- **"You'll get a Strava cease-and-desist."** We don't scrape Strava. We use OAuth, with user consent, like 100 other apps. Not affiliated.
- **"Garmin will revoke your API access."** Possible. Mitigation in ARCHITECTURE.md §12 — direct device USB upload + Connect IQ field + iOS Health bridge fallback.
- **"Solo dev, vaporware."** Show the changelog, the live demo, the cost dashboard.
- **"Cloudflare lock-in."** Schema is Postgres-portable. R2 is S3-API. Worst case, port out in a weekend.
- **"What's your business model?"** There isn't one. License forbids it. Sustainability comes from the project being so cheap to run that one person can keep an instance up indefinitely. Donations welcome, paid coaching tier *maybe* later as a separate commercial license, optional Arweave costs pass through.

---

## 9. KPIs (free-tier sustainable)

What to track, since CAC and revenue don't apply.

| Metric | Source | 30 days | 90 days | 180 days |
|---|---|---|---|---|
| GitHub stars | repo | 200 | 1500 | 4000 |
| Active demo accounts | D1 query | 100 | 800 | 3000 |
| Activities ingested | D1 query | 1K | 30K | 200K |
| Newsletter subs | mailing list | 50 | 400 | 1500 |
| YouTube subs | YT analytics | 100 | 500 | 2000 |
| X followers | profile | 200 | 1500 | 5000 |
| Inbound contributors (PRs merged from non-author) | GitHub | 1 | 8 | 25 |
| Podcasts/blogs covering it | manual log | 1 | 5 | 15 |

Pick 3 to chase per quarter. Ignore the rest. Don't optimize a vanity metric that doesn't tie to the wedge.

---

## 10. Tools (all free)

- **Bluesky/Buffer** for cross-posting to X/IG/LI (free tier).
- **DaVinci Resolve** for video edits (free).
- **OBS** for screen recording.
- **Excalidraw** for diagrams.
- **Plausible Community Edition** or **Cloudflare Web Analytics** for site stats — privacy-respecting, on-brand.
- **Listmonk** self-hosted on a Worker for the newsletter.
- **Disboard / r/findadiscord** to discover communities.
- **Google Alerts / F5Bot** for "strava price increase", "trainingpeaks alternative", "self host strava" — be first to comment.
- **GitHub Issues + Projects** as the public roadmap. Don't use Notion behind a wall.

---

## 11. Don'ts

- Don't pay for ads. The license model can't justify it.
- Don't drop the same link on five subs in one day. Reddit will shadowban.
- Don't argue with strangers about license choice. Link the FAQ. Move on.
- Don't pre-announce features that aren't shipped. The project's edge is shipping over talking.
- Don't impersonate or astroturf. Be the founder, openly. Honesty *is* the moat.
- Don't compare yourself to Strava on social-graph features yet. Compete where you're better (analytics, data, openness, cost).
- Don't promise a mobile app date. Ship the web first.

---

## 12. Next actions (ranked, do in order)

1. Pin a tagline + screenshot to the README. (1 hour)
2. Stand up demo.pacelore.com with seed data. (1 day)
3. Write the 4 cornerstone metric explainers. (1 week)
4. Record a 90-second hero video for the README + landing page. (4 hours)
5. Set up X account + post pinned origin thread. (2 hours)
6. Submit to `awesome-selfhosted` PR. (30 minutes)
7. Schedule launch week for ~30 days from today.
8. Pre-write Show HN post + first comment.
9. Identify 20 cycling/endurance creators and follow them. Engage genuinely for 3 weeks before pitching.
10. Open 5 `good-first-issue` tickets so first-timer contributors have somewhere to land.
