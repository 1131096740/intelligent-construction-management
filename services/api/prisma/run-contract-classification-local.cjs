"use strict";
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync, renameSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { createCommandRuntime, createRunnerCleanup, runInterruption } = require('./money-bigint-runner-runtime.cjs');
const cwd = resolve(__dirname, '..');
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const runLabel = 'io.jiangkong.local-test.run', taskLabel = 'io.jiangkong.local-test.task';
const localEndpoint = /^(?:unix:\/\/\/[^\r\n]+|npipe:\/{4}[^/\r\n]+\/pipe\/[^/\r\n]+)$/u;
async function main() {
    if (process.env.NODE_ENV === 'production' || Object.keys(process.env).some(k => k === 'DATABASE_URL' || k.endsWith('_DATABASE_URL')))
        throw Error('Refuse inherited database target');
    const artifacts = mkdtempSync(join(tmpdir(), 'jg-contract-check-'));
    const runId = randomUUID(), name = 'jg-contract-test-' + runId.slice(0, 8), password = randomUUID(), db = 'jiangkong_project_affiliate_company_contract_test';
    const runtime = createCommandRuntime({ defaultCwd: cwd, defaultTimeoutMs: 0 });
    const manifest = { task: 'contract-classification', runId, sourceSha: null, runnerSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'), createdAt: new Date().toISOString(), endpoint: null, daemonId: null, status: 'running', phase: 'preflight', container: { name, id: null, anonymousVolumeNames: [] }, cleanup: { status: 'pending' } };
    function writeReceipt(filename, value) {
        const destination = join(artifacts, filename);
        const pending = destination + '.tmp';
        writeFileSync(pending, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
        renameSync(pending, destination);
    }
    const persist = () => writeReceipt('resource-manifest.json', manifest);
    const redact = value => String(value).replaceAll(password, '[redacted]');
    let dockerEnv, attempted = false, checksPassed = false, interrupted = false, backupCreated = false, backupVerified = false;
    async function dockerCommand(args) { return (await runtime.command(docker, args, { env: dockerEnv, timeoutMs: 60000 })).stdout.trim(); }
    const absent = error => /No such (?:container|object|volume)/iu.test(String(error?.message));
    async function inspectOwnedContainer() {
        let value;
        try {
            value = JSON.parse(await dockerCommand(['inspect', '--format', '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}', name]));
        }
        catch (error) {
            if (absent(error))
                return null;
            throw error;
        }
        if (value.labels?.[runLabel] !== runId || value.labels?.[taskLabel] !== manifest.task || !/^[a-f0-9]{64}$/u.test(value.id))
            throw Error('拒绝清理归属不匹配的容器');
        if (manifest.container.id && manifest.container.id !== value.id)
            throw Error('本轮容器身份发生变化');
        manifest.container.id = value.id;
        manifest.container.anonymousVolumeNames = value.mounts.filter(m => m.Type === 'volume').map(m => m.Name);
        persist();
        return value;
    }
    const lifecycleCleanup = createRunnerCleanup({
        stopChildren: () => runtime.stopAll(),
        removeContainer: async () => {
            if (!attempted)
                return;
            const owned = await inspectOwnedContainer();
            if (!owned && interrupted && !manifest.container.id)
                throw Error('启动结果未确认，请按本轮资源清单复核');
            if (owned) {
                const containerId = owned.id;
                if (backupCreated && !backupVerified)
                    await dockerCommand(['cp', containerId + ':/tmp/contract-backup.dump', join(artifacts, 'failed-contract-backup.dump')]);
                await dockerCommand(['rm', '--force', '--volumes', containerId]);
                if (await inspectOwnedContainer())
                    throw Error('本轮临时容器清理后仍存在');
            }
            for (const volume of manifest.container.anonymousVolumeNames) {
                try {
                    await dockerCommand(['volume', 'inspect', '--format', '{{.Name}}', volume]);
                }
                catch (error) {
                    if (absent(error))
                        continue;
                    throw error;
                }
                throw Error('本轮匿名卷清理后仍存在');
            }
        },
        // Keep receipts and failure evidence; successful disposable uploads are reproducible.
        removeTemporaryRoot: () => checksPassed ? rm(join(artifacts, 'files'), { recursive: true, force: true }) : Promise.resolve()
    });
    let cleanupPromise;
    function cleanup() {
        return cleanupPromise ??= (async () => {
            try {
                await lifecycleCleanup();
                manifest.cleanup = { status: 'completed', completedAt: new Date().toISOString() };
            }
            catch (error) {
                manifest.status = 'cleanup_failed';
                manifest.cleanup = { status: 'failed', errorKind: error.name };
                throw error;
            }
            finally {
                persist();
            }
        })();
    }
    function failureSummary(reason) { writeReceipt('failure-summary.json', { phase: manifest.phase, reason, runId, lastCommand: manifest.lastCommand }); }
    let interruptionPromise;
    function interrupt(signal) {
        if (interruptionPromise)
            return;
        interrupted = true;
        manifest.status = 'interrupted';
        failureSummary(signal);
        interruptionPromise ??= runInterruption({ signal, cleanup, reportError: message => process.stderr.write(message + '\n'), exit: code => {
                process.removeListener('SIGINT', onSigint);
                process.removeListener('SIGTERM', onSigterm);
                process.exit(code);
            } });
    }
    const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    async function run(bin, args, env = process.env, options = {}) {
        if (interrupted)
            throw Error('本轮测试已中断');
        manifest.lastCommand = { program: bin, action: args[0], testFiles: args.filter(value => /\.spec\.ts$/u.test(value)) };
        const childEnv = { ...env, ...dockerEnv };
        delete childEnv.DOCKER_CONTEXT;
        const result = await runtime.command(bin, args, { ...options, env: childEnv });
        if (result.stdout)
            process.stdout.write(redact(result.stdout));
        if (result.stderr)
            process.stderr.write(redact(result.stderr));
        return result.stdout;
    }
    try {
        persist();
        if (process.env.DOCKER_HOST && !localEndpoint.test(process.env.DOCKER_HOST))
            throw Error('Local Docker socket required');
        manifest.sourceSha = (await run('git', ['rev-parse', 'HEAD'])).trim();
        if (!/^[a-f0-9]{40}$/u.test(manifest.sourceSha))
            throw Error('Cannot identify source SHA');
        const endpoint = (await run(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).trim();
        if (!localEndpoint.test(endpoint))
            throw Error('Local Docker socket required');
        dockerEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: endpoint };
        manifest.endpoint = endpoint;
        manifest.daemonId = await dockerCommand(['info', '--format', '{{.ID}}']);
        await dockerCommand(['image', 'inspect', '--format', '{{.Id}}', 'postgres:16']);
        manifest.phase = 'starting';
        attempted = true;
        persist();
        const env = { ...process.env, ...dockerEnv, POSTGRES_PASSWORD: password };
        delete env.DOCKER_CONTEXT;
        const startedId = (await run(docker, ['run', '--rm', '--detach', "--pull=never", '--name', name, '--label', runLabel + '=' + runId, '--label', taskLabel + '=' + manifest.task, '--env', 'POSTGRES_USER=jiangkong', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=' + db, '--publish', '127.0.0.1::5432', "postgres:16"], env)).trim();
        const owned = await inspectOwnedContainer();
        if (!owned || owned.id !== startedId)
            throw Error("Cannot identify this run's container");
        manifest.phase = 'checks';
        persist();
        const port = (await run('docker', ['port', name, '5432/tcp'])).trim().split(':').pop();
        let ready = false;
        for (let i = 0; i < 40; i++) {
            try {
                await run(docker, ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'jiangkong', '-d', db]);
                ready = true;
                break;
            }
            catch (error) {
                if (interrupted)
                    throw error;
                await new Promise(done => setTimeout(done, 500));
            }
        }
        if (!ready)
            throw Error('Disposable PostgreSQL TCP server did not become ready');
        const target = 'postgresql://jiangkong:' + password + '@127.0.0.1:' + port + '/' + db;
        let testEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: target, PROJECT_AFFILIATE_COMPANY_CONTRACT_DATABASE_URL: target, RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS: '1', OPERATING_LEDGER_DB_WRITE_SECRET: randomUUID(), FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: join(artifacts, "files"), INITIAL_USER_TEMPORARY_PASSWORD: "Local-Transfer-Initial-01", SMS_ENABLED: "false", RUN_COMPANY_TRANSFER_HTTP: "1" };
        await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], testEnv);
        await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], testEnv);
        // Track this synchronous fixture as a child, so interruption can stop it
        // before the exact owned container is removed. Secrets stay in its env.
        const fixtureProgram = "const input=JSON.parse(process.env.JG_CONTRACT_BANK_FIXTURE_INPUT);process.stdout.write(require(process.argv[1]).prepareContractBankRuntime(input));";
        testEnv.CONTRACT_BANK_RUNTIME_DATABASE_URL = await run(process.execPath,
            ['-e', fixtureProgram, join(__dirname, 'contract-bank-runtime-fixture.cjs')],
            { ...env, JG_CONTRACT_BANK_FIXTURE_INPUT: JSON.stringify({ name, db, password, target }) },
            { timeoutMs: 120000 });
        await run('pnpm', ['exec', 'jest', '--runInBand', 'src/database/project-affiliate-company-contract-db.spec.ts', '--json', '--outputFile', join(artifacts, 'contract-tests.json')], testEnv);
        await run('docker', ['exec', name, 'pg_dump', '-U', 'contract_backup', '-d', db, '-Fc', '-f', '/tmp/contract-backup.dump']);
        backupCreated = true;
        await run('docker', ['exec', name, 'createdb', '-U', 'jiangkong', 'contract_restored']);
        await run('docker', ['exec', name, 'pg_restore', '--exit-on-error', '--no-owner', '-U', 'jiangkong', '-d', 'contract_restored', '/tmp/contract-backup.dump']);
        await run('docker', ['exec', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'contract_backup', '-d', 'contract_restored', '-f', '/tmp/backup-role.sql']);
        const restored = (await run('docker', ['exec', name, 'psql', '-At', '-U', 'jiangkong', '-d', 'contract_restored', '-c', `
   SELECT count(*)>0 FROM "ContractBankVerificationRequest" WHERE status='confirmed';
   SELECT has_function_privilege('contract_runtime','issue_contract_bank_holder(text,text,text,text,text,text)','EXECUTE'),has_function_privilege('contract_backup','issue_contract_bank_holder(text,text,text,text,text,text)','EXECUTE');
 `])).trim();
        if (restored !== "t\nt|f")
            throw Error('Restored bank facts and role ACL must survive the complete backup');
        backupVerified = true;
        writeReceipt('backup-restore-summary.json', { bankFactsRestored: true, runtimeAllowed: true, backupIssuerDenied: true });
        const coreDb = 'jiangkong_pol114';
        await run('docker', ['exec', name, 'createdb', '-U', 'jiangkong', coreDb]);
        const coreEnv = { ...testEnv, DATABASE_URL: target.replace('/' + db, '/' + coreDb), RUN_POL114_HTTP_PG16: '1', RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16: '1', RUN_POL114_PAYMENT_HTTP_PG16: '1', COMPANY_TRANSFER_CORE_RECEIPT: join(artifacts, 'core-fixture.json') };
        await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], coreEnv);
        await run('pnpm', ['exec', 'jest', '--runInBand', 'src/database/contract-business-entry-http.spec.ts', '--testNamePattern', '合同现役提交与旧入口退出：aggregate', '--json', '--outputFile', join(artifacts, 'core-tests.json')], coreEnv);
        await run('pnpm', ['exec', 'jest', '--runInBand', 'src/database/company-transfer-http-postgres.spec.ts', '--json', '--outputFile', join(artifacts, 'role-tests.json')], coreEnv);
        const paymentDb = 'jiangkong_payment_execution_concurrency';
        await run('docker', ['exec', name, 'createdb', '-U', 'jiangkong', paymentDb]);
        testEnv = { ...testEnv, DATABASE_URL: target.replace('/' + db, '/' + paymentDb), RUN_PAYMENT_EXECUTION_CONCURRENCY: '1' };
        await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], testEnv);
        await run('pnpm', ['exec', 'jest', '--runInBand', 'src/database/payment-execution-concurrency.spec.ts', '--json', '--outputFile', join(artifacts, 'payment-tests.json')], testEnv);
        checksPassed = true;
        await cleanup();
        if (interrupted)
            throw Error('本轮测试已中断');
        manifest.status = 'passed';
        manifest.phase = 'completed';
        persist();
        process.stdout.write('Test receipts: ' + artifacts + '\nISOLATED CONTRACT FINANCE CHECK PASS; synthetic empty database only; exact-SHA CI evidence requires the outer dynamic gate\n');
        return manifest;
    }
    catch (error) {
        if (!interrupted && manifest.status !== 'cleanup_failed')
            manifest.status = 'failed';
        failureSummary(interrupted ? 'interrupted' : error.name);
        throw Error(redact(error.message));
    }
    finally {
        try {
            await cleanup();
        }
        finally {
            process.removeListener('SIGINT', onSigint);
            process.removeListener('SIGTERM', onSigterm);
            process.stdout.write('Resource receipt: ' + join(artifacts, 'resource-manifest.json') + '\n');
        }
    }
}
if (require.main === module)
    main().catch(error => { process.stderr.write('合同分类本地验证失败：' + error.message + '\n'); process.exitCode = 1; });
module.exports = { main };
