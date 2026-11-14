"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const schemaPath = "services/api/prisma/schema.prisma";
const schemaSha256 = {
  204: "3f41995f48430e7adfeefb8ec605203d8ce501bb7214c66619a9142bfcf7a3f1",
  205: "68b76ddd1ca8dda27ebb511db2d5fa49285eab5c7b95e83f9cac20b3c26a7286",
  206: "60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4",
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Only test-owned copies can use earlier Schema bytes. Exact hashes bound both
// sides of each inversion so drift cannot become a different mock baseline.
function readTask16FixtureSchema(root, version) {
  let bytes = readFileSync(path.join(root, schemaPath));
  const current = hash(bytes);
  if (current === schemaSha256[version]) return bytes;
  if (version === 204 || version === 205) {
    if (current === schemaSha256[206]) {
      bytes = Buffer.from(bytes.toString("utf8")
        .replace("  economicReviewFileReferences            ContractEconomicReviewFileReference[]\n", "")
        .replace('  @@index([objectKey], map: "FileObject_objectKey_direct_retention_idx")\n', "")
        .replace("  directSourcePins      Json?\n  directFileReferences  ContractEconomicReviewFileReference[]\n", "")
        .replace(/^model ContractEconomicReviewFileReference \{[\s\S]*?^\}\n\n/mu, ""));
    }
    assert.equal(hash(bytes), schemaSha256[205], "Task16 mock requires the exact Schema205 preimage");
    if (version === 204) {
      const addition = "  /// Original paper number; nonempty source text is preserved, including whitespace.\n  originalSignedNumber                   String?\n";
      bytes = Buffer.from(bytes.toString("utf8").replace(addition, ""));
    }
  }
  assert.equal(hash(bytes), schemaSha256[version], `Task16 mock requires the exact Schema${version} input`);
  return bytes;
}

module.exports = { readTask16FixtureSchema, schemaPath };
