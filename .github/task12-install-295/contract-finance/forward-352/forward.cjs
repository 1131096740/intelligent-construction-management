'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Called only after the existing 350 installer has checked its own postconditions.
module.exports = async function forward352(context) {
  const { folder, cli, engine, endpoint, command, jsonSql, control, roleIdentity,
    qualifiedLedger, receipt, enter, finalSql, final } = context;
  const manifest = JSON.parse(fs.readFileSync('/qualification/forward-352/manifest.json', 'utf8'));
  assert.equal(manifest.migrations.length, 2);
  assert.match(manifest.candidate, /^[a-f0-9]{40}$/u);
  assert.equal(qualifiedLedger.length, 350);
  const expected = [...qualifiedLedger];
  for (const row of manifest.migrations) {
    assert.match(row.name, /^2026112902(?:00|10)00_[a-z0-9_]+$/u);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    const bytes = fs.readFileSync(path.join('/qualification/forward-352', row.name, 'migration.sql'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    const dir = path.join(folder, 'migrations', row.name);
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'migration.sql'), bytes, { flag: 'wx', mode: 0o600 });
    enter('FORWARD_352_MIGRATE_' + (expected.length + 1));
    await command(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.join(folder, 'schema.prisma')], {
      timeoutMs: 180000, extra: { DATABASE_URL: endpoint.toString(), PRISMA_SCHEMA_ENGINE_BINARY: engine,
        PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' }
    });
    expected.push({ ...row, finished: true, rolledBack: false });
    const observed = await jsonSql(control.inspectSql());
    assert.deepEqual(observed.ledger, expected, 'FORWARD_352_LEDGER');
    for (const key of ['database','databaseOid','namespaceOid','systemIdentifier','ownerOid','actorOid','sessionActor']) {
      assert.equal(observed[key], roleIdentity[key], 'FORWARD_352_IDENTITY_' + key);
    }
  }
  assert.deepEqual(await jsonSql(finalSql), final, 'FORWARD_352_PROTECTED_CATALOG');
  const target = await jsonSql(`SELECT jsonb_build_object(
    'batch',to_regclass('public."CompanyHistoryExpenseBatch"') IS NOT NULL,
    'row',to_regclass('public."CompanyHistoryExpenseRow"') IS NOT NULL,
    'fact',to_regclass('public."CompanyHistoryExpenseFact"') IS NOT NULL,
    'immutable',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='CompanyHistoryExpenseFact_immutable' AND tgenabled='O')
  )`);
  assert.deepEqual(target, { batch: true, row: true, fact: true, immutable: true });
  receipt.forward352 = { candidateSha: manifest.candidate, migrationCount: expected.length,
    ledgerSha256: createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    sameDatabase: true, protectedCatalog: true, target };
};
