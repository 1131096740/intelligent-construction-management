'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { admitSource } = require('./install-only292.cjs');
const {
  withCombined320ContractPayment, withCombined330TextAgreement, withCombined331PaymentRemainder, withCombined332UpwardArchive,
  withCombined334HistoricalSettlement, withCombinedExpenseWitness, withCombinedExpenseWitness349, withCombinedSignedSettlement350, withCombinedCompanyHistory352
} = require('./installer.cjs');
const { final } = require('./multi-witness.cjs');
const source = require('./contract-finance-source.json');

const root = '/qualification';
const api = path.join(root, 'workspace/services/api');
const spec = 'src/database/line-a-real-db.http.pg.spec.ts';
const company = source.mode === 'company-history-352';
const signedSubcent = source.mode === 'signed-settlement-350' || company;
const fullSignedSuite = signedSubcent && process.argv[2] === 'original';
const signedSubcentOnly = signedSubcent && !fullSignedSuite;
const signedProfile = signedSubcent ? require(company ? './company-history-352-profile.cjs' : './signed-settlement-350-profile.cjs') : null;
const signedSubcentTitle = 'line A contract candidate on real PostgreSQL and HTTP A01 已签结算不足一分冲减在确认后保留经营原值';
const signedSubcentFixture = company ? 'c2e5ab20b4853386a050db4c619bbf654103926ef21b363d511902de176197b5' : '71d0f8004a04acdf5947ce196c39695983caab36a83afd25aad36ba4670909ea';
const precision = source.mode === 'expense-witness-349' || signedSubcent;
const expenseWitness = precision ? require('./expense-witness-349-profile.cjs')
  : source.mode === 'expense-witness-346' ? require('./expense-witness-346-profile.cjs') : null;
const historicalSettlement = source.mode === 'historical-settlement-334' || expenseWitness !== null;
const upwardArchive = source.mode === 'upward-archive-332' || historicalSettlement;
const paymentRemainder = source.mode === 'payment-remainder-331' || upwardArchive;
const textDirect = source.mode === 'text-direct-330' || paymentRemainder;
const migrationCount = signedProfile?.count ?? (expenseWitness ? expenseWitness.count
  : historicalSettlement ? 334 : upwardArchive ? 332 : paymentRemainder ? 331 : textDirect ? 330 : 329);
const tests = paymentRemainder ? 18 : textDirect ? 17 : 16;
const purpose = fullSignedSuite ? 'LINE_A_SIGNED_SETTLEMENT_' + migrationCount
  : signedSubcentOnly ? 'LINE_A_A01_SIGNED_SUBCENT_350'
  : expenseWitness ? 'LINE_A_EXPENSE_WITNESS_' + migrationCount
  : historicalSettlement ? 'LINE_A_HISTORICAL_SETTLEMENT_334'
  : upwardArchive ? 'LINE_A_UPWARD_ARCHIVE_332' : paymentRemainder ? 'LINE_A_PAYMENT_REMAINDER_331'
  : textDirect ? 'LINE_A_TEXT_DIRECT_330' : 'LINE_A_EXACT_329';
const receipt = {
  schemaVersion: 1, purpose, sourceSha: source.sourceSha,
  stages: ['INPUTS'], status: 'STOPPED'
};

