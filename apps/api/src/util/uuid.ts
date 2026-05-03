/**
 * UUIDv7 generator — sortable by creation time, unique enough for D1 ids.
 * crypto.randomUUID() returns v4; we synthesize v7 to keep ids monotonic
 * for index-friendly inserts.
 */

export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const rnd = new Uint8Array(10);
  crypto.getRandomValues(rnd);

  // bytes 0..5: 48-bit unix ms timestamp, big-endian
  const bytes = new Uint8Array(16);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number((ms >> BigInt((5 - i) * 8)) & 0xffn);
  }
  // bytes 6..15: random, with version (7) and variant (10) bits set
  bytes.set(rnd.subarray(0, 10), 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
