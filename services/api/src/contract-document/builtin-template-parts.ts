import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { inflateRawSync } from "node:zlib";

type Kind = "material" | "mechanical" | "labor" | "generic";
type Part = { name: string; directory: boolean; size: number; crc: number; method: number; dataStart: number; dataEnd: number };
const references: ReadonlyArray<{ kind: Kind; file: string; sha256: string }> = [
  { kind: "material", file: "material-purchase-real-v1.docx", sha256: "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd" },
  { kind: "mechanical", file: "equipment-rental-real-v1.docx", sha256: "b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89" },
  { kind: "labor", file: "labor-subcontract-real-v1.docx", sha256: "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47" },
  { kind: "generic", file: "generic-contract-v1.docx", sha256: "ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d" }
];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function checkExtraFields(bytes: Buffer, start: number, length: number): void {
  const end = start + length;
  if (end > bytes.length) throw new Error("zip");
  for (let cursor = start; cursor < end;) {
    if (cursor + 4 > end) throw new Error("zip");
    const id = bytes.readUInt16LE(cursor), size = bytes.readUInt16LE(cursor + 2);
    cursor += 4;
    // PizZip may replace the header name using this field when UTF-8 is unset.
    if (id === 0x7075 || cursor + size > end) throw new Error("zip");
    cursor += size;
  }
}

// PizZip exposes entries in an object keyed by name, so duplicate names must
// be rejected from the central directory before its contents are compared.
function parts(bytes: Buffer): Part[] {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const end = bytes.lastIndexOf(signature);
  if (end < 0 || end + 22 > bytes.length || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
      bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error("zip");
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count !== bytes.readUInt16LE(end + 8) || start + size !== end) throw new Error("zip");
  const result: Part[] = [], seen = new Set<string>(), ranges: Array<[number, number]> = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("zip");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), unpacked = bytes.readUInt32LE(cursor + 24);
    const nameLen = bytes.readUInt16LE(cursor + 28), extraLen = bytes.readUInt16LE(cursor + 30), commentLen = bytes.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLen + extraLen + commentLen, local = bytes.readUInt32LE(cursor + 42);
    if (next > end || !nameLen || bytes.readUInt16LE(cursor + 34) !== 0 || (flags & ~0x0800) !== 0 || ![0, 8].includes(method) || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw new Error("zip");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLen), name = rawName.toString("utf8");
    checkExtraFields(bytes, cursor + 46 + nameLen, extraLen);
    if (!Buffer.from(name, "utf8").equals(rawName) || seen.has(name) || name.startsWith("/") || name.split("/").some(piece => piece === "." || piece === "..") || name.includes("\\")) throw new Error("zip");
    seen.add(name);
    const madeBy = bytes.readUInt16LE(cursor + 4) >>> 8, attributes = bytes.readUInt32LE(cursor + 38);
    const directory = (attributes & 0x10) !== 0 || name.endsWith("/");
    if (directory !== name.endsWith("/") || ![0, 3].includes(madeBy)) throw new Error("zip");
    if (madeBy === 3) {
      const modeType = (attributes >>> 16) & 0o170000;
      if (modeType !== (directory ? 0o040000 : 0o100000)) throw new Error("zip");
    }
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), dataStart = local + 30 + localName + localExtra, dataEnd = dataStart + compressed;
    if (dataEnd > start || !bytes.subarray(local + 30, local + 30 + localName).equals(rawName) || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== unpacked || bytes.readUInt32LE(local + 14) !== bytes.readUInt32LE(cursor + 16)) throw new Error("zip");
    checkExtraFields(bytes, local + 30 + localName, localExtra);
    ranges.push([local, dataEnd]); result.push({ name, directory, size: unpacked, crc: bytes.readUInt32LE(cursor + 16), method, dataStart, dataEnd }); cursor = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (cursor !== end || ranges[0][0] !== 0 || ranges.some((range, i) => i > 0 && ranges[i - 1][1] !== range[0]) || ranges[ranges.length - 1][1] !== start) throw new Error("zip");
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function reviewedBuiltinTemplateKind(source: Buffer): Kind | undefined {
  try {
    const sourceParts = parts(source);
    for (const reference of references) {
      const expected = readFileSync(join(__dirname, "../../assets/templates", reference.file));
      if (sha(expected) !== reference.sha256) continue;
      const expectedParts = parts(expected);
      if (sourceParts.length !== expectedParts.length || sourceParts.some((part, i) => part.name !== expectedParts[i].name || part.directory !== expectedParts[i].directory || part.size !== expectedParts[i].size || part.crc !== expectedParts[i].crc)) continue;
      const trusted = new PizZip(expected, { checkCRC32: true });
      if (sourceParts.every(part => {
        const compressed = source.subarray(part.dataStart, part.dataEnd);
        const decoded = part.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: part.size + 1 });
        return decoded.length === part.size && (part.directory ? decoded.length === 0 : decoded.equals(trusted.file(part.name)!.asNodeBuffer()));
      })) return reference.kind;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
