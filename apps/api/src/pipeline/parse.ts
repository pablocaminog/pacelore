/**
 * Source-aware parser dispatch.
 * Returns the normalized ActivityRecord regardless of source format.
 */

import { decode, parseGpx, parseTcx, type ActivityRecord } from '@pacelore/fit-parser';
import type { IngestJob } from '../env.js';

export async function parseRaw(job: IngestJob, raw: ArrayBuffer): Promise<ActivityRecord> {
  switch (job.source) {
    case 'fit':
      return decode(new Uint8Array(raw));
    case 'gpx':
      return parseGpx(new TextDecoder().decode(raw));
    case 'tcx':
      return parseTcx(new TextDecoder().decode(raw));
  }
}
