const UUID_VERSION_7 = 0x70;
const UUID_VARIANT = 0x80;

export type RandomBytes = (target: Uint8Array) => Uint8Array;

export function createUuidV7(nowMs: number, fillRandomBytes: RandomBytes): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new Error('UUIDv7 timestamp must fit in 48 bits.');
  }

  const bytes = fillRandomBytes(new Uint8Array(16));
  if (bytes.length !== 16) {
    throw new Error('UUIDv7 requires exactly 16 random bytes.');
  }

  let timestamp = nowMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | UUID_VERSION_7;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | UUID_VARIANT;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