// The existing synthetic Line A application grant, narrowed to the tables
// and public function entry points used by its contract, settlement and payment cases.
const readTables = [
  'User', 'Position', 'UserPosition', 'Project', 'ProjectMember', 'ProjectRosterMember',
  'CompanyEntity', 'CompanyEntityVersion', 'BusinessParty', 'BusinessPartyVersion',
  'ProjectParticipatingCompany', 'ProjectAffiliateAssignment', 'ProjectAffiliateCompanyContract',
  'AuthRateLimit', 'RefreshToken', 'AuditLog', 'Contract', 'ContractVersion', 'ContractPartySnapshot',
  'ContractTaxFactRevision', 'ContractSignedChange', 'ContractFormalFile', 'ContractArchiveFile',
  'ContractSealTask', 'ContractTakeover',
  'ContractArchiveEvidenceFile', 'ContractDraftAttachment', 'ContractAuthorization', 'ContractVersionAuthorizationLink',
  'ContractWorkCompletion', 'ContractWorkCompletionFact', 'PaymentTermsVersion', 'PaymentTermsStage',
  'SignedContractSettlement', 'SignedContractSettlementAttachment', 'Settlement', 'SettlementDraft',
  'PaymentRequest', 'PaymentRequestAgreementSnapshot', 'PaymentExecution', 'PaymentExecutionRefund',
  'ApprovalInstance', 'ApprovalActionLog', 'ApprovalDelegation', 'BusinessEntrySubmissionSnapshot',
  'FileObject', 'ArchiveRecord', 'OperatingFact', 'OperatingImpactEntry', 'ProjectCloseAggregate',
  'SettlementArchiveFile'
];
const insertTables = [
  'AuthRateLimit', 'RefreshToken', 'AuditLog', 'FileObject',
  'PaymentRequest', 'PaymentRequestAgreementSnapshot', 'ApprovalInstance', 'ApprovalActionLog',
  'BusinessEntrySubmissionSnapshot'
];
const exactOperatingTypes = ['OperatingLedgerFactWritePayloadV2', 'OperatingLedgerImpactWritePayloadV2']
  .map(name => 'public."' + name + '"');
const exactOperatingFunctions = [
  'public."appendOperatingFactThroughService"(' + exactOperatingTypes[0] + ',text,text)',
  'public."appendOperatingImpactThroughService"(' + exactOperatingTypes[1] + ',text,text)'
];
const functions = [
  'jg_read_effective_contract_change_amount_v1', 'jg_read_payment_contract_agreement_detail_v1',
  'jg_read_payment_detail_activity_v1(text,text,text)',
  'jg_read_payment_detail_allocations_v1(text,text,text)',
  'jg_read_payment_detail_pdf_v1(text,text,text)',
  'jg_read_payment_detail_snapshots_v1(text,text,text,boolean)',
  ...(textDirect ? ['jg_read_text_payment_agreement_v1(text,text,text,text)'] : []),
  'jg_read_ordinary_contract_tax_fact_v1', 'jg_list_ordinary_contract_tax_facts_v1',
  'jg_write_ordinary_contract_tax_fact_v1', 'jg_list_contract_signed_changes_v1',
  'jg_submit_contract_signed_change_v1', 'jg_read_contract_signed_change_review_v1', 'jg_review_contract_signed_change_v1',
  'jg_read_signed_settlement_attachment_metadata_v1', 'jg_save_signed_settlement_draft_v1',
  ...(paymentRemainder ? ['jg_read_signed_settlement_attachment_download_v1(text,text,text,text,text,text)'] : []),
  'jg_submit_signed_settlement_draft_v1', 'jg_review_signed_settlement_draft_v1',
  'jg_list_signed_settlements_v1', 'jg_signed_settlement_contract_read_v1', 'jg_signed_settlement_confirmed_projection_v1',
  'jg_create_contract_work_completion_draft_v1', 'jg_contract_work_completion_approval_v1',
  'jg_contract_work_completion_view_v1', 'jg_revise_contract_work_completion_draft_v1',
  'jg_contract_work_completion_cost_sources_v1', 'jg_post_contract_work_completion_cost_v1',
  'jg_project_owner_settlement_voucher_bound(text)',
  '"appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)',
  '"appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)'
];
const tables = names => names.map(name => 'public."' + name + '"').join(', ');

