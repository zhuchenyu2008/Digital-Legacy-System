import { deflateRawSync } from "node:zlib";

export type TestZipEntry = Readonly<{
  name: string;
  body?: Uint8Array;
  method?: 0 | 8;
  flags?: number;
  externalFileAttributes?: number;
  versionMadeBy?: number;
  rawName?: Uint8Array;
}>;

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) value = (value >>> 8) ^ (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
}

function writeU16(output: Uint8Array, offset: number, value: number): void {
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint16(offset, value, true);
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset, value, true);
}

export function createZip(entries: readonly TestZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const body = entry.body ?? new Uint8Array(0);
    const method = entry.method ?? 0;
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(body)) : body;
    const name = entry.rawName ?? new TextEncoder().encode(entry.name);
    const crc = crc32(body);
    const local = new Uint8Array(30 + name.length + compressed.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, entry.flags ?? 0);
    writeU16(local, 8, method);
    writeU32(local, 14, crc);
    writeU32(local, 18, compressed.length);
    writeU32(local, 22, body.length);
    writeU16(local, 26, name.length);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, entry.versionMadeBy ?? 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, entry.flags ?? 0);
    writeU16(central, 10, method);
    writeU32(central, 16, crc);
    writeU32(central, 20, compressed.length);
    writeU32(central, 24, body.length);
    writeU16(central, 28, name.length);
    writeU32(central, 38, entry.externalFileAttributes ?? 0);
    writeU32(central, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralSize = centralParts.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(localOffset + centralSize + 22);
  let offset = 0;
  for (const part of localParts) {
    output.set(part, offset);
    offset += part.length;
  }
  const centralOffset = offset;
  for (const part of centralParts) {
    output.set(part, offset);
    offset += part.length;
  }
  writeU32(output, offset, 0x06054b50);
  writeU16(output, offset + 8, entries.length);
  writeU16(output, offset + 10, entries.length);
  writeU32(output, offset + 12, centralSize);
  writeU32(output, offset + 16, centralOffset);
  return output;
}

export function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
