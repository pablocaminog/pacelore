import { describe, expect, it } from 'vitest';
import { processIngestJob } from '../src/pipeline/index.js';
import { fakeEnv, type FakeD1, type FakeR2 } from './helpers.js';
import type { IngestJob } from '../src/env.js';

const GPX = `<?xml version="1.0"?>
<gpx version="1.1"><trk><type>cycling</type><trkseg>
<trkpt lat="40.0" lon="-74.0"><ele>10</ele><time>2026-05-03T07:00:00Z</time>
  <extensions><power>200</power><gpxtpx:TrackPointExtension xmlns:gpxtpx="x"><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
</trkpt>
<trkpt lat="40.0001" lon="-74.0001"><ele>11</ele><time>2026-05-03T07:00:01Z</time>
  <extensions><power>210</power></extensions>
</trkpt>
</trkseg></trk></gpx>`;

async function withRawObject(env: ReturnType<typeof fakeEnv>, key: string, contents: string) {
  await env.RAW_BUCKET.put(key, new TextEncoder().encode(contents));
}

function seedUser(env: ReturnType<typeof fakeEnv>, id: string, ftp: number) {
  const db = env.DB as unknown as FakeD1;
  db.users.push({ id, handle: 'a', email: 'a@b', displayName: null, ftp, hrMax: 200, hrRest: 50 });
}

describe('processIngestJob', () => {
  it('parses, computes metrics, and persists an activity row', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a1',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/2026/05/a1.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);

    await processIngestJob(env, job);

    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
    const row = db.activities[0]!;
    expect(row.id).toBe('a1');
    expect(row.athlete_id).toBe('u1');
    expect(row.sport).toBe('cycling');
    expect(typeof row.power_avg).toBe('number');

    const parsed = (env.PARSED_BUCKET as unknown as FakeR2).store.get('parsed/u1/a1.json');
    expect(parsed).toBeDefined();
  });

  it('is idempotent — replaying does not duplicate rows', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a2',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/2026/05/a2.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);
    await processIngestJob(env, job);
    await processIngestJob(env, job);
    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
  });

  it('throws when the raw object is missing', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a3',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/missing.gpx',
      source: 'gpx',
    };
    await expect(processIngestJob(env, job)).rejects.toThrow(/raw object missing/);
  });

  it('still persists when the athlete has no FTP — power metrics skipped, hrTSS may estimate', async () => {
    const env = fakeEnv();
    (env.DB as unknown as FakeD1).users.push({
      id: 'u2',
      handle: 'b',
      email: 'b@b',
      displayName: null,
    });
    const job: IngestJob = {
      activityId: 'a4',
      athleteId: 'u2',
      rawR2Path: 'raw/u2/2026/05/a4.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);
    await processIngestJob(env, job);
    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
    // np stays null (no power stream), but tss may be a non-zero
    // hrTSS estimate when HR is present in the fixture and the
    // population-default HRmax/HRrest fallback fires.
    expect(db.activities[0]!.np).toBeNull();
  });
});
