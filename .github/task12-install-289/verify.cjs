'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { contract289, verifyMaterialized } = require('./checkout.cjs');
const expected = require('./exact-source.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const product = process.argv[2];
const profile = verifyMaterialized(product, contract289);
assert.equal(profile.tree, expected.productTree);
const prisma = join(product, 'services/api/prisma');
assert.equal(sha(fs.readFileSync(join(prisma, 'schema.prisma'))), expected.schema);
const migrations = join(prisma, 'migrations');
const ledger = fs.readdirSync(migrations).filter(name => name !== 'migration_lock.toml').sort().map(name => ({
  name,
  sha256: sha(fs.readFileSync(join(migrations, name, 'migration.sql'))),
  finished: true,
  rolledBack: false,
}));
assert.equal(ledger.length, 289);
assert.deepEqual(ledger.slice(286), expected.successors);
for (const [count, digest] of [[286, expected.prefix286], [287, expected.prefix287], [288, expected.prefix288], [289, expected.ordered289]]) {
  assert.equal(sha(JSON.stringify(ledger.slice(0, count))), digest);
}
console.log(JSON.stringify({status:'VERIFIED_289_INSTALL_INPUTS_NO_DATABASE', platform:process.platform, arch:process.arch, productTree:profile.tree, indexSha256:profile.indexSha256, archiveSha256:profile.materializedSha256, ledgerSha256:expected.ordered289}));
