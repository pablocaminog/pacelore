import { describe, expect, it } from 'vitest';
import { FitParseError, readHeader } from '../src/fit/header.js';
import { fitCrc } from '../src/fit/crc.js';

function buildHeader(opts: {
  size?: 12 | 14;
  protocolVersion?: number;
  profileVersion?: number;
  dataLength?: number;
  withCrc?: boolean;
}): Uint8Array {
  const size = opts.size ?? 14;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  buf[0] = size;
  view.setUint8(1, opts.protocolVersion ?? 0x20);
  view.setUint16(2, opts.profileVersion ?? 2140, true);
  view.setUint32(4, opts.dataLength ?? 0, true);
  buf[8] = 0x2e;
  buf[9] = 0x46;
  buf[10] = 0x49;
  buf[11] = 0x54;
  if (size === 14 && opts.withCrc) {
    const crc = fitCrc(buf.subarray(0, 12));
    view.setUint16(12, crc, true);
  }
  return buf;
}

describe('readHeader', () => {
  it('parses a 14-byte header', () => {
    const buf = buildHeader({ size: 14, dataLength: 1234, withCrc: true });
    const h = readHeader(buf);
    expect(h.headerSize).toBe(14);
    expect(h.protocolVersion).toBe(0x20);
    expect(h.profileVersion).toBe(2140);
    expect(h.dataLength).toBe(1234);
    expect(typeof h.headerCrc).toBe('number');
  });

  it('parses a 12-byte legacy header without CRC', () => {
    const buf = buildHeader({ size: 12, dataLength: 42 });
    const h = readHeader(buf);
    expect(h.headerSize).toBe(12);
    expect(h.dataLength).toBe(42);
    expect(h.headerCrc).toBeUndefined();
  });

  it('rejects buffer too small', () => {
    expect(() => readHeader(new Uint8Array(4))).toThrow(FitParseError);
  });

  it('rejects an unknown header size', () => {
    const buf = new Uint8Array(20);
    buf[0] = 16;
    expect(() => readHeader(buf)).toThrow(FitParseError);
  });

  it('rejects missing .FIT magic', () => {
    const buf = buildHeader({});
    buf[8] = 0x00;
    expect(() => readHeader(buf)).toThrow(FitParseError);
  });
});

describe('fitCrc', () => {
  it('returns 0 for an empty buffer', () => {
    expect(fitCrc(new Uint8Array(0))).toBe(0);
  });

  it('is deterministic', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(fitCrc(buf)).toBe(fitCrc(buf));
  });

  it('changes when input changes', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(fitCrc(a)).not.toBe(fitCrc(b));
  });
});
