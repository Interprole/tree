import { inflate } from 'pako';

/**
 * Convert WOFF 1.0 to a plain TrueType/OpenType file (pdf-lib embeds raw sfnt data,
 * so WOFF has to be unpacked first). Non-WOFF input is returned unchanged.
 */
export function woffToSfnt(input: ArrayBuffer): Uint8Array {
  const src = new DataView(input);
  if (src.byteLength < 44 || src.getUint32(0) !== 0x774f4646 /* 'wOFF' */) return new Uint8Array(input);
  const flavor = src.getUint32(4);
  const numTables = src.getUint16(12);
  const tables: { tag: number; offset: number; compLength: number; origLength: number; checksum: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    tables.push({ tag: src.getUint32(o), offset: src.getUint32(o + 4), compLength: src.getUint32(o + 8), origLength: src.getUint32(o + 12), checksum: src.getUint32(o + 16) });
  }
  const headerSize = 12 + numTables * 16;
  let size = headerSize;
  for (const t of tables) size += (t.origLength + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  dv.setUint32(0, flavor);
  dv.setUint16(4, numTables);
  dv.setUint16(6, searchRange);
  dv.setUint16(8, entrySelector);
  dv.setUint16(10, numTables * 16 - searchRange);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const raw = new Uint8Array(input, t.offset, t.compLength);
    const data = t.compLength < t.origLength ? inflate(raw) : raw;
    const e = 12 + i * 16;
    dv.setUint32(e, t.tag);
    dv.setUint32(e + 4, t.checksum);
    dv.setUint32(e + 8, offset);
    dv.setUint32(e + 12, t.origLength);
    out.set(data.subarray(0, t.origLength), offset);
    offset += (t.origLength + 3) & ~3;
  });
  return out;
}
