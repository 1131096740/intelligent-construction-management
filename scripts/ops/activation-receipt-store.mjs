import { createHash, randomUUID } from "node:crypto";
import fileSystem from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { constants } from "node:fs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Construct before publishing: ownership remains available even when a write,
// directory fsync, or the first cleanup attempt fails. Paths are trusted adapter
// configuration, never supplied by an activation request.
export function createActivationReceiptStore(outputPath) {
  const parent = dirname(outputPath);
  const temporary = join(parent, ".activation-" + randomUUID());
  let attempted = false;
  let receiptDigest;
  let bytesSha256;
  let handle;
  let inode;
  let linked = false;
  let capturedPath;
  let temporaryExists = false;
  let needsDirectorySync = false;

  async function syncDirectory() {
    const directory = await fileSystem.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); needsDirectorySync = false; } finally { await directory.close(); }
  }

  async function revoke(expectedDigest) {
    if (expectedDigest !== receiptDigest) throw new Error("RECEIPT_OWNERSHIP");
    const failures = [];
    const attempt = async (operation) => {
      try { await operation(); } catch { failures.push(true); }
    };
    if (handle) await attempt(async () => { await handle.close(); handle = undefined; });
    if (linked || capturedPath) await attempt(async () => {
      // Take the directory entry out of the shared pathname atomically before
      // inspecting it. Never unlink outputPath after a descriptor-only check.
      if (!capturedPath) {
        const capture = join(parent, ".activation-revoked-" + randomUUID());
        await fileSystem.rename(outputPath, capture);
        capturedPath = capture; linked = false; needsDirectorySync = true;
      }
      let owned = false;
      const current = await fileSystem.open(capturedPath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
      try {
        if (current) {
          const stat = await current.stat();
          owned = stat.dev === inode?.dev && stat.ino === inode?.ino && hash(await current.readFile()) === bytesSha256;
        }
      } finally { await current?.close(); }
      if (!owned) {
        // Restore the unrelated entry without overwriting a concurrent writer.
        // If occupied, retain the captured evidence and report failed cleanup.
        await fileSystem.link(capturedPath, outputPath);
        needsDirectorySync = true;
        // Unknown bytes are never deleted automatically, even after restoration.
        // Retain the private link for operator reconciliation on every retry.
        throw new Error("RECEIPT_OWNERSHIP");
      }
      await fileSystem.unlink(capturedPath); capturedPath = undefined; needsDirectorySync = true;
    });
    if (temporaryExists) await attempt(async () => {
      const stat = await fileSystem.lstat(temporary);
      if (stat.dev !== inode?.dev || stat.ino !== inode?.ino || stat.isSymbolicLink()) throw new Error("RECEIPT_OWNERSHIP");
      await fileSystem.unlink(temporary); temporaryExists = false; needsDirectorySync = true;
    });
    if (needsDirectorySync) await attempt(syncDirectory);
    if (failures.length) throw new Error("RECEIPT_CLEANUP_FAILED");
    return { revocationConfirmed: true };
  }

  async function publish(receipt) {
    if (attempted) throw new Error("RECEIPT_PUBLICATION_ALREADY_ATTEMPTED");
    attempted = true;
    receiptDigest = receipt.receiptSha256;
    try {
      if (!isAbsolute(outputPath)) throw new Error("RECEIPT_PATH");
      const directory = await fileSystem.lstat(parent);
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 || await fileSystem.realpath(parent) !== parent) throw new Error("RECEIPT_DIRECTORY");
      const bytes = Buffer.from(JSON.stringify(receipt));
      bytesSha256 = hash(bytes);
      handle = await fileSystem.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      temporaryExists = true;
      inode = await handle.stat();
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close(); handle = undefined;
      // Only complete, flushed bytes become visible, without overwriting a path.
      await fileSystem.link(temporary, outputPath); linked = true; needsDirectorySync = true;
      await syncDirectory();
      await fileSystem.unlink(temporary); temporaryExists = false; needsDirectorySync = true;
      await syncDirectory();
    } catch {
      try { await revoke(receiptDigest); } catch {
        const error = new Error("RECEIPT_CLEANUP_FAILED");
        error.publicationMayExist = linked || Boolean(capturedPath) || needsDirectorySync;
        throw error;
      }
      throw new Error("RECEIPT_PUBLICATION_FAILED");
    }
  }

  return { publish, revoke };
}

export async function publishActivationReceipt(outputPath, receipt) {
  const publication = createActivationReceiptStore(outputPath);
  await publication.publish(receipt);
  return publication;
}
