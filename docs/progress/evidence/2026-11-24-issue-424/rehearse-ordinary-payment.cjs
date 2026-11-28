'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const api = path.join(repo, 'services/api');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.join(api, 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const { hash } = apiRequire('bcryptjs');
const { CI_DYNAMIC_MIGRATION_LABEL } = apiRequire('./prisma/local-staged-ci-dynamic.cjs');
const source = 'jg424_inventory_fixture';
const restored = 'jg424_restore_post';
const owner = 'jiangkong';
const reader = 'jg424_payment_reader';
const writer = 'jg424_fixture_writer';
const username = '13900004295';
const userPassword = 'Fixture-424-restored-only';
const freeze = { OPERATIONAL_WRITE_FREEZE_MODE: 'modules', OPERATIONAL_WRITE_FREEZE_MODULES: 'payment' };

function run(bin, args, { env = process.env, input, encoding = 'utf8' } = {}) {
  const result = spawnSync(bin, args, { cwd: repo, env, input, encoding, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${bin} ${args[0]} failed`);
  return result.stdout;
}

async function seed(prisma, storage) {
  const [applicant, signer, manager, finance, operator] = await Promise.all([
    ['虚构经办人'], ['虚构综合主管'], ['虚构项目经理'], ['虚构财务主管', username], ['虚构切换操作者']
  ].map(async ([name, phone]) => prisma.user.create({ data: {
    name, ...(phone ? { phone, passwordHash: await hash(userPassword, 4), mustChangePassword: false } : {})
  } })));
  const project = await prisma.project.create({ data: { code: 'FIX-RESTORE-424', name: '虚构恢复项目' } });
  const company = await prisma.companyEntity.create({ data: { name: '虚构付款主体' } });
  const contract = await prisma.contract.create({ data: {
    projectId: project.id, code: 'FIX-CONTRACT-424', contractTypeKey: 'generic_contract', name: '虚构恢复合同', counterparty: '虚构对方'
  } });
  const version = await prisma.contractVersion.create({ data: {
    contractId: contract.id, versionNo: 1, changeType: 'initial', status: 'effective', amountCents: 5000n,
    effectiveAt: new Date('2026-10-01T00:00:00Z'), signingSubjectType: 'our_company',
    companyEntityIdSnapshot: company.id, draftData: {}, templateSnapshot: {}, clauseSnapshot: {}
  } });
  const terms = await prisma.paymentTermsVersion.create({ data: {
    contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: 'effective', originalText: '虚构预付款依据'
  } });
  const financePosition = await prisma.position.upsert({ where: { key: 'finance_director' }, update: {},
    create: { key: 'finance_director', name: '财务主管' } });
  await prisma.userPosition.create({ data: { userId: finance.id, positionId: financePosition.id } });
  await prisma.projectMember.createMany({ data: [
    { projectId: project.id, userId: applicant.id, positionKey: 'contract_staff' },
    { projectId: project.id, userId: manager.id, positionKey: 'project_manager' }
  ] });
  const payment = await prisma.paymentRequest.create({ data: {
    projectId: project.id, contractId: contract.id, contractVersionId: version.id, paymentTermsVersionId: terms.id,
    code: 'FIX-RESTORED-PAYMENT-424', sourceType: 'contract_advance', status: 'approval_pending',
    paymentSubjectType: 'our_company', requestedAmountCents: 1000n
  } });
  const round = await prisma.approvalInstance.create({ data: {
    businessType: 'payment_request', businessId: payment.id, flowType: 'payment.approve', status: 'in_progress',
    applicantUserId: applicant.id, currentNodeIndex: 1, frozenNodes: [
      { name: '原综合主管', mode: 'any', roleKeys: ['comprehensive_director'], approvedRoleKeys: ['comprehensive_director'] },
      { name: '原项目经理', mode: 'any', roleKeys: ['project_manager'] },
      { name: '原财务主管', mode: 'any', roleKeys: ['finance_director'] }
    ]
  } });
  async function signature(user, objectKey) {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(storage, objectKey), bytes, { mode: 0o600, flag: 'wx' });
    const file = await prisma.fileObject.create({ data: {
      bucket: 'private-local', objectKey, originalName: objectKey, mimeType: 'image/png', sizeBytes: bytes.length,
      uploadedByUserId: user.id, contentSha256
    } });
    return prisma.handwrittenSignatureVersion.create({ data: { userId: user.id, fileId: file.id, contentSha256, source: 'canvas' } });
  }
  const signed = await signature(signer, 'retained.png');
  await signature(finance, 'finance.png');
  const action = await prisma.approvalActionLog.create({ data: {
    approvalInstanceId: round.id, action: 'approve', actorUserId: signer.id, representedUserId: signer.id,
    approvedRoleKey: 'comprehensive_director', signatureFileIdSnapshot: signed.fileId, signatureVersionIdSnapshot: signed.id,
    signatureSha256Snapshot: signed.contentSha256, metadata: { approverName: signer.name }
  } });
  return { payment, round, action, signed, operator, manager, finance };
}

async function exercise(url, writerUrl, fixture, sql, receipt) {
  const { NestFactory } = apiRequire('@nestjs/core');
  const { AppModule } = apiRequire('./dist/app.module');
  const { apiJsonReplacer } = apiRequire('./dist/api-json-replacer');
  const { createApiValidationPipe } = apiRequire('./dist/validation/api-validation');
  const { PaymentRequestService } = apiRequire('./dist/payment/payment-request.service');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const ordinarySession = new PrismaClient({ datasources: { db: { url: writerUrl } } });
  try {
    app.getHttpAdapter().getInstance().set('json replacer', apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const post = (route, body, token) => fetch(base + route, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {})
    }, body: JSON.stringify(body) });
    const login = await post('/auth/login', { phone: username, password: userPassword });
    assert.equal(login.status, 201);
    const token = (await login.json()).tokens.accessToken;
    const { payment, round, action, signed, operator, manager, finance } = fixture;
    const paymentWhere = { id: payment.id };
    const roundWhere = { id: round.id };
    const auditWhere = { action: 'payment.approval.legacy_cutover', businessId: payment.id };
    const checkFinancialState = async (expectedUpdatedAt = payment.updatedAt) => {
      assert.deepEqual(await db.paymentRequest.findUnique({ where: paymentWhere }), { ...payment, updatedAt: expectedUpdatedAt });
      assert.equal(await db.paymentExecution.count({ where: { paymentRequestId: payment.id } }), 0);
      assert.deepEqual(await db.approvalActionLog.findUnique({ where: { id: action.id } }), action);
      assert.deepEqual(await db.handwrittenSignatureVersion.findUnique({ where: { id: signed.id } }), signed);
      assert.equal(createHash('sha256').update(readFileSync(path.join(process.env.FILE_STORAGE_ROOT, 'retained.png'))).digest('hex'), signed.contentSha256);
    };
    const approvalRoute = `/payments/${payment.id}/approval`;
    receipt.phase = 'STOPPED_WRITERS';
    // Exercise the existing connection fence with a live role in this disposable database.
    const [{ pid }] = await ordinarySession.$queryRaw`SELECT pg_backend_pid() AS pid`;
    assert.equal(sql(restored, `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE pid=${pid} AND datname='${restored}' AND usename='${writer}');`), 't');
    assert.equal(sql(restored, `REVOKE CONNECT ON DATABASE ${restored} FROM ${writer};
      SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE datname='${restored}' AND usename='${writer}';`), 't');
    assert.equal(sql(restored, `SELECT NOT has_database_privilege('${writer}','${restored}','CONNECT') AND NOT EXISTS
      (SELECT FROM pg_stat_activity WHERE datname='${restored}' AND usename='${writer}');`), 't');
    const refused = new PrismaClient({ datasources: { db: { url: writerUrl } } });
    try { await assert.rejects(refused.$connect()); }
    finally { await refused.$disconnect(); }
    assert.equal((await post(approvalRoute, { decision: 'approve' }, token)).status, 503);
    assert.deepEqual(await db.approvalInstance.findUnique({ where: roundWhere }), round);
    const service = app.get(PaymentRequestService);
    const coordinates = { approvalInstanceId: round.id, paymentUpdatedAt: payment.updatedAt, approvalUpdatedAt: round.updatedAt };
    receipt.phase = 'STALE_ROUND';
    await assert.rejects(service.migrateLegacyApprovalRound(payment.id, operator.id, {
      ...coordinates, approvalUpdatedAt: new Date(round.updatedAt.getTime() - 1)
    }), /付款审批轮次已变化/u);
    await assert.rejects(service.migrateLegacyApprovalRound(payment.id, operator.id, {
      ...coordinates, paymentUpdatedAt: new Date(payment.updatedAt.getTime() - 1)
    }), /付款审批轮次已变化/u);
    assert.equal(await db.auditLog.count({ where: auditWhere }), 0);
    assert.deepEqual(await db.approvalInstance.findUnique({ where: roundWhere }), round);
    await checkFinancialState();
    receipt.phase = 'APPLY_RESTORED_ROUND';
    assert.deepEqual(await service.migrateLegacyApprovalRound(payment.id, operator.id, coordinates), { status: 'mapped', pendingNodeIndexes: [1, 2] });
    assert.deepEqual(await service.migrateLegacyApprovalRound(payment.id, operator.id, coordinates), { status: 'already_mapped' });
    await assert.rejects(service.migrateLegacyApprovalRound(payment.id, operator.id, {
      ...coordinates, approvalInstanceId: randomUUID()
    }), /付款审批轮次已变化/u);
    const audit = await db.auditLog.findMany({ where: auditWhere });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorUserId, operator.id);
    const notices = (await db.approvalActionLog.findMany({ where: { approvalInstanceId: round.id, action: 'system_notification' } }))
      .map(row => [row.metadata.nodeIndex, row.metadata.recipientId, row.metadata.event]);
    assert.deepEqual(notices.sort(([a], [b]) => a - b), [[1, manager.id, 'queued'], [2, finance.id, 'queued']]);
    await checkFinancialState();
    receipt.replay = { audit: 1, notices: 2, originalSignaturePreserved: true, financialStatePreserved: true, staleRejected: true, exactRetry: true };
    receipt.phase = 'REOPEN_HTTP';
    sql(restored, `GRANT CONNECT ON DATABASE ${restored} TO ${writer};`);
    await ordinarySession.$disconnect();
    assert.deepEqual(await ordinarySession.$queryRaw`SELECT 1 AS connected`, [{ connected: 1 }]);
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    const live = await db.approvalInstance.findUniqueOrThrow({ where: roundWhere });
    const decision = { decision: 'approve', expectedPaymentUpdatedAt: payment.updatedAt.toISOString(),
      expectedApprovalInstanceId: round.id, expectedApprovalUpdatedAt: live.updatedAt.toISOString(), expectedNodeIndex: 2 };
    const unauthorized = await post(approvalRoute, decision);
    assert.equal(unauthorized.status, 401);
    const approved = await post(approvalRoute, decision, token);
    assert.equal(approved.status, 201);
    const [current, currentPayment] = await Promise.all([
      db.approvalInstance.findUniqueOrThrow({ where: roundWhere }), db.paymentRequest.findUniqueOrThrow({ where: paymentWhere })
    ]);
    const duplicate = await post(approvalRoute, { ...decision, expectedApprovalUpdatedAt: current.updatedAt.toISOString(),
      expectedPaymentUpdatedAt: currentPayment.updatedAt.toISOString() }, token);
    assert.equal(duplicate.status, 403);
    assert.equal(current.currentNodeIndex, 1);
    assert.deepEqual(current.frozenNodes[1].approvedRoleKeys, undefined);
    assert.deepEqual(current.frozenNodes[2].approvedRoleKeys, ['finance_director']);
    assert.ok(currentPayment.updatedAt > payment.updatedAt);
    await checkFinancialState(currentPayment.updatedAt);
    receipt.http = { frozen: 503, unauthorized: 401, approved: 201, duplicate: 403 };
  } finally {
    try { await app.close(); }
    finally { await Promise.all([db.$disconnect(), ordinarySession.$disconnect()]); }
  }
}

async function main() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.argv.length, 2);
  const candidate = run('git', ['rev-parse', 'HEAD']).trim();
  const worktreeClean = !run('git', ['status', '--porcelain']).trim();
  const endpoint = process.env.DOCKER_HOST || run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
  assert.match(endpoint, /^unix:\/\/\//u);
  const root = mkdtempSync(path.join(tmpdir(), 'jg424-restored-payment-'));
  const storage = path.join(root, 'contract-signature-files');
  mkdirSync(storage, { mode: 0o700 });
  const runId = randomUUID();
  const containerName = `jiangkong-am424-${runId}`;
  const ownerPassword = randomUUID();
  const readerPassword = randomUUID();
  const writerPassword = randomUUID();
  const containerEnv = { PATH: process.env.PATH, HOME: process.env.HOME, POSTGRES_PASSWORD: ownerPassword };
  const docker = (args, options) => run('docker', ['--host', endpoint, ...args], { env: containerEnv, ...options });
  const receipt = { candidate, worktreeClean, phase: 'BUILD_FICTITIOUS_RESTORE', database: restored };
  let container;
  try {
    writeFileSync(path.join(root, 'container-ownership.json'), JSON.stringify({ runId, containerName, endpoint }), { mode: 0o600, flag: 'wx' });
    container = docker(['run', '--detach', '--rm', '--pull=never', '--name', containerName,
      '--label', `${CI_DYNAMIC_MIGRATION_LABEL}=${runId}`, '--env', `POSTGRES_USER=${owner}`, '--env', 'POSTGRES_PASSWORD',
      '--env', `POSTGRES_DB=${source}`, '--publish', '127.0.0.1::5432', 'postgres:16']).trim();
    assert.match(container, /^[a-f0-9]{64}$/u);
    docker(['exec', container, 'sh', '-c', `for i in $(seq 1 100); do pg_isready -h 127.0.0.1 -U ${owner} -d ${source} >/dev/null && exit 0; sleep 0.2; done; exit 1`]);
    const address = docker(['port', container, '5432/tcp']).trim();
    assert.match(address, /^127\.0\.0\.1:\d+$/u);
    const url = (role, password, db) => `postgresql://${role}:${password}@${address}/${db}`;
    const sourceUrl = url(owner, ownerPassword, source);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1',
      SMS_ENABLED: 'false', APPROVAL_SMS_ENABLED: 'false', FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: storage,
      JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID(), FILE_DOWNLOAD_SECRET: randomUUID() };
    run('pnpm', ['--filter', '@jiangkong/api', 'exec', 'prisma', 'db', 'push', '--skip-generate'], { env: { ...env, DATABASE_URL: sourceUrl } });
    const sourceClient = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
    let fixture;
    try { fixture = await seed(sourceClient, storage); }
    finally { await sourceClient.$disconnect(); }
    const archive = docker(['exec', container, 'pg_dump', '-U', owner, '-d', source, '-Fc', '--no-owner', '--no-acl'], { encoding: null });
    docker(['exec', container, 'createdb', '-U', owner, restored]);
    docker(['exec', '-i', container, 'pg_restore', '-U', owner, '-d', restored, '--exit-on-error', '--no-owner', '--no-acl'], { input: archive });
    const sql = (db, input) => docker(['exec', '-i', container, 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-U', owner, '-d', db], { input }).trim();
    const metrics = readFileSync(path.join(__dirname, 'metrics.sql'), 'utf8');
    const originalMetrics = sql(source, metrics);
    const restoredMetrics = sql(restored, metrics);
    assert.equal(restoredMetrics, originalMetrics);
    for (const [filename, observed] of [['metrics-post.txt', originalMetrics], ['metrics-restore-post.txt', restoredMetrics]]) {
      writeFileSync(path.join(root, filename), observed, { mode: 0o600, flag: 'wx' });
    }
    receipt.restoreMetricsSha256 = createHash('sha256').update(originalMetrics).digest('hex');
    sql(restored, `REVOKE CONNECT ON DATABASE ${restored} FROM PUBLIC;
      CREATE ROLE ${reader} LOGIN PASSWORD '${readerPassword}'; GRANT CONNECT ON DATABASE ${restored} TO ${reader};
      ALTER ROLE ${reader} IN DATABASE ${restored} SET default_transaction_read_only = on;
      GRANT SELECT ON "PaymentRequest", "ApprovalInstance", "ApprovalActionLog", "HandwrittenSignatureVersion", "FileObject" TO ${reader};
      CREATE ROLE ${writer} LOGIN PASSWORD '${writerPassword}'; GRANT CONNECT ON DATABASE ${restored} TO ${writer};`);
    receipt.phase = 'READ_ONLY_INVENTORY';
    const report = JSON.parse(run(process.execPath, [path.join(api, 'scripts/inspect-issue424-contract-cutover.cjs'), '--ordinary-payment'], {
      env: { ...env, DRILL_ROOT: root, ISSUE424_PAYMENT_PLAN_READER_URL: url(reader, readerPassword, restored) }
    }));
    assert.deepEqual(report, { total: 1, replayed: 1, blocked: 0, blockedByReason: {} });
    assert.equal(sql(restored, metrics), originalMetrics);
    const restoredUrl = url(owner, ownerPassword, restored);
    const before = process.env;
    process.env = { ...env, DATABASE_URL: restoredUrl, ...freeze };
    try { await exercise(restoredUrl, url(writer, writerPassword, restored), fixture, sql, receipt); }
    finally { process.env = before; }
    receipt.phase = 'COMPLETE';
  } finally {
    if (container && /^[a-f0-9]{64}$/u.test(container)) {
      docker(['rm', '--force', '--volumes', container]);
      receipt.ownedContainerAbsent = !docker(['ps', '-aq', '--no-trunc', '--filter', `id=${container}`]).trim();
    }
    rmSync(root, { recursive: true, force: true });
    process.stdout.write(JSON.stringify(receipt) + '\n');
  }
}

main().catch(error => {
  const line = /rehearse-ordinary-payment\.cjs:(\d+):\d+/u.exec(error.stack ?? '')?.[1];
  const reason = error.code === 'ERR_ASSERTION' && error.message.startsWith('Missing expected rejection') ? 'EXPECTED_REJECTION_MISSING' : error.code ?? error.name;
  process.stderr.write(`ISSUE424_RESTORED_PAYMENT ${reason}${line ? ` line=${line}` : ''}\n`);
  process.exitCode = 1;
});
