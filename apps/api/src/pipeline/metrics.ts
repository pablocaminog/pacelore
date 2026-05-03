/**
 * Compute the metrics suite from a normalized ActivityRecord.
 *
 * Produces a flat shape ready to write into the activities row (top-line
 * aggregates) and a long-form key/value list for activity_metrics
 * (peak curves, time-in-zone, etc.).
 */

import type { ActivityRecord } from '@open-strava/fit-parser';
import {
  DEFAULT_PEAK_WINDOWS,
  paceMetrics,
  peakCurve,
  powerMetrics,
  timeInZones,
  trimp,
  type HrSample,
  type PaceSample,
  type PowerSample,
} from '@open-strava/metrics';

export interface AthleteThresholds {
  ftp?: number;
  hrMax?: number;
  hrRest?: number;
  thresholdPaceMs?: number;
}

export interface ActivitySummary {
  totalSeconds: number;
  distanceM: number;
  hrAvg: number | null;
  hrMax: number | null;
  powerAvg: number | null;
  powerMax: number | null;
  np: number | null;
  intensityFactor: number | null;
  tss: number | null;
  kj: number | null;
  speedAvgMs: number;
  speedMaxMs: number;
}

export interface MetricKv {
  key: string;
  value: number;
}

export interface ComputedMetrics {
  summary: ActivitySummary;
  metrics: MetricKv[];
}

export function computeMetrics(activity: ActivityRecord, thr: AthleteThresholds): ComputedMetrics {
  const samples = activity.samples;
  const totalSeconds =
    samples.length > 1
      ? samples[samples.length - 1]!.t - samples[0]!.t + 1
      : activity.session.totalSeconds;

  let distanceM = 0;
  let speedSum = 0;
  let speedMax = 0;
  let speedSamples = 0;
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  let powerSum = 0;
  let powerCount = 0;
  let powerMaxRaw = 0;

  const powerStream: PowerSample[] = [];
  const hrStream: HrSample[] = [];
  const paceStream: PaceSample[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (typeof s.distance === 'number') distanceM = s.distance;
    if (typeof s.speed === 'number') {
      speedSum += s.speed;
      speedSamples++;
      if (s.speed > speedMax) speedMax = s.speed;
    }
    if (typeof s.hr === 'number') {
      hrSum += s.hr;
      hrCount++;
      if (s.hr > hrMax) hrMax = s.hr;
      hrStream.push({ t: s.t, hr: s.hr });
    }
    if (typeof s.power === 'number') {
      powerSum += s.power;
      powerCount++;
      if (s.power > powerMaxRaw) powerMaxRaw = s.power;
      powerStream.push({ t: s.t, p: s.power });
    }
    if (typeof s.speed === 'number') {
      const grade = computeGrade(samples, i);
      const sample: PaceSample = { t: s.t, speed: s.speed };
      if (grade !== undefined) sample.grade = grade;
      paceStream.push(sample);
    }
  }

  const summary: ActivitySummary = {
    totalSeconds,
    distanceM,
    hrAvg: hrCount > 0 ? hrSum / hrCount : null,
    hrMax: hrCount > 0 ? hrMax : null,
    powerAvg: powerCount > 0 ? powerSum / powerCount : null,
    powerMax: powerCount > 0 ? powerMaxRaw : null,
    np: null,
    intensityFactor: null,
    tss: null,
    kj: null,
    speedAvgMs: speedSamples > 0 ? speedSum / speedSamples : 0,
    speedMaxMs: speedMax,
  };

  const metrics: MetricKv[] = [];

  if (powerStream.length > 0 && thr.ftp && thr.ftp > 0) {
    const pm = powerMetrics(powerStream, thr.ftp);
    summary.np = pm.normalizedPower;
    summary.intensityFactor = pm.intensityFactor;
    summary.tss = pm.trainingStressScore;
    summary.kj = pm.workKilojoules;
    metrics.push({ key: 'power.np', value: pm.normalizedPower });
    metrics.push({ key: 'power.tss', value: pm.trainingStressScore });
    metrics.push({ key: 'power.if', value: pm.intensityFactor });
    metrics.push({ key: 'power.vi', value: pm.variabilityIndex });
    metrics.push({ key: 'power.kj', value: pm.workKilojoules });
    const dense = densifyToHz(powerStream);
    for (const p of peakCurve(dense, DEFAULT_PEAK_WINDOWS)) {
      metrics.push({ key: `power.peak.${p.duration}`, value: p.peakValue });
    }
  }

  if (hrStream.length > 0 && thr.hrMax && thr.hrRest && thr.hrMax > thr.hrRest) {
    const cfg = { hrMax: thr.hrMax, hrRest: thr.hrRest };
    const tiz = timeInZones(hrStream, cfg);
    for (let z = 0; z < 5; z++) {
      metrics.push({ key: `hr.tiz.z${z + 1}`, value: tiz.seconds[z]! });
    }
    metrics.push({ key: 'hr.trimp', value: trimp(hrStream, cfg) });
  }

  if (paceStream.length > 0 && thr.thresholdPaceMs && thr.thresholdPaceMs > 0) {
    const pm = paceMetrics(paceStream, thr.thresholdPaceMs);
    metrics.push({ key: 'pace.ngp_ms', value: pm.ngpSpeedMs });
    metrics.push({ key: 'pace.if', value: pm.intensityFactor });
    metrics.push({ key: 'pace.rTSS', value: pm.rTSS });
    if (summary.tss === null) summary.tss = pm.rTSS;
  }

  return { summary, metrics };
}

function densifyToHz(samples: PowerSample[]): number[] {
  if (samples.length === 0) return [];
  const first = Math.floor(samples[0]!.t);
  const last = Math.floor(samples[samples.length - 1]!.t);
  const out = new Array<number>(Math.max(0, last - first + 1)).fill(0);
  for (const s of samples) {
    const idx = Math.floor(s.t) - first;
    if (idx >= 0 && idx < out.length && typeof s.p === 'number') out[idx] = Math.max(0, s.p);
  }
  return out;
}

function computeGrade(samples: ActivityRecord['samples'], i: number): number | undefined {
  const a = samples[i];
  const b = samples[i + 1] ?? samples[i - 1];
  if (!a || !b || a === b) return undefined;
  if (typeof a.distance !== 'number' || typeof b.distance !== 'number') return undefined;
  if (typeof a.altitude !== 'number' || typeof b.altitude !== 'number') return undefined;
  const dDist = b.distance - a.distance;
  if (Math.abs(dDist) < 1) return undefined;
  return (b.altitude - a.altitude) / Math.abs(dDist);
}
