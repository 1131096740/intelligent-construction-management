import { unicodePathOverride } from "./builtin-template-parts.test-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { reviewedBuiltinTemplateKind } from "./builtin-template-parts";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { renderContractBody, SIGNATURE_SUPPLEMENT_PAGE_VERSION } from "./contract-body-document";

const cases = [
  ["material-purchase-real-v1.docx", "material"],
  ["equipment-rental-real-v1.docx", "mechanical"],
  ["labor-subcontract-real-v1.docx", "labor"],
  ["generic-contract-v1.docx", "generic"]
] as const;
function alterCentral(source: Buffer, duplicate: boolean): Buffer {
  const end = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = source.readUInt16LE(end + 10), offset = source.readUInt32LE(end + 16);
  let cursor = offset; const records: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const length = 46 + source.readUInt16LE(cursor + 28) + source.readUInt16LE(cursor + 30) + source.readUInt16LE(cursor + 32);
    records.push(source.subarray(cursor, cursor + length)); cursor += length;
  }
  const entries = duplicate ? [...records, records[0]] : [...records].reverse();
  const directory = Buffer.concat(entries), trailer = Buffer.from(source.subarray(end));
  trailer.writeUInt16LE(entries.length, 8); trailer.writeUInt16LE(entries.length, 10); trailer.writeUInt32LE(directory.length, 12);
  return Buffer.concat([source.subarray(0, offset), directory, trailer]);
}
it.each(cases)("recognizes only byte-identical parts for %s", (file, kind) => {
  const source = readFileSync(join(__dirname, "../../assets/templates", file));
  const commented = new PizZip(source); commented.comment = "synthetic repack";
  expect(reviewedBuiltinTemplateKind(source)).toBe(kind);
  expect(reviewedBuiltinTemplateKind(commented.generate({ type: "nodebuffer" }))).toBe(kind);
  expect(reviewedBuiltinTemplateKind(alterCentral(source, false))).toBe(kind);
  const original = new PizZip(source), reordered = new PizZip();
  for (const name of Object.keys(original.files).reverse()) {
    const item = original.files[name]; reordered.file(name, item.dir ? Buffer.alloc(0) : item.asNodeBuffer(), { dir: item.dir, createFolders: false });
  }
  expect(reviewedBuiltinTemplateKind(reordered.generate({ type: "nodebuffer", compression: "DEFLATE" }))).toBe(kind);
  const changed = new PizZip(source); const content = changed.file("word/document.xml")!.asNodeBuffer(); content[content.length - 1] ^= 1; changed.file("word/document.xml", content);
  expect(reviewedBuiltinTemplateKind(changed.generate({ type: "nodebuffer" }))).toBeUndefined();
  const extra = new PizZip(source); extra.file("synthetic-extra", "x");
  expect(reviewedBuiltinTemplateKind(extra.generate({ type: "nodebuffer" }))).toBeUndefined();
  expect(reviewedBuiltinTemplateKind(alterCentral(source, true))).toBeUndefined();
});

it("rejects deflate data that expands beyond the trusted part size despite forged headers", () => {
  const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
  const sourceEnd = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let entry = source.readUInt32LE(sourceEnd + 16);
  while (source.subarray(entry + 46, entry + 46 + source.readUInt16LE(entry + 28)).toString() !== "word/document.xml") entry += 46 + source.readUInt16LE(entry + 28) + source.readUInt16LE(entry + 30) + source.readUInt16LE(entry + 32);
  const expectedSize = source.readUInt32LE(entry + 24), expectedCrc = source.readUInt32LE(entry + 16);
  const zip = new PizZip(source); zip.file("word/document.xml", Buffer.alloc(expectedSize + 50_000, 0x41));
  const forged = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const end = forged.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  entry = forged.readUInt32LE(end + 16);
  while (forged.subarray(entry + 46, entry + 46 + forged.readUInt16LE(entry + 28)).toString() !== "word/document.xml") entry += 46 + forged.readUInt16LE(entry + 28) + forged.readUInt16LE(entry + 30) + forged.readUInt16LE(entry + 32);
  const local = forged.readUInt32LE(entry + 42);
  forged.writeUInt32LE(expectedSize, entry + 24); forged.writeUInt32LE(expectedSize, local + 22);
  forged.writeUInt32LE(expectedCrc, entry + 16); forged.writeUInt32LE(expectedCrc, local + 14);
  expect(reviewedBuiltinTemplateKind(forged)).toBeUndefined();
});

