# README hook (drop-in replacement for top of README.md)

The current README opens with a long descriptive paragraph. For launch, replace the top with a punchier hook that loads above-the-fold on GitHub.

---

## Option A — Bold and direct (recommended)

```markdown
<h1 align="center">Pacelore</h1>

<p align="center">
  <strong>The training platform Strava and TrainingPeaks would be — if they were free, open, and respected your data.</strong>
</p>

<p align="center">
  <a href="https://demo.pacelore.com">Live demo</a> ·
  <a href="./ARCHITECTURE.md">Architecture</a> ·
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/pablocaminog/pacelore">Deploy your own</a>
</p>

<p align="center">
  <img src="./marketing/assets/hero.png" alt="Pacelore dashboard — PMC chart, peak power curve, calendar heatmap" width="900">
</p>

---

**TSS · NP · IF · CTL/ATL/TSB · peak power curve · GAP · decoupling.** All free. All open source. All running on Cloudflare's edge for ~$0.012 per athlete per month.

Imports from Garmin, Strava, Apple Health, FIT/TCX/GPX. Adds a social feed, segments, leaderboards, clubs, events, and a public API + MCP endpoint on top.

> **Pre-alpha.** It works end-to-end on a single instance. It is not load-tested or audited. APIs and schema can break. Use it, fork it, file issues — don't bet a business on it yet.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pablocaminog/pacelore)
```

## Option B — Quiet and confident

```markdown
# Pacelore

A source-available training platform on Cloudflare's edge. Computes the analytics Strava paywalls and TrainingPeaks charges $240/yr for, and adds a social feed, segments, and an open API on top.

[Live demo](https://demo.pacelore.com) · [Architecture](./ARCHITECTURE.md) · [Self-host in 10 minutes](#deploy-to-cloudflare)
```

---

## GitHub repo metadata

Set in repo Settings → General:

- **Description**: `Source-available Strava + TrainingPeaks alternative on Cloudflare's edge. TSS, NP, IF, CTL/ATL/TSB, peak power curve — all free.`
- **Website**: `https://pacelore.com` (or demo URL until landing exists)
- **Topics**: `strava-alternative`, `trainingpeaks-alternative`, `cycling`, `running`, `triathlon`, `fitness-tracker`, `training-load`, `tss`, `cloudflare-workers`, `self-hosted`, `open-source`, `astro`, `hono`, `typescript`

## Social card (`og:image`)

1200×630 PNG. Save to `marketing/assets/og.png` and reference from the Astro layout. Layout:

- Top-left: Pacelore wordmark.
- Center: large text "Free what they paywall."
- Bottom-left: small "Source-available · Cloudflare edge · Pre-alpha".
- Right side: a small annotated PMC chart screenshot.
- Background: dark slate. White + one accent color (pick one and stick with it everywhere).

## Pinned tweet / X bio

Bio (160 char):
> Building Pacelore — source-available Strava/TrainingPeaks alt. Free what they paywall. Cloudflare edge, ~$0.012/user/mo. Pre-alpha. github.com/pablocaminog/pacelore

Pinned thread: see `marketing/x-launch-thread.md`.
