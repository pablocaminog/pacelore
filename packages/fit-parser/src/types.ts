/**
 * Normalized representation produced by every parser (FIT / TCX / GPX).
 * Downstream consumers (metrics, segments, fanout) operate on this shape only.
 */

export type Sport =
  | 'cycling'
  | 'running'
  | 'walking'
  | 'hiking'
  | 'swimming'
  | 'rowing'
  | 'skiing'
  | 'strength'
  | 'other';

export type SourceFormat = 'fit' | 'tcx' | 'gpx';

export interface Sample {
  /** Seconds since activity start. */
  t: number;
  /** Latitude, semicircles → degrees normalized. */
  lat?: number;
  lng?: number;
  /** Altitude in meters. */
  altitude?: number;
  /** Distance in meters since activity start. */
  distance?: number;
  /** Heart rate in bpm. */
  hr?: number;
  /** Power in watts. */
  power?: number;
  /** Cadence — rpm for cycling, spm for running. */
  cadence?: number;
  /** Speed in m/s. */
  speed?: number;
  /** Temperature in Celsius. */
  temperature?: number;
  /** Left/right power balance, 0..100. */
  leftRightBalance?: number;
}

export interface Lap {
  startedAt: Date;
  totalSeconds: number;
  totalDistance?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  maxPower?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  totalAscent?: number;
  totalDescent?: number;
}

export interface Session {
  sport: Sport;
  startedAt: Date;
  totalSeconds: number;
  totalDistance?: number;
  totalAscent?: number;
  totalDescent?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  normalizedPower?: number;
  maxPower?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  totalCalories?: number;
}

export interface ActivityRecord {
  source: SourceFormat;
  /** Manufacturer / device-reported file id when present (FIT only). */
  deviceFileId?: string;
  session: Session;
  laps: Lap[];
  /** Sample stream, time-ordered. May be 1Hz or sparser. */
  samples: Sample[];
}