async function consume(context) {
  const { ownerUrl, workDir, runId, database } = context;
  const runtime = new URL(context.runtimeUrl);
  const owner = new URL(ownerUrl);
  const run = runId.replaceAll('-', '');
  assert.match(run, /^[a-f0-9]{32}$/u);
  assert.equal(database, 'jg_task01_' + run);
  for (const endpoint of [runtime, owner]) {
    assert.equal(endpoint.protocol, 'postgresql:');
    assert.equal(endpoint.hostname, '127.0.0.1');
    assert.equal(endpoint.pathname, '/' + database);
    assert.equal(endpoint.searchParams.get('sslmode'), 'require');
    assert.equal(endpoint.searchParams.get('sslaccept'), 'strict');
    assert.equal(endpoint.searchParams.get('sslcert'), path.join(workDir, 'ca.crt'));
  }
  assert.equal(runtime.port, owner.port);
  assert.equal(runtime.username, 'jg_task01_runtime');
  assert.equal(owner.username, 'jg_task01_owner');
  const role = 'finance_runtime_' + run;
  const password = randomBytes(32).toString('hex');
  runtime.username = role;
  runtime.password = password;
  runtime.searchParams.set('connection_limit', '4');

  const witnesses = [
    ['CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY', 'jg_contract_signed_change_submit_witness', true],
    ['CONTRACT_WORK_COMPLETION_WITNESS_KEY', 'jg_contract_work_completion_witness', true],
    ['SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY', 'jg_signed_settlement_attachment_witness_key', false],
    ['SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY', 'jg_signed_settlement_draft_witness_key', false]
  ].map(([env, table, bound]) => ({ env, table, bound, key: randomBytes(32).toString('hex') }));
  receipt.stages.push('LINE_A_PROVISION_WITNESSES');
  const insertions = witnesses.map(({ table, bound, key }) => {
    const value = "decode('" + key + "','hex')";
    if (bound) return 'INSERT INTO public.' + table + '(singleton,"key","databaseOid","runtimeRoleOid") SELECT true,'
      + value + ",oid,'" + role + "'::regrole::oid FROM pg_database WHERE datname=current_database();";
    return 'INSERT INTO public.' + table + '("key") VALUES(' + value + ');';
  });
  const toRole = ' TO ' + role + ';';
  const { NON_RECEIPT_FILE_BINDINGS } = require(path.join(api, 'dist/file/file-business-binding.js'));
  const pointerGrants = NON_RECEIPT_FILE_BINDINGS.flatMap(({ table, columns }) => {
    // Owner settlement pointers use the existing named definer above.
    if (table === 'ProjectOwnerSettlementEntry' || readTables.includes(table)) return [];
    assert.ok([table, ...columns].every(name => /^[A-Za-z][A-Za-z0-9_]*$/u.test(name)));
    return ['GRANT SELECT (' + columns.map(column => '"' + column + '"').join(',') + ') ON ' + tables([table]) + toRole];
  });
  await context.sql([
    'BEGIN;',
    'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
      + " CONNECTION LIMIT 4 PASSWORD '" + password + "';",
    'GRANT CONNECT ON DATABASE ' + database + ' TO ' + role + ';',
    'GRANT USAGE ON SCHEMA public' + toRole,
    'GRANT SELECT ON ' + tables(readTables) + toRole,
    ...pointerGrants,
    'GRANT SELECT ("id","projectId","status","voidedAt","amountCents") ON public."ProjectOwnerContract"' + toRole,
    'GRANT SELECT ("id","contractId","projectId","settlementId","voidedAt","amountCents") ON public."ProjectProxyPayment"' + toRole,
    'GRANT SELECT ("idempotencyKey","contractVersionId","createdAt","approvalInstanceId","responseSnapshot")'
      + ' ON public."ContractDraftSubmissionRequest"' + toRole,
    'GRANT SELECT ("id","settlementId","fileId","purpose","status","generationStatus","confirmedAt")'
      + ' ON public."SettlementSignedDocument"' + toRole,
    // The ApprovalActionLog invoker trigger checks only the bound round and terminal action.
    'GRANT SELECT ("approvalInstanceId","auditAction") ON public."FundExecutionCase"' + toRole,
    // The settlement confirmation invalidates existing project close projections.
    'GRANT SELECT ("id","projectId","sourceType","sourceId","sourceFingerprint") ON public."ProjectCloseImpact"' + toRole,
    'GRANT SELECT ("id","projectId","stageKey","revision","status","projectionReadAt","projectionCutoffAt",'
      + '"projectionFingerprint","amountSnapshot","stateSnapshot") ON public."ProjectCloseStageVersion"' + toRole,
    'GRANT INSERT ("projectId","revision","createdAt","updatedAt") ON public."ProjectCloseAggregate"' + toRole,
    // FileService first checks the exact retained review references before falling back to ordinary file policy.
    'GRANT SELECT ("reviewId","sourceRef","displayOrder","sourceContractVersionId","directInputProtocolVersion",'
      + '"sourceRevision","inputSha256","fileId","mimeType","sizeBytes","contentSha256","bucket","objectKey")'
      + ' ON public."ContractEconomicReviewFileReference"' + toRole,
    'GRANT SELECT ("id","projectId","status","confirmedAt","frozenSources") ON public."ContractEconomicReview"' + toRole,
    'GRANT SELECT ("id","paymentRequestId","status","amountDeltaCents") ON public."PaymentExecutionCorrection"' + toRole,
    'GRANT INSERT ON ' + tables(insertTables) + toRole,
    'GRANT UPDATE, DELETE ON public."AuthRateLimit"' + toRole,
    'GRANT UPDATE ("lastLoginAt", "updatedAt") ON public."User"' + toRole,
    'GRANT UPDATE ("currentNodeIndex", "frozenNodes", "status", "updatedAt") ON public."ApprovalInstance"' + toRole,
    'GRANT UPDATE ("updatedAt") ON public."PaymentRequest"' + toRole,
    'GRANT UPDATE ("updatedAt") ON public."Contract"' + toRole,
    ...(paymentRemainder ? [
      'GRANT UPDATE ("remainingWithdrawnCents") ON public."PaymentRequest"' + toRole,
      // The remainder request locks its existing contract version with FOR UPDATE.
      'GRANT UPDATE ("updatedAt") ON public."ContractVersion"' + toRole
    ] : []),
    'GRANT UPDATE ("updatedAt") ON public."Settlement", public."ProjectCloseAggregate"' + toRole,
    'GRANT UPDATE ("createdAt") ON public."ProjectMember"' + toRole,
    'GRANT UPDATE ("createdAt") ON public."UserPosition"' + toRole,
    'GRANT UPDATE ("updatedAt") ON public."Position"' + toRole,
    // FOR UPDATE needs a column grant. The origin guard keeps createdAt immutable.
    'GRANT UPDATE ("createdAt") ON public."ContractWorkCompletion"' + toRole,
    'GRANT EXECUTE ON FUNCTION ' + functions.map(name => 'public.' + name).join(', ') + toRole,
    ...(signedSubcent ? [
      'GRANT USAGE ON TYPE ' + exactOperatingTypes.join(', ') + toRole,
      'GRANT EXECUTE ON FUNCTION ' + exactOperatingFunctions.join(', ') + toRole
    ] : []),
    ...insertions, 'COMMIT;'
  ].join('\n'));
  try {
    const acl = await context.sql(`SELECT (
      (SELECT rolconnlimit=1 FROM pg_roles WHERE rolname='jg_task01_runtime')
      AND EXISTS (
        SELECT FROM pg_roles WHERE rolname='${role}' AND rolconnlimit=4 AND rolcanlogin
        AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolinherit)
      )
      AND NOT has_schema_privilege('${role}','public','CREATE')
      ${signedSubcent ? [
        ...exactOperatingTypes.map(type => `AND has_type_privilege('${role}','${type}','USAGE')`),
        ...exactOperatingFunctions.map(fn => `AND has_function_privilege('${role}','${fn}','EXECUTE')`),
        ...['OperatingFact', 'OperatingImpactEntry'].map(table =>
          `AND NOT has_table_privilege('${role}','public."${table}"','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
           AND NOT has_any_column_privilege('${role}','public."${table}"','INSERT,UPDATE')`)
      ].join('\n') : ''}
      AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_class c
        WHERE c.relnamespace=to_regnamespace('public') AND c.relkind IN ('r','p')
        AND (
          (c.relname ~ '^jg_(contract_direct_(archive|upward)|contract_generated_archive)'
            OR c.relname IN ('_prisma_migrations','ContractEconomicReview','ContractEconomicReviewFileReference','FundExecutionCase'))
          AND (has_table_privilege('${role}',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
            OR has_any_column_privilege('${role}',c.oid,'INSERT,UPDATE'))
          OR (c.relname ~ '^jg_.*witness' OR c.relname IN ('OperatingLedgerWriteSecret','OperatingLedgerWriteContext'))
          AND (has_table_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
            OR has_any_column_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE'))
        )
      )
    )::text;`);
    assert.equal(acl.stdout.trim(), 'true', 'LINE_A_RESTRICTED_ROLE_ACL');
    receipt.secretAndArchiveWritesDenied = true;
    const login = spawnSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-c',
      "SELECT (current_user=session_user AND current_user='" + role
      + "' AND current_database()='" + database
      + "' AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text;"], {
      encoding: 'utf8', timeout: 15_000, env: {
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin',
        PGHOST: '127.0.0.1', PGPORT: runtime.port, PGDATABASE: database, PGUSER: role, PGPASSWORD: password,
        PGSSLMODE: 'verify-full', PGSSLROOTCERT: path.join(workDir, 'ca.crt')
      }
    });
    assert.ok(login.status === 0 && login.stdout.trim() === 'true', 'LINE_A_TLS_FIXTURE_LOGIN');
    receipt.runtime = { originalConnectionLimit: 1, fixtureConnectionLimit: 4, tls: true };
    receipt.stages.push(signedSubcentOnly ? 'LINE_A_A01_SIGNED_SUBCENT_HTTP' : 'LINE_A_ORIGINAL_HTTP_SUITE');
    const directory = fs.mkdtempSync(path.join(workDir, 'line-a-'));
    const file = path.join(directory, 'jest.json');
    const result = spawnSync(process.execPath, [path.join(api, 'node_modules/jest/bin/jest.js'),
      '--runInBand', '--runTestsByPath', spec, '--json', '--outputFile=' + file,
      ...(signedSubcentOnly ? ['--testNamePattern=^' + signedSubcentTitle + '$'] : [])], {
      cwd: api, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir, NODE_ENV: 'test', CI: 'true',
        RUN_LINE_A_REAL_DB: '1', ...(textDirect ? { RUN_LINE_A_TEXT_DIRECT_330: '1' } : {}),
        ...(paymentRemainder ? { RUN_LINE_A_PAYMENT_REMAINDER_331: '1' } : {}),
        ...(upwardArchive ? { RUN_LINE_A_UPWARD_ARCHIVE_332: '1' } : {}),
        ...(historicalSettlement ? { RUN_LINE_A_HISTORICAL_SETTLEMENT_334: '1' } : {}),
        JG_LINE_A_SEALED_RUN_ID: run, DATABASE_URL: runtime.href, OWNER_DATABASE_URL: owner.href,
        FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: path.join(directory, 'files'),
        APPROVAL_SMS_ENABLED: 'false', SMS_ENABLED: 'false',
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
        OPERATING_LEDGER_DB_WRITE_SECRET: randomBytes(32).toString('hex'),
        ...Object.fromEntries(witnesses.map(({ env, key }) => [env, key]))
      }
    });
    const report = fs.existsSync(file) && fs.statSync(file).size <= 16 * 1024 * 1024
      ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const cases = report?.testResults?.[0]?.assertionResults ?? [];
    const messages = [
      ...(result.stderr ? [result.stderr] : []),
      ...(report?.testResults?.[0]?.message ? [report.testResults[0].message] : []),
      ...cases.flatMap(test => test.failureMessages ?? [])
    ].join('\n').slice(0, 65_536);
    receipt.lineA = {
      passed: report?.numPassedTests ?? 0, skipped: report?.numPendingTests ?? 0,
      registered: report?.numTotalTests ?? 0,
      ...(historicalSettlement ? {
        processExit: result.status, signal: result.signal, reportWritten: report !== null,
        failedSuites: report?.numFailedTestSuites ?? null,
        ...(result.error?.code && /^[A-Z0-9_]+$/u.test(result.error.code) ? { spawnError: result.error.code } : {}),
        ...(cases.length === 0 ? {
          startupFailure: /Cannot find module/u.test(messages) ? 'MODULE_NOT_FOUND'
            : /heap out of memory|Allocation failed/iu.test(messages) ? 'JS_HEAP_LIMIT'
            : /(?:SyntaxError|TS\d{4}:)/u.test(messages) ? 'SOURCE_TRANSFORM'
            : 'UNCLASSIFIED'
        } : {})
      } : {}),
      failedCases: cases.flatMap((test, index) => {
        if (test.status !== 'failed') return [];
        const failure = (test.failureMessages ?? []).join('\n').replace(/\u001b\[[0-9;]*m/gu, '').slice(0, 32768);
        const positions = [...new Set([...failure.matchAll(/line-a-real-db\.http\.pg\.spec\.ts:(\d{1,5}):\d{1,5}/gu)]
          .map(match => Number(match[1])))].slice(0, 4);
        const http = [...new Set([...failure.matchAll(/LINE_A_(?:HTTP [^\n]{1,180}|LOGIN [a-z]+) -> ([1-5]\d{2})/gu)]
          .map(match => Number(match[1])))].slice(0, 4);
        const status = /Expected:\s*([1-5]\d{2})[\s\S]{0,96}?Received:\s*([1-5]\d{2})/u.exec(failure);
        return [{ index: index + 1, positions, http, ...(status ? { expectedActual: [Number(status[1]), Number(status[2])] } : {}) }];
      }),
      permissionObjects: [...new Set([...messages.matchAll(/permission denied for (?:table|relation|function|sequence) ([a-z_][a-z_0-9]{0,79})/giu)]
        .map(match => match[1]))].slice(0, 12),
      http: [...new Set([...messages.matchAll(/LINE_A_(?:HTTP [^\n]{1,180}|LOGIN [a-z]+) -> ([1-5]\d{2})/gu)]
        .map(match => Number(match[1])))].slice(0, 8),
      sqlstates: [...new Set([...messages.matchAll(/SQLSTATE\s+([0-9A-Z]{5})|Code: `([0-9A-Z]{5})`/gu)]
        .map(match => match[1] ?? match[2]))].slice(0, 8)
    };
    if (signedSubcent) {
      const passed = cases.filter(test => test.status === 'passed');
      const expectedPassed = fullSignedSuite ? tests + 1 : 1;
      assert.ok(result.status === 0 && report?.success === true && report.testResults.length === 1 &&
        report.testResults[0].name === path.join(api, spec) && report.numTotalTests === tests + 1 &&
        report.numPendingTests === (fullSignedSuite ? 0 : tests) && report.numPassedTests === expectedPassed &&
        cases.length === tests + 1 && passed.length === expectedPassed &&
        passed.filter(test => test.fullName === signedSubcentTitle).length === 1,
        'LINE_A_A01_SIGNED_SUBCENT_HTTP_COVERAGE');
      receipt.a01 = {
        ...(fullSignedSuite ? {} : { selectedCase: signedSubcentTitle }),
        originalCaseCount: tests, registeredCaseCount: tests + 1, passedCaseCount: expectedPassed,
        confirmationHttpStatus: 201, signedYuan: '-0.0001', confirmedCostDecreaseYuan: '0.0001',
        payableImpactCount: 0, paymentCapCents: '101', repeatReviewHttpStatus: 409, duplicateWrites: false
      };
    } else {
      assert.ok(result.status === 0 && report?.success && report.testResults.length === 1 &&
        report.testResults[0].name === path.join(api, spec) && report.numTotalTests === tests &&
        report.numPassedTests === tests && report.numPendingTests === 0 && cases.length === tests &&
        cases.every(test => test.status === 'passed'), 'LINE_A_ORIGINAL_HTTP_COVERAGE');
    }
  } finally {
    const deletions = witnesses.map(({ table, key }) => 'DELETE FROM public.' + table
      + ' WHERE "key"=decode(\'' + key + '\',\'hex\');');
    const closed = await context.sql('BEGIN; ' + deletions.join(' ') + ' DROP OWNED BY ' + role + '; DROP ROLE '
      + role + "; COMMIT; SELECT (to_regrole('" + role + "') IS NULL"
      + " AND (SELECT rolconnlimit=1 FROM pg_roles WHERE rolname='jg_task01_runtime'))::text;");
    assert.equal(closed.stdout.trim(), 'true', 'LINE_A_FIXTURE_ROLE_CLEARED');
    receipt.testWitnessesCleared = true;
    receipt.fixtureRoleCleared = true;
  }
}

