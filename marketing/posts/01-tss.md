---
title: "What is TSS, really? The math behind Training Stress Score"
slug: what-is-tss
description: A first-principles walk through Training Stress Score — where the formula comes from, how to compute it from a FIT file, and why Strava paywalls it.
target_keywords:
  - what is tss cycling
  - calculate training stress score
  - tss formula explained
  - how to compute tss yourself
seo_target: "free trainingpeaks alternative" / "calculate tss"
length: ~1500 words + interactive Pacelore embed
---

# What is TSS, really?

Training Stress Score is the most useful number a cyclist or runner has, and the most misunderstood. It's a single integer that says how hard a workout was, in a way that's comparable across days, sports, and athletes.

It's also, at the time of writing, behind a paywall on Strava and a $240/yr subscription on TrainingPeaks.

It shouldn't be. The formula is one line. This post walks through it from first principles, computes it on a real FIT file, and shows you how to read it.

## The problem TSS solves

Two workouts:

- **A**: 60 minutes at threshold.
- **B**: 90 minutes at endurance.

Which was harder? "Harder" how — perceived effort? Calorie burn? Recovery cost?

The honest answer is *recovery cost*. You can do workout B almost every day. You can't do workout A two days in a row without paying for it. We need a number that reflects that asymmetry.

The trick is that recovery cost doesn't scale linearly with intensity. Doubling power doesn't double soreness — it more than doubles it. So a useful score has to weight intensity *non-linearly*.

That's exactly what TSS does.

## The formula

```
TSS = (seconds × NP × IF) / (FTP × 3600) × 100
```

Where:

- **`seconds`** — duration of the workout in seconds.
- **`NP`** — *normalized power*, a "perceived" average that punishes variability.
- **`IF`** — *intensity factor*, equal to `NP / FTP`.
- **`FTP`** — your *functional threshold power*, the wattage you can hold for ~1 hour.

A 1-hour ride at exactly your FTP scores **TSS = 100** by definition. That's the anchor.

Examples:

- 60 min at 0.85 IF (sweet spot) → TSS ≈ 72
- 90 min at 0.70 IF (endurance) → TSS ≈ 73 (yes, almost identical)
- 30 min at 1.10 IF (threshold over-unders) → TSS ≈ 60
- 5 hour at 0.65 IF (long endurance) → TSS ≈ 211

That last one is why long rides crush you for two days, and the threshold over-unders only knock you out for one.

## Where Normalized Power comes from

The naïve thing is to take the average wattage. That fails:

- A steady 200W ride and a 0/400/0/400 sawtooth ride have the same average. The sawtooth is much harder.
- Average power throws away the part that matters — the bursts.

Andrew Coggan's fix is to *weight the intensity by itself*, then take the mean. The standard implementation:

1. Smooth the power stream with a 30-second rolling average. (Reflects the body's lag in responding.)
2. Raise each smoothed sample to the **4th power**.
3. Take the mean of those.
4. Take the **4th root** of the mean.

That's NP. The 4th-power weight makes high samples count disproportionately, which matches how the body experiences variable efforts.

In TypeScript:

```ts
function normalizedPower(watts: number[]): number {
  const window = 30;
  const smoothed: number[] = [];
  let sum = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    if (i >= window) sum -= watts[i - window];
    if (i >= window - 1) smoothed.push(sum / window);
  }
  const fourthPowerMean =
    smoothed.reduce((acc, w) => acc + w ** 4, 0) / smoothed.length;
  return fourthPowerMean ** 0.25;
}
```

That's it. That's the whole NP function. ([source in Pacelore](https://github.com/pablocaminog/pacelore/blob/main/packages/metrics/src/np.ts))

## Where Intensity Factor comes from

`IF = NP / FTP`. It's the share of your maximum sustainable effort the workout represented.

- IF < 0.65 — recovery / Z2 endurance
- IF 0.75–0.85 — tempo / sweet spot
- IF 0.85–0.95 — threshold
- IF 0.95–1.05 — VO2-max intervals
- IF > 1.05 — race or all-out efforts

If you find yourself averaging IF > 0.85 over a four-hour ride, your FTP is probably set too low.

## Putting it together

The full pipeline, end-to-end, on a real FIT file:

```ts
import { decodeFIT } from "fit-parser";
import { normalizedPower, tss } from "metrics";

const file = await Bun.file("ride.fit").bytes();
const { records } = decodeFIT(file);

const watts = records.map(r => r.power ?? 0);
const seconds = records.length; // 1Hz samples
const ftp = 290;

const np = normalizedPower(watts);
const if_ = np / ftp;
const score = (seconds * np * if_) / (ftp * 3600) * 100;

console.log({ np, if_, tss: score });
// → { np: 234, if_: 0.807, tss: 65.0 }
```

You don't need a server. You don't need an API. You don't need a subscription. You need a FIT file and 30 lines of code.

## Why does Strava paywall this?

Two reasons, both economic:

1. **Power-data users skew toward serious cyclists**, who are more willing to pay for tools. So putting analytics behind a paywall converts well.
2. **TrainingPeaks built its business on it.** TSS, NP, IF, and the PMC chart are TrainingPeaks innovations (popularized by Andrew Coggan and Hunter Allen). Strava buying their way into that market — instead of building free competing implementations — is a strategic choice, not a technical one.

The cost to compute TSS is fractions of a millisecond per ride. The cost to *show it to you* is, generously, a tenth of a cent. There's no infrastructure reason it costs $240/yr. It costs $240/yr because the people who want it will pay it.

Pacelore exists, in part, because that pricing isn't a law of nature.

## How to read your TSS

Once you have it, the obvious next questions:

- **Daily TSS** — how hard was today.
- **Weekly TSS** — your training volume in load terms.
- **Chronic Training Load (CTL)** — 42-day exponentially weighted average. Your fitness.
- **Acute Training Load (ATL)** — 7-day EWMA. Your recent fatigue.
- **Training Stress Balance (TSB)** — `CTL − ATL`. Negative means you're tired. Positive means you're rested (or detraining).

Together they form the **Performance Manager Chart**, which we cover in [the next post](./03-pmc.md).

## Try it

Pacelore computes TSS on every ingested ride and shows the breakdown — NP, IF, kJ, peak curves — without paywalls.

[Live demo](https://demo.pacelore.com/activity/sample) shows a real activity. [Source](https://github.com/pablocaminog/pacelore/tree/main/packages/metrics) is on GitHub.

## Further reading

- Andrew Coggan, *Training and Racing with a Power Meter*.
- Hunter Allen and Stephen McGregor, *Cutting-Edge Cycling*.
- The TrainingPeaks blog post that introduced the PMC: ["The Science of the Performance Manager"](https://www.trainingpeaks.com/blog/the-science-of-the-performance-manager/) by Tim Banister.

---

*Pacelore is a source-available training platform that puts these analytics — TSS, NP, IF, the PMC chart, peak power curves, GAP, and decoupling — under one roof, free, on Cloudflare's edge.*
