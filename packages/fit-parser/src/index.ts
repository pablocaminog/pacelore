export type { ActivityRecord, Sample, Lap, Session, Sport, SourceFormat } from './types.js';
export { readHeader, FitParseError, FIT_MAGIC } from './fit/header.js';
export type { FitHeader } from './fit/header.js';
export { fitCrc } from './fit/crc.js';
