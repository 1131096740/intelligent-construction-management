import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
import { PDFDocument } from "pdf-lib";

/** Creates only a fictional isolated fixture; never proof of an actual signature. */
export async function createCashFixtureDocument(root: string, runId: string) {
  const fail = (): never => { throw new Error("PUBLIC_CASH_DOCUMENT_CHANGED"); };
  if (!isAbsolute(root) || normalize(root) !== root || realpathSync(root) !== root ||
      !/^[a-f0-9]{12}$/.test(runId)) return fail();
  const parent = lstatSync(root, { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== BigInt(process.getuid!()) || (parent.mode & 0o777n) !== 0o700n) return fail();
  const pdf = await PDFDocument.create();
  pdf.setTitle("Synthetic settlement fixture");
  pdf.setAuthor("Synthetic fixture");
  pdf.setCreationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.setModificationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.addPage().drawText("Synthetic fixture; not a signed business document.");
  const bytes = Buffer.from(await pdf.save());
  const objectKey = `cash-settlement-${runId}.pdf`;
  const file = join(root, objectKey);
  const beforeCreate = lstatSync(root, { bigint: true });
  if (!beforeCreate.isDirectory() || beforeCreate.isSymbolicLink() || beforeCreate.dev !== parent.dev ||
      beforeCreate.ino !== parent.ino || beforeCreate.mode !== parent.mode || beforeCreate.uid !== parent.uid || realpathSync(root) !== root) return fail();
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let identity: ReturnType<typeof fstatSync>;
  try { writeFileSync(fd, bytes); fsyncSync(fd); identity = fstatSync(fd); } finally { closeSync(fd); }
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const verify = () => {
    const now = lstatSync(root, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== parent.dev || now.ino !== parent.ino ||
        now.mode !== parent.mode || now.uid !== parent.uid || realpathSync(root) !== root) return fail();
    const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const a = fstatSync(handle), content = readFileSync(handle), b = fstatSync(handle), named = lstatSync(file);
      if (!a.isFile() || named.isSymbolicLink() || a.nlink !== 1 || a.dev !== identity.dev || a.ino !== identity.ino ||
          a.dev !== named.dev || a.ino !== named.ino || a.size !== bytes.length || a.size !== b.size ||
          a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs || a.mode !== identity.mode ||
          a.uid !== identity.uid || (a.mode & 0o777) !== 0o600 || createHash("sha256").update(content).digest("hex") !== contentSha256) return fail();
    } finally { closeSync(handle); }
  };
  verify();
  return Object.freeze({ objectKey, sizeBytes: bytes.length, contentSha256, verify });
}
