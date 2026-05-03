/**
 * FIT CRC-16 — table-driven, polynomial used by Garmin's FIT spec.
 * Process all bytes preceding the 2-byte trailing CRC, then compare.
 */

const CRC_TABLE = new Uint16Array([
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
]);

export function fitCrc(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;

    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >>> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;

    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >>> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc & 0xffff;
}