it("retains the actual source identity while projecting an equivalent material template", () => {
  const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
  const repackedZip = new PizZip(source); repackedZip.comment = "synthetic repack";
  const repacked = repackedZip.generate({ type: "nodebuffer" });
  const positions = readLayoutSourcePositions(repacked);
  const bindings = positions.positions.flatMap(position => [["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey]) => { const start = position.text.indexOf(token); return start < 0 ? [] : [{ positionId: position.positionId, start, end: start + token.length, fieldKey }]; }));
  const mapped = prepareLayoutSourceMapping(repacked, "fixture", 2, bindings).docx;
  const output = renderContractBody(repacked, mapped, { values: { "contract.name":"虚构合同", "contract.temporaryCode":"TMP", "document.watermark":"草稿", "party.owner.name":"虚构甲方", "party.counterparty.name":"虚构乙方" } }, [], "layout", undefined, { partyDetailsVersion: SIGNATURE_SUPPLEMENT_PAGE_VERSION });
  expect(output.sourceSha256).toBe(positions.sourceSha256);
  expect(output.blocks.filter(block => block.text?.includes("虚构甲方"))).toHaveLength(2);
  expect(output.blocks.filter(block => block.text?.includes("虚构乙方"))).toHaveLength(2);
  const historic = renderContractBody(repacked, mapped, { values: { "contract.name":"虚构合同", "contract.temporaryCode":"TMP", "document.watermark":"草稿", "party.owner.name":"虚构甲方", "party.counterparty.name":"虚构乙方" } }, [], "layout");
  expect(historic.blocks.filter(block => block.text?.includes("虚构甲方"))).toHaveLength(3);
  expect(historic.blocks.filter(block => block.text?.includes("虚构乙方"))).toHaveLength(3);
});

it("rejects forged DOS directory flags and non-regular POSIX file types", () => {
  const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
  const end = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let entry = source.readUInt32LE(end + 16);
  while (source.subarray(entry + 46, entry + 46 + source.readUInt16LE(entry + 28)).toString() !== "word/document.xml") entry += 46 + source.readUInt16LE(entry + 28) + source.readUInt16LE(entry + 30) + source.readUInt16LE(entry + 32);
  const directoryFlag = Buffer.from(source); directoryFlag.writeUInt32LE(directoryFlag.readUInt32LE(entry + 38) | 0x10, entry + 38);
  expect(reviewedBuiltinTemplateKind(directoryFlag)).toBeUndefined();
  const symlink = Buffer.from(source); symlink.writeUInt16LE((3 << 8) | (symlink.readUInt16LE(entry + 4) & 0xff), entry + 4); symlink.writeUInt32LE((0o120777 << 16) >>> 0, entry + 38);
  expect(reviewedBuiltinTemplateKind(symlink)).toBeUndefined();
});


it.each(["synthetic-renamed.xml", "word/styles.xml"])("rejects a real PizZip Unicode path override to %s", target => {
  const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
  const forged = unicodePathOverride(source, target), zip = new PizZip(forged);
  expect(zip.file("word/document.xml")).toBeNull();
  expect(zip.file(target)).not.toBeNull();
  if (target === "synthetic-renamed.xml") expect(zip.file(target)!.asNodeBuffer().equals(new PizZip(source).file("word/document.xml")!.asNodeBuffer())).toBe(true);
  expect(reviewedBuiltinTemplateKind(forged)).toBeUndefined();
});

it("rejects a Unicode path field in the local header as well as malformed extra fields", () => {
  const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
  const end = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), central = source.readUInt32LE(end + 16);
  const insert = 30 + source.readUInt16LE(26) + source.readUInt16LE(28), extra = Buffer.from([0x75, 0x70, 0, 0]);
  const forged = Buffer.concat([source.subarray(0, insert), extra, source.subarray(insert)]);
  forged.writeUInt16LE(source.readUInt16LE(28) + extra.length, 28);
  let entry = central + extra.length;
  for (let i = 0; i < source.readUInt16LE(end + 10); i++) {
    const local = forged.readUInt32LE(entry + 42);
    if (local !== 0) forged.writeUInt32LE(local + extra.length, entry + 42);
    entry += 46 + forged.readUInt16LE(entry + 28) + forged.readUInt16LE(entry + 30) + forged.readUInt16LE(entry + 32);
  }
  forged.writeUInt32LE(central + extra.length, end + extra.length + 16);
  expect(reviewedBuiltinTemplateKind(forged)).toBeUndefined();
  const malformed = Buffer.from(forged); malformed.writeUInt16LE(0x9999, insert); malformed.writeUInt16LE(1, insert + 2);
  expect(reviewedBuiltinTemplateKind(malformed)).toBeUndefined();
});
