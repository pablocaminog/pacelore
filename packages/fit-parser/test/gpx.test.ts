import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/xml/gpx.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Pacelore" version="1.1"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Morning Ride</name>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="40.7128" lon="-74.0060">
        <ele>10</ele>
        <time>2026-05-03T07:00:00Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>120</gpxtpx:hr>
            <gpxtpx:cad>85</gpxtpx:cad>
            <gpxtpx:atemp>18</gpxtpx:atemp>
          </gpxtpx:TrackPointExtension>
          <power>200</power>
        </extensions>
      </trkpt>
      <trkpt lat="40.7129" lon="-74.0061">
        <ele>11</ele>
        <time>2026-05-03T07:00:01Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>122</gpxtpx:hr>
          </gpxtpx:TrackPointExtension>
          <power>210</power>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx', () => {
  it('parses track points and extensions', () => {
    const ar = parseGpx(SAMPLE);
    expect(ar.source).toBe('gpx');
    expect(ar.session.sport).toBe('cycling');
    expect(ar.samples).toHaveLength(2);
    expect(ar.samples[0]).toMatchObject({
      t: 0,
      lat: 40.7128,
      lng: -74.006,
      altitude: 10,
      hr: 120,
      cadence: 85,
      power: 200,
      temperature: 18,
    });
    expect(ar.samples[1]?.t).toBe(1);
    expect(ar.samples[1]?.hr).toBe(122);
    expect(ar.session.totalSeconds).toBe(1);
  });

  it('throws on non-GPX input', () => {
    expect(() => parseGpx('<not-gpx/>')).toThrow();
  });

  it('throws when no track points present', () => {
    expect(() => parseGpx('<gpx><trk><trkseg></trkseg></trk></gpx>')).toThrow();
  });
});