async function main() {
  assert.equal(process.argv.length, fullSignedSuite ? 3 : 2);
  assert.notEqual(process.getuid(), 0);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.match(source.sourceSha, /^[a-f0-9]{40}$/u);
  assert.ok(source.mode === 'current-320' || textDirect);
  assert.equal(source.migrationCount, migrationCount);
  assert.equal(source.predecessor.ledgerSha256, final);
  if (historicalSettlement) {
    const profile = signedProfile ?? expenseWitness ?? require('./historical-settlement-334-profile.cjs');
    profile.assertSource(source, final);
    const installerHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'installer.cjs'))).digest('hex');
    assert.equal(installerHash, profile.installerSha256, 'LINE_A_' + migrationCount + '_INSTALLER_FINGERPRINT');
  }
  const baseline = require(path.join(api, 'prisma/migration-baseline.cjs'));
  if (expenseWitness) {
    (signedProfile ?? expenseWitness).assertRuntimeBaseline(baseline);
    const fixtureHash = createHash('sha256').update(fs.readFileSync(path.join(api, spec))).digest('hex');
    const expected = signedSubcent ? signedSubcentFixture
      : precision ? '076382343c2fb3712ad7e8512b58b4442ac146ee0f12d343e7000c85df3c22fc'
      : '48bdef111ee82b8a6a622578eaac69586c0cae68f0851d17c1d60fe2921ea1e6';
    assert.equal(fixtureHash, expected, 'LINE_A_' + migrationCount + '_FIXTURE_FINGERPRINT');
    receipt.fixtureSha256 = fixtureHash;
  } else {
    const admitted = baseline.loadCanonicalMigrationBaseline();
    assert.equal(admitted.expectedDirectoryCount, source.migrationCount);
    assert.equal(admitted.terminalMigration, source.tails.at(-1).name);
    assert.equal(admitted.terminalMigrationChecksum, source.tails.at(-1).sha256);
  }
  receipt.input = admitSource(root, root + '/source/services/api/prisma', root + '/source-seal.txt');
  const install = historicalSettlement ? withCombined334HistoricalSettlement
    : upwardArchive ? withCombined332UpwardArchive : paymentRemainder ? withCombined331PaymentRemainder
    : textDirect ? withCombined330TextAgreement : withCombined320ContractPayment;
  const material = { sourceTree: source.sourceTree, migrations: path.join(api, 'prisma/migrations'), tails: source.tails };
  if (company) {
    await withCombinedCompanyHistory352(receipt, consume, { ...source, ...material });
  } else if (signedSubcent) {
    await withCombinedSignedSettlement350(receipt, consume, { ...source, ...material });
  } else if (precision) {
    await withCombinedExpenseWitness349(receipt, consume, { ...source, ...material });
  } else if (expenseWitness) {
    await withCombinedExpenseWitness(receipt, consume, material, expenseWitness.count);
  } else {
    await install(receipt, consume, material);
  }
  const legacyTails = expenseWitness ? source.tails.slice(0, 39) : source.tails;
  const installed = precision ? receipt.expenseWitnessPrecisionForward
    : expenseWitness ? receipt.expenseWitnessForward : receipt.forward320;
  if (textDirect) {
    assert.deepEqual(receipt.textDirectPredecessor, {
      count: 329, ledgerSha256: '3e88a4a2ad3ebb128572fafd29f08a816bada6d61795ce35c6c8a4b73ba08bd2',
      sameIdentity: true, sameBaseB7: true
    });
    assert.equal(installed.count, signedSubcent ? source.predecessor349.migrationCount : migrationCount);
    assert.equal(receipt.combinedAfterBusiness.count, migrationCount);
  }
  if (paymentRemainder) {
    assert.deepEqual(receipt.paymentRemainderPredecessor, {
      count: 330, ledgerSha256: source.predecessor330.ledgerSha256,
      sameIdentity: true, sameBaseB7: true
    });
    assert.deepEqual(receipt.forward320.tails, legacyTails.map(({ name, sha256 }) => ({ name, sha256 })));
  }
  if (upwardArchive) {
    assert.deepEqual(receipt.upwardArchivePredecessor, {
      count: 331, ledgerSha256: source.predecessor331.ledgerSha256,
      sameIdentity: true, sameBaseB7: true
    });
  }
  assert.equal(installed.sourceTree, source.sourceTree);
  assert.equal(installed.ledgerSha256, signedSubcent ? source.predecessor349.ledgerSha256 : source.ledgerSha256);
  assert.equal(installed.sameIdentity, true);
  if (expenseWitness) {
    const historical = require('./historical-settlement-334-profile.cjs');
    historical.assertFinanceInstallation(receipt, { ...source, tails: legacyTails });
    const tails = source.tails.map(({ name, sha256 }) => ({ name, sha256 }));
    const boundary = precision ? source.predecessor346.migrationCount - source.predecessor.migrationCount : 39;
    const precisionBoundary = signedSubcent ? source.predecessor349.migrationCount - source.predecessor.migrationCount : tails.length;
    assert.deepEqual(installed.tails, tails.slice(boundary, precisionBoundary));
    if (signedSubcent) {
      assert.equal(receipt.combinedAfterBusiness.count, migrationCount);
      assert.deepEqual(receipt.signedSettlementForward, {
        count: company ? 350 : migrationCount, ledgerSha256: company ? source.predecessor350.ledgerSha256 : source.ledgerSha256, sameIdentity: true, sourceTree: source.sourceTree,
        tails: tails.slice(precisionBoundary, company ? 350 - source.predecessor.migrationCount : undefined)
      });
      assert.equal(receipt.signedSettlementCatalogAfterBusiness, true);
      assert.equal(receipt.a01?.confirmationHttpStatus, 201);
      assert.equal(receipt.fixtureRoleCleared, true);
    }
    if (precision) {
      assert.deepEqual(receipt.expenseWitnessForward, {
        count: source.predecessor346.migrationCount, ledgerSha256: source.predecessor346.ledgerSha256,
        sameIdentity: true, sourceTree: source.sourceTree, tails: tails.slice(39, boundary)
      });
      assert.equal(receipt.expenseWitnessPrecisionCatalogAfterBusiness, true);
    }
    assert.equal(receipt.expenseWitnessCatalogAfterBusiness, true);
  }
  assert.equal(receipt.forward320.sameIdentity, true);
  assert.equal(receipt.forward320.sameBaseB7, true);
  assert.equal(receipt.combinedAfterBusiness.ledgerSha256, source.ledgerSha256);
  assert.equal(receipt.combinedAfterBusiness.sameIdentity, true);
  assert.equal(receipt.combinedAfterBusiness.exactB7, true);
  assert.equal(receipt.multiWitnessCatalogAfterBusiness, true);
  if (historicalSettlement) {
    assert.equal(receipt.historicalTakeoverCatalogAfterBusiness, true);
    assert.equal(receipt.historicalSettlementCatalogAfterBusiness, true);
  }
  if (company) signedProfile.assertInstallation(receipt, source);
  assert.equal(receipt.testWitnessesCleared, true);
  assert.equal(receipt.cleanup, 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = purpose + '_PASSED';
}

main().catch(error => {
  receipt.status = 'STOPPED';
  const code = error.code ?? error.message;
  receipt.failure = {
    stage: receipt.stages.at(-1), code: /^[A-Z0-9_]+$/u.test(code) ? code : (paymentRemainder ? purpose + '_FAILED' : 'LINE_A_EXACT_329_FAILED'),
    sqlstate: error.sqlstate, prismaCode: error.prismaCode
  };
  process.exitCode = 1;
}).finally(() => process.stdout.write(JSON.stringify(receipt) + '\n'));
