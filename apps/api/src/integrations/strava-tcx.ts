/**
 * Build a TCX string from Strava's public REST API.
 *
 * Background: `/activities/{id}/export_tcx` is a *website* endpoint
 * (browser session cookies, not API tokens). It can't be called from
 * a server with an OAuth Bearer. The public API only returns JSON.
 * To stay compatible with the existing TCX-parsing ingest pipeline we
 * fetch the activity summary + streams, then synthesize a TCX
 * document. Trackpoints come from the streams; if streams are empty
 * (rare — manual / indoor / no-GPS) we fall back to a two-point
 * synthetic track at the start + end so the parser has something to
 * chew on and downstream metrics still get the totals.
 */

const STRAVA_API = 'https://www.strava.com/api/v3';

interface StravaSummary {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  start_date_local?: string;
  elapsed_time: number;
  moving_time?: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  kilojoules?: number;
  calories?: number;
  average_speed?: number;
  max_speed?: number;
  average_cadence?: number;
}

interface StravaStreams {
  time?: { data: number[] };
  distance?: { data: number[] };
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  heartrate?: { data: number[] };
  watts?: { data: number[] };
  cadence?: { data: number[] };
  velocity_smooth?: { data: number[] };
}

export interface StravaFetched {
  tcx: string;
  summary: StravaSummary;
}

export async function fetchStravaActivityAsTcx(
  bearer: string,
  activityId: number,
): Promise<StravaFetched | null> {
  const sumRes = await fetch(`${STRAVA_API}/activities/${activityId}?include_all_efforts=false`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!sumRes.ok) return null;
  const summary = (await sumRes.json()) as StravaSummary;

  // Best-effort streams. A 404 means no GPS / power / HR data — that's
  // fine, we still build TCX with a two-point track from the summary.
  const streamsRes = await fetch(
    `${STRAVA_API}/activities/${activityId}/streams?keys=time,distance,latlng,altitude,heartrate,watts,cadence,velocity_smooth&key_by_type=true`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  );
  const streams: StravaStreams = streamsRes.ok ? ((await streamsRes.json()) as StravaStreams) : {};

  const tcx = buildTcx(summary, streams);
  return { tcx, summary };
}

function buildTcx(s: StravaSummary, streams: StravaStreams): string {
  const sport = mapSport(s.sport_type ?? s.type ?? 'Other');
  const startIso = ensureIso(s.start_date);
  const trackpoints = buildTrackpoints(s, streams, startIso);

  const ext = streams.watts || streams.cadence || streams.velocity_smooth ? 'true' : 'false';
  void ext;

  const lapAvgHr = s.average_heartrate;
  const lapMaxHr = s.max_heartrate;

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Id>${startIso}</Id>
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${num(s.elapsed_time)}</TotalTimeSeconds>
        <DistanceMeters>${num(s.distance)}</DistanceMeters>
        ${s.max_speed != null ? `<MaximumSpeed>${num(s.max_speed)}</MaximumSpeed>` : ''}
        ${s.calories != null ? `<Calories>${Math.round(s.calories)}</Calories>` : ''}
        ${
          lapAvgHr != null
            ? `<AverageHeartRateBpm><Value>${Math.round(lapAvgHr)}</Value></AverageHeartRateBpm>`
            : ''
        }
        ${
          lapMaxHr != null
            ? `<MaximumHeartRateBpm><Value>${Math.round(lapMaxHr)}</Value></MaximumHeartRateBpm>`
            : ''
        }
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          ${trackpoints}
        </Track>
        ${
          s.average_watts != null
            ? `<Extensions><ns3:LX><ns3:AvgWatts>${Math.round(s.average_watts)}</ns3:AvgWatts>${
                s.max_watts != null
                  ? `<ns3:MaxWatts>${Math.round(s.max_watts)}</ns3:MaxWatts>`
                  : ''
              }</ns3:LX></Extensions>`
            : ''
        }
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

function buildTrackpoints(
  s: StravaSummary,
  streams: StravaStreams,
  startIso: string,
): string {
  const startMs = new Date(startIso).getTime();
  const tArr = streams.time?.data ?? [];
  if (tArr.length > 0) {
    const distArr = streams.distance?.data ?? [];
    const latlngArr = streams.latlng?.data ?? [];
    const altArr = streams.altitude?.data ?? [];
    const hrArr = streams.heartrate?.data ?? [];
    const wattsArr = streams.watts?.data ?? [];
    const cadArr = streams.cadence?.data ?? [];
    const speedArr = streams.velocity_smooth?.data ?? [];

    return tArr
      .map((tSec, i) => {
        const ts = new Date(startMs + tSec * 1000).toISOString();
        const lat = latlngArr[i]?.[0];
        const lng = latlngArr[i]?.[1];
        const alt = altArr[i];
        const dist = distArr[i];
        const hr = hrArr[i];
        const w = wattsArr[i];
        const cad = cadArr[i];
        const sp = speedArr[i];
        const ext =
          w != null || cad != null || sp != null
            ? `<Extensions><ns3:TPX>${w != null ? `<ns3:Watts>${Math.round(w)}</ns3:Watts>` : ''}${
                cad != null ? `<ns3:RunCadence>${Math.round(cad)}</ns3:RunCadence>` : ''
              }${sp != null ? `<ns3:Speed>${num(sp)}</ns3:Speed>` : ''}</ns3:TPX></Extensions>`
            : '';
        return `<Trackpoint>
          <Time>${ts}</Time>
          ${
            lat != null && lng != null
              ? `<Position><LatitudeDegrees>${num(lat)}</LatitudeDegrees><LongitudeDegrees>${num(lng)}</LongitudeDegrees></Position>`
              : ''
          }
          ${alt != null ? `<AltitudeMeters>${num(alt)}</AltitudeMeters>` : ''}
          ${dist != null ? `<DistanceMeters>${num(dist)}</DistanceMeters>` : ''}
          ${hr != null ? `<HeartRateBpm><Value>${Math.round(hr)}</Value></HeartRateBpm>` : ''}
          ${ext}
        </Trackpoint>`;
      })
      .join('');
  }
  // Fallback: synthesize a two-point track from the summary alone.
  const endIso = new Date(startMs + s.elapsed_time * 1000).toISOString();
  const dist = num(s.distance);
  return `<Trackpoint>
    <Time>${startIso}</Time>
    <DistanceMeters>0</DistanceMeters>
  </Trackpoint>
  <Trackpoint>
    <Time>${endIso}</Time>
    <DistanceMeters>${dist}</DistanceMeters>
  </Trackpoint>`;
}

function ensureIso(s: string): string {
  // Strava returns ISO already, but be defensive.
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function num(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  return n.toFixed(3);
}

function mapSport(s: string): 'Running' | 'Biking' | 'Other' {
  const lower = s.toLowerCase();
  if (lower.includes('ride') || lower.includes('cycling') || lower.includes('bike')) return 'Biking';
  if (lower.includes('run') || lower.includes('walk') || lower.includes('hike')) return 'Running';
  return 'Other';
}
