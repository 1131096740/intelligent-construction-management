'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { admitSource } = require('./install-only292.cjs');
const { withCombined345ExpenseWitness } = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const profile = require('./expense-witness-345-profile.cjs');
const historical = require('./historical-settlement-334-profile.cjs');
const source = require('./contract-finance-source.json');
const inputs = require('./expense-witness-inputs.json');

const root = '/qualification';
const api = path.join(root, 'workspace/services/api');
const file = 'src/expense-claim/expense-claim-entry.http.pg.spec.ts';
const helper = 'src/database/pol115-owned-334.test-support.ts';
const titles = [
  '本人申请：无项目人员可报销非项目费用，不能代办或审批付款',
  '填写选项提供与提交快照相同的统一字段定义，非项目报销不借用个人资料授权'
];
const suiteTitle = '费用统一录入真实 HTTP 与 PostgreSQL 16';
const receipt = { schemaVersion: 1, purpose: 'POL115_NON_PROJECT_EXPENSE_WITNESS_345',
  sourceSha: source.sourceSha, stages: ['INPUTS'], status: 'STOPPED', fullShardEligible: false };
const hash = value => createHash('sha256').update(value).digest('hex');

const controls = `
DO $proof$
DECLARE
  independent public."ExpenseClaim"%rowtype;
  explicit_witness public."ExpenseClaim"%rowtype;
  fixture_project text;
  changed record;
  constraint_name text;
BEGIN
  SELECT * INTO STRICT independent FROM public."ExpenseClaim" WHERE reason='办公室交通';
  IF independent."projectId" IS NOT NULL OR independent."factWitnessUserId" IS NOT NULL
    OR independent."factWitnessNameSnapshot" IS NOT NULL OR independent."generalProcurementId" IS NOT NULL
    OR independent."actualPurchaseBatchId" IS NOT NULL OR independent."claimType" <> 'reimbursement'
    OR independent.status <> 'approved_pending_payment' OR independent."companyPayableAmountCents" <> 3500
    OR independent."fundedAmountCents" <> 0 THEN
    RAISE EXCEPTION 'EXPENSE_WITNESS_345_INDEPENDENT_ROW';
  END IF;
  SELECT * INTO STRICT explicit_witness FROM public."ExpenseClaim"
  WHERE "projectId" IS NULL AND "factWitnessUserId" IS NOT NULL
    AND "claimType"='reimbursement' AND status='approval_pending';
  IF nullif(btrim(explicit_witness."factWitnessNameSnapshot"),'') IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_WITNESS_345_EXPLICIT_WITNESS_ROW';
  END IF;
  SELECT id INTO STRICT fixture_project FROM public."Project" WHERE name='入口合成项目';
  FOR changed IN SELECT * FROM (VALUES
    (independent.id, NULL::text, explicit_witness."factWitnessUserId", NULL::text, 'reimbursement'),
    (independent.id, NULL::text, NULL::text, explicit_witness."factWitnessNameSnapshot", 'reimbursement'),
    (independent.id, NULL::text, explicit_witness."factWitnessUserId", ' ', 'reimbursement'),
    (independent.id, NULL::text, NULL::text, NULL::text, 'incidental_expense'),
    (explicit_witness.id, fixture_project, explicit_witness."factWitnessUserId", explicit_witness."factWitnessNameSnapshot", 'reimbursement')
  ) attempts(id, project, actor, actor_name, claim_type)
  LOOP
    BEGIN
      UPDATE public."ExpenseClaim" SET "projectId"=changed.project, "factWitnessUserId"=changed.actor,
        "factWitnessNameSnapshot"=changed.actor_name, "claimType"=changed.claim_type WHERE id=changed.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_WITNESS_345_CONTROL_ROW_MISSING'; END IF;
      RAISE EXCEPTION 'EXPENSE_WITNESS_345_CONTROL_ACCEPTED';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name IS DISTINCT FROM 'ExpenseClaim_fact_witness_tuple_check' THEN RAISE; END IF;
    END;
  END LOOP;
END
$proof$;
SELECT jsonb_build_object('independentPendingPayment',true,'explicitWitnessPendingApproval',true,'deniedByWitnessConstraint',5);
`;

