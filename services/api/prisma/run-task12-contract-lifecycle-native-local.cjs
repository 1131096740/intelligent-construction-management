#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DATABASE, TERMINAL, DOCUMENT_ROLES, renderNativeLifecycleFixture, withNativeLifecycleCleanup, createNativeLifecycleRunnerFailureRecorder, projectNativeLifecyclePsqlFailure } = require('./task12-native-lifecycle-fixture.cjs');
const { CI_DYNAMIC_MIGRATION_LABEL, createCiDynamicMigrationFixture } = require('./local-staged-ci-dynamic.cjs');
const { createCommandRuntime } = require('./money-bigint-runner-runtime.cjs');
const { verifyCurrent259GeneratedDocumentRuntime } = require('./task12-current259-generated-document-runtime.cjs');
const root = path.resolve(__dirname, '../../..');
const pnpm = process.env.PNPM_BIN || 'pnpm';
function command(bin, args, options = {}) {
  const {psqlLineCount,...spawnOptions}=options;
  const result = spawnSync(bin, args, { cwd: root, env: process.env, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024, ...spawnOptions });
  if (result.error || result.status !== 0) {
    const failure=new Error('TASK12_NATIVE_GATE_COMMAND');
    const projected=projectNativeLifecyclePsqlFailure(result.stderr,psqlLineCount);
    if(projected)Object.defineProperty(failure,'nativePsql',{value:projected});
    throw failure;
  }
  return result.stdout?.trim() || '';
}
function nativeLifecycleContainerName(runId) { return 'jiangkong-task12-native-' + runId; }
function parseArgs(args) {
  if (!args.length) return undefined;
  if (args.length !== 8 || args[0] !== '--candidate-sha' || !/^[a-f0-9]{40}$/u.test(args[1]) ||
    args[2] !== '--runtime-input' || !path.isAbsolute(args[3]) || args[4] !== '--runtime-sha256' ||
    !/^[a-f0-9]{64}$/u.test(args[5]) || args[6] !== '--confirm' || args[7] !== 'LOCAL_TASK12_NATIVE_LIFECYCLE') {
    throw new Error('TASK12_NATIVE_GATE_ARGUMENTS');
  }
  return { sha: args[1], runtime: args[3], runtimeSha: args[5] };
}
const runnerFailures=new WeakMap();
async function main(args = process.argv.slice(2)) {
  const evidence=createNativeLifecycleRunnerFailureRecorder();
  try { return await run(args,evidence.enter,evidence.capture); }
  catch(error) {
    const projection=evidence.describe(error);
    const failure=new Error(projection.code);runnerFailures.set(failure,projection);throw failure;
  }
}
async function run(args,enter,capture) {
  const input = parseArgs(args);
  if (!input) return { status: 'TASK12_NATIVE_LIFECYCLE_NOT_EXECUTED', scope: 'local_current261_real_pg_http_native_documents' };
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL ||
    ['NODE_OPTIONS','NODE_PATH','DOC_CONVERTER_COMMAND','DOC_ALLOWED_FONTS','CONTRACT_MATERIAL_BODY25_DOCX4J_RUNTIME_MANIFEST'].some(key => process.env[key])) {
    throw new Error('TASK12_NATIVE_GATE_ENVIRONMENT');
  }
  enter('SOURCE');
  if (command('git', ['rev-parse','HEAD']) !== input.sha || command('git', ['status','--porcelain','--untracked-files=all'])) {
    throw new Error('TASK12_NATIVE_GATE_SOURCE');
  }
  // Mandatory original native runtime qualification precedes all PG resources.
  enter('RUNTIME');
  verifyCurrent259GeneratedDocumentRuntime(input.runtime, input.runtimeSha);
  enter('DOCKER_ENDPOINT');
  const endpoint = process.env.DOCKER_HOST || command('docker', ['context','inspect','--format','{{.Endpoints.docker.Host}}']);
  if (!endpoint.startsWith('unix://')) throw new Error('TASK12_NATIVE_GATE_DOCKER');
  const env = { ...process.env, DOCKER_HOST: endpoint, NODE_ENV: 'test' };
  delete env.DOCKER_CONTEXT;
  const docker = (args, options) => command('docker', ['--host',endpoint,...args], { env, ...options });
  enter('IMAGE');
  docker(['image','inspect','postgres:16','--format','{{.Id}}']);
  enter('PRETEST');
  command(pnpm, ['--filter','@jiangkong/api','run','pretest'], { env, stdio: 'inherit' });
  enter('BUILD');
  command(pnpm, ['--filter','@jiangkong/api','build'], { env, stdio: 'inherit' });
  const runId = randomUUID(), name = nativeLifecycleContainerName(runId);
  enter('DIRECTORY');
  const directory = fs.realpathSync(fs.mkdtempSync('/private/tmp/jg-task12-native-'));
  fs.chmodSync(directory, 0o700);
  const ownerPassword = randomBytes(32).toString('hex');
  let container, applicationOid;
  return withNativeLifecycleCleanup(async () => {
    enter('CONTAINER_START');
    container = docker(['run','--detach','--rm','--pull=never','--name',name,
      '--label',CI_DYNAMIC_MIGRATION_LABEL+'='+runId,'--env','POSTGRES_PASSWORD','--env','PGPASSWORD','--env','POSTGRES_USER=jiangkong',
      '--env','POSTGRES_DB='+DATABASE,'--publish','127.0.0.1::5432','postgres:16'], { env: { ...env, POSTGRES_PASSWORD: ownerPassword, PGPASSWORD: ownerPassword } });
    if (!/^[a-f0-9]{64}$/u.test(container)) throw new Error('TASK12_NATIVE_GATE_CONTAINER');
    enter('PG_READY');
    docker(['exec',container,'sh','-c',`for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d ${DATABASE} && exit 0; sleep 0.2; done; exit 1`]);
    enter('PORT');
    const port = /^127\.0\.0\.1:(\d+)$/u.exec(docker(['port',container,'5432/tcp']))?.[1];
    if (!port) throw new Error('TASK12_NATIVE_GATE_LOOPBACK');
    const ownerUrl = `postgresql://jiangkong:${ownerPassword}@127.0.0.1:${port}/${DATABASE}`;
    const runtime = createCommandRuntime({ defaultCwd: root });
    enter('MIGRATION_FIXTURE');
    const fixture = createCiDynamicMigrationFixture({ ciFixture: 'DYNAMIC_REMAINING_V1',
      container: { id: container, name, runId }, databaseNames: [DATABASE], temporaryRoot: directory,
      dockerCommand: (args, options) => runtime.command('docker', ['--host',endpoint,...args], { ...options, env }),
      deploy: async ({ databaseUrl, runtimeEnv, schemaPath }) => {
        const options = new URL(databaseUrl).searchParams.get('options') || '';
        const observed = /app\.contract_archive_v2_application_role_oid=(\d+)/u.exec(options)?.[1];
        if (observed) {
          if (applicationOid && observed !== applicationOid) throw new Error('TASK12_NATIVE_GATE_APP_CHANGED');
          applicationOid = observed;
        }
        return runtime.command(pnpm, ['--filter','@jiangkong/api','exec','prisma','migrate','deploy', ...(schemaPath ? ['--schema',schemaPath] : [])],
          { env: { ...runtimeEnv, DATABASE_URL: databaseUrl }, forwardOutput: true });
      }
    });
    enter('MIGRATION_APPLY');
    await fixture.migrate({ databaseUrl: ownerUrl, runtimeEnv: env });
    if (!applicationOid || !/^[1-9][0-9]{1,9}$/u.test(applicationOid)) throw new Error('TASK12_NATIVE_GATE_APP_MISSING');
    const psql = sql => docker(['exec','--interactive',container,'psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','jiangkong','-d',DATABASE,'-f','-'], { input: sql,psqlLineCount:sql.split('\n').length });
    enter('ORIGINAL_APP_READ');
    const applicationRole = psql(`SELECT rolname FROM pg_roles WHERE oid=${applicationOid}::oid;`);
    const scope = { database: DATABASE, appName: applicationRole, appOid: applicationOid, migrationCount: 261, terminal: TERMINAL };
    const secrets = Object.fromEntries(['application',...Object.keys(DOCUMENT_ROLES)].map(slot => [slot,randomBytes(32).toString('hex')]));
    enter('ROLE_PROVISION');
    psql(renderNativeLifecycleFixture(scope, secrets));
    const urls = Object.fromEntries(Object.entries({ application: applicationRole, ...DOCUMENT_ROLES }).map(([slot, role]) =>
      [slot,`postgresql://${role}:${secrets[slot]}@127.0.0.1:${port}/${DATABASE}?connection_limit=1`]));
    enter('PACKET');
    const packet = path.join(directory, 'test-input.json');
    const files = path.join(directory, 'files');fs.mkdirSync(files, { mode: 0o700 });
    fs.writeFileSync(packet, JSON.stringify({ version: 1, candidateSha: input.sha, scope, ownerUrl, urls, directory, runtime: input.runtime, runtimeSha: input.runtimeSha }), { mode: 0o600, flag: 'wx' });
    enter('NATIVE_SUITE');
    command(pnpm, ['--filter','@jiangkong/api','exec','jest','--runInBand','--testRegex','task12-contract-lifecycle\\.native\\.spec\\.ts$','--runTestsByPath','src/database/task12-contract-lifecycle.native.spec.ts','--testPathIgnorePatterns',
      ...require('../jest.config.cjs').testPathIgnorePatterns.filter(pattern=>pattern!=='/database/task12-contract-lifecycle\\.native\\.spec\\.ts$')],
      { env: { ...env, DATABASE_URL: urls.application, FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: files,
        FILE_DOWNLOAD_SECRET: randomBytes(32).toString('hex'), TASK12_NATIVE_LIFECYCLE_INPUT: packet }, stdio: 'inherit', timeout: 900_000 });
    return { status: 'TASK12_NATIVE_LIFECYCLE_PG_HTTP_PASSED', candidateSha: input.sha, migrationCount: 261 };
  }, [
    ['CONTAINER_REMOVE', () => {
      enter('CLEANUP_CONTAINER');
      // A lost docker-run response does not prove the daemon failed to create
      // the resource. Recover only this run's exact name and ownership label.
      const list = () => docker(['container','ls','--all','--no-trunc','--filter','name=^/'+name+'$',
        '--format','{{.ID}} {{.Names}} {{.Label "'+CI_DYNAMIC_MIGRATION_LABEL+'"}}']);
      const observed = list();
      if (observed) {
        const row = observed.split(' ');
        if (row.length !== 3 || !/^[a-f0-9]{64}$/u.test(row[0]) || row[1] !== name || row[2] !== runId ||
          (container && container !== row[0])) throw new Error('TASK12_NATIVE_GATE_CONTAINER_CLEANUP');
        const containerId = row[0];
        docker(['rm','--force','--volumes',containerId]);
        if (list()) throw new Error('TASK12_NATIVE_GATE_CONTAINER_CLEANUP');
      }
      // A missing name is insufficient if the returned container ID survives
      // under a changed name. Do not remove it without the ownership proof.
      if (container && docker(['container','ls','--all','--no-trunc','--filter','id='+container,'--format','{{.ID}}'])) {
        throw new Error('TASK12_NATIVE_GATE_CONTAINER_CLEANUP');
      }
    }],
    ['DIRECTORY_REMOVE', () => {
      enter('CLEANUP_DIRECTORY');
      fs.rmSync(directory, { recursive: true, force: true });
      if(fs.existsSync(directory))throw new Error('TASK12_NATIVE_GATE_DIRECTORY_CLEANUP');
    }]
  ], {primary:capture,cleanup(step,error){
    capture(error);
    // Fixed projection only. A broken diagnostic pipe must not mask the first
    // business/cleanup error already retained by the native cleanup boundary.
    try {process.stderr.write('TASK12_NATIVE_GATE_CLEANUP_FAILED_'+step+'\n');}catch{}
  }});
}
if (require.main === module) main().then(value => process.stdout.write(JSON.stringify(value)+'\n')).catch(error => {
  const projection=runnerFailures.get(error)??{stage:'INPUT',code:'TASK12_NATIVE_GATE_REJECTED'};
  process.stderr.write('TASK12_NATIVE_GATE_FAILURE '+JSON.stringify(projection)+'\n');process.exitCode=1;
});
module.exports = { parseArgs, main, nativeLifecycleContainerName };
