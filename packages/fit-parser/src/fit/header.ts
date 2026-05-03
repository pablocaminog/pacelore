/**
 * FIT file header (12 or 14 bytes).
 *
 * Layout (little-endian unless noted):
 *   0    u8   header size (12 or 14)
 *   1    u8   protocol version
 *   2    u16  profile version
 *   4    u32  data length (bytes after header, excluding 2-byte CRC trailer)
 *   8    4xu8 ".FIT" magic
 *   12   u16  CRC of header bytes 0..11 (only when header size == 14)
 *
 * Reference: FIT Protocol — Garmin SDK, file format spec.
 */

export const FIT_MAGIC = new Uint8Array([0x2e, 0x46, 0x49, 0x54]); // ".FIT"

export interface FitHeader {
  headerSize: 12 | 14;
  protocolVersion: number;
  profileVersion: number;
  dataLength: number;
  /** Header CRC when headerSize === 14, else undefined. */
  headerCrc?: number;
}

export class FitParseError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
    this.name = 'FitParseError';
  }
}

export function readHeader(buf: Uint8Array): FitHeader {
  if (buf.length < 12) {
    throw new FitParseError(`buffer too small for FIT header (${buf.length} bytes)`, 0);
  }

  const headerSize = buf[0];
  if (headerSize !== 12 && headerSize !== 14) {
    throw new FitParseError(`invalid FIT header size ${headerSize}`, 0);
  }

  if (buf.length < headerSize) {
    throw new FitParseError(`truncated FIT header (need ${headerSize}, got ${buf.length})`, 0);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const protocolVersion = view.getUint8(1);
  const profileVersion = view.getUint16(2, true);
  const dataLength = view.getUint32(4, true);

  for (let i = 0; i < 4; i++) {
    if (buf[8 + i] !== FIT_MAGIC[i]) {
      throw new FitParseError('missing .FIT magic in header', 8);
    }
  }

  const out: FitHeader = {
    headerSize,
    protocolVersion,
    profileVersion,
    dataLength,
  };

  if (headerSize === 14) {
    out.headerCrc = view.getUint16(12, true);
  }

  return out;
}