async function consume({ ownerUrl, database, runId, workDir, candidateTree, sql }) {
  assert.equal(candidateTree, source.sourceTree);
  assert.equal(database, 'jg_task01_' + runId.replaceAll('-', ''));
  const url = new URL(ownerUrl);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'jg_task01_owner');
  assert.equal(url.pathname, '/' + database);
  assert.equal(url.searchParams.getAll('sslmode').join(','), 'require');
  assert.equal(url.searchParams.getAll('sslaccept').join(','), 'strict');
  assert.equal(url.searchParams.getAll('sslcert').join(','), path.join(workDir, 'ca.crt'));
  historical.assertFinanceInstallation(receipt, { ...source, tails: source.tails.slice(0, 39) });
  assert.equal(receipt.expenseWitnessForward.count, 345);
  assert.equal(receipt.expenseWitnessForward.ledgerSha256, profile.ledgerSha256);
  const { stdout } = await sql(`SELECT (current_user=session_user AND
    current_user='jg_task01_owner' AND current_user::regrole::oid=10 AND
    EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10) AND
    current_setting('server_version_num')::int BETWEEN 160000 AND 169999 AND
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text;`);
  assert.equal(stdout.trim(), 'true', 'EXPENSE_WITNESS_345_OWNER_TLS');
  url.searchParams.delete('connection_limit');
  const files = path.join(workDir, 'expense-witness-files');
  fs.mkdirSync(files, { mode: 0o700 });
  const reportFile = path.join(workDir, 'expense-witness-jest.json');
  receipt.stages.push('ORIGINAL_POL115_NON_PROJECT_EXPENSE_JEST');
  const result = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'),
    '--runInBand', '--runTestsByPath', file, '--testNamePattern', '^' + suiteTitle + ' (' + titles.join('|') + ')$',
    '--json', '--outputFile', reportFile], {
    cwd: api, encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, NODE_ENV: 'test', CI: 'true',
      DATABASE_URL: url.href, RUN_POL115_ENTRY_PG16: '1', JG_POL115_334_SCOPE: 'pol115',
      JG_POL115_334_RUN_ID: runId.replaceAll('-', ''), APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false',
      FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: files, FILE_DOWNLOAD_SECRET: randomUUID(),
      JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID() }
  });
  const report = fs.existsSync(reportFile) && fs.statSync(reportFile).size < 8 * 1024 * 1024
    ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
  receipt.jest = { exit: result.status, registered: report?.numTotalTests, passed: report?.numPassedTests,
    failed: report?.numFailedTests, skipped: report?.numPendingTests };
  if (result.status !== 0 || !report?.success) {
    const first = report?.testResults?.[0]?.assertionResults?.find(row => row.status === 'failed');
    const error = first?.failureMessages?.join('\n') ?? '';
    const statuses = error.match(/Expected:\s*([1-5]\d{2})\s*Received:\s*([1-5]\d{2})/u);
    if (first) receipt.jest.firstFailure = { titleSha256: hash(first.fullName),
      ...(statuses && { expectedStatus: Number(statuses[1]), receivedStatus: Number(statuses[2]) }),
      prismaCodes: [...new Set(error.match(/\bP\d{4}\b/gu) ?? [])].slice(0, 4) };
    return;
  }
  assert.equal(report.testResults.length, 1);
  const [suite] = report.testResults;
  assert.equal(suite.name, path.join(api, file));
  assert.equal(suite.assertionResults.length, inputs.recipe.registered);
  assert.equal(hash(JSON.stringify(suite.assertionResults.map(row => row.fullName))), inputs.recipe.namesSha256);
  assert.deepEqual(suite.assertionResults.filter(row => row.status === 'passed').map(row => row.title), titles);
  assert.equal(report.numPassedTests, 2);
  assert.equal(report.numPendingTests, inputs.recipe.registered - 2);
  receipt.stages.push('WITNESS_CONSTRAINT_NEGATIVE_CONTROLS');
  receipt.controls = JSON.parse((await sql(controls)).stdout.trim());
  assert.deepEqual(receipt.controls, { independentPendingPayment: true,
    explicitWitnessPendingApproval: true, deniedByWitnessConstraint: 5 });
}

async function main() {
  assert.equal(process.argv.length, 2);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(inputs.sourceSha, source.sourceSha);
  assert.equal(inputs.sourceTree, source.sourceTree);
  assert.equal(inputs.ledgerSha256, source.ledgerSha256);
  profile.assertSource(source, final);
  assert.equal(hash(fs.readFileSync(path.join(root, 'installer.cjs'))), inputs.installerSha256);
  assert.equal(inputs.installerSha256, '1c82f256be95909a40f71e557a9d66500cf56968a3bb6b829de08c6bf4f64f50');
  assert.deepEqual(Object.keys(inputs.fixtures), [file, helper]);
  for (const [name, digest] of Object.entries(inputs.fixtures)) {
    assert.equal(hash(fs.readFileSync(path.join(api, name))), digest);
  }
  assert.deepEqual(inputs.recipe, { registered: 63,
    namesSha256: 'cc7765488bc5249555c907ac306de05f1cefc71122b9316d734c274ca9b5e7fd' });
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs')).loadCanonicalMigrationBaseline();
  assert.equal(baseline.expectedDirectoryCount, 345);
  assert.equal(baseline.terminalMigration, profile.terminal.name);
  assert.equal(baseline.terminalMigrationChecksum, profile.terminal.sha256);
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');
  await withCombined345ExpenseWitness(receipt, consume, {
    sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails
  });
  assert.equal(receipt.combinedAfterBusiness.count, 345);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, profile.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  assert.ok(receipt.jest?.passed === 2 && receipt.controls?.deniedByWitnessConstraint === 5, 'EXPENSE_WITNESS_345_INCOMPLETE');
  receipt.status = 'EXPENSE_WITNESS_345_PASSED';
}

main().catch(error => {
  const code = typeof error.message === 'string' && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'EXPENSE_WITNESS_345_FAILED';
  receipt.failure = { stage: receipt.stages.at(-1), code,
    ...(typeof error.sqlstate === 'string' && /^[A-Z0-9]{5}$/u.test(error.sqlstate) && { sqlstate: error.sqlstate }) };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
