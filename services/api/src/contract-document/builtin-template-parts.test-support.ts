export function unicodePathOverride(source: Buffer, target: string, entryName = "word/document.xml"): Buffer {
  const end = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let entry = source.readUInt32LE(end + 16);
  while (source.subarray(entry + 46, entry + 46 + source.readUInt16LE(entry + 28)).toString() !== entryName) entry += 46 + source.readUInt16LE(entry + 28) + source.readUInt16LE(entry + 30) + source.readUInt16LE(entry + 32);
  const name = source.subarray(entry + 46, entry + 46 + source.readUInt16LE(entry + 28));
  let crc = 0xffffffff;
  for (const byte of name) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const path = Buffer.from(target), extra = Buffer.alloc(9 + path.length);
  extra.writeUInt16LE(0x7075, 0); extra.writeUInt16LE(5 + path.length, 2); extra[4] = 1; extra.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 5); path.copy(extra, 9);
  const insert = entry + 46 + name.length + source.readUInt16LE(entry + 30);
  const result = Buffer.concat([source.subarray(0, insert), extra, source.subarray(insert)]);
  result.writeUInt16LE(source.readUInt16LE(entry + 30) + extra.length, entry + 30);
  result.writeUInt16LE(source.readUInt16LE(entry + 8) & ~0x0800, entry + 8);
  const local = source.readUInt32LE(entry + 42); result.writeUInt16LE(source.readUInt16LE(local + 6) & ~0x0800, local + 6);
  result.writeUInt32LE(source.readUInt32LE(end + 12) + extra.length, end + extra.length + 12);
  return result;
}

