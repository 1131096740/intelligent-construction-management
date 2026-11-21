'use strict';
// Installer-only qualification. Run inside the pinned, network-disabled image.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { createRequire } = require('node:module');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (test, code) => { if (!test) throw new Error(code); };
const capture = file => { const bytes = fs.readFileSync(file); return { bytes, sha256: hash(bytes) }; };

const releaseSha = '0a5b607cf912ffbb50237af2608ac8b2a5360c16';
// The immutable historical subset was originally reconciled against 279.
// Every included current-release blob still has to match its original SHA.
const subsetReleaseSha = 'ee19df0b6bdd3984151e1216016654f3b39ba925';
const subsetReleaseTree = '2e7aa4931b37881e6e7a19df46c310e761c43d6f';
const releaseTree = '7f3b0612fd3eefa4cd1b9178eab5231fc5609433';
const stageSha = 'ee7a215f530f553949bb57cd029587e490bf9c84';
const stageTree = 'd1cd9e6246c915cdfa48be44b672e09102b59c8b';
const historicalSeal = '8ae09674e72061cab1a5e4e0035aa0b79d18381bee2ed22d704402e59789f679';
const subsetManifestSha = '5c4871e8e9fa2d32bf88ea1147523c5eebc67c04a5fe43794ca996a26e46373a';
const sealedMode = 'SEALED_FULL_METADATA_EXACT_INSTALLER_CLOSURE';
const fullMode = 'FULL_SOURCE_REHASH';
const installedDependencyRoots = new Set(['node_modules', 'services/api/node_modules', 'packages/shared-domain/node_modules']);

const expectedLedger = '7f168217e13a6ab96a188c390ee0ac13d682b17c3744b9527e36a235253a5979';
const stableRelease = Object.freeze({
  count:280, sha:releaseSha, tree:releaseTree, ledgerSha256:expectedLedger,
});
const successorRelease = Object.freeze({
  count:281,
  tree:'7daa4bf81a4f141fe5476a99c61eb4d3bbc451eb',
  terminalSha256:'257ea44623aee810067756893d93ba84769f1fce1581375e64457812fcd42ee2',
  ledgerSha256:'f9e47d57c3c032a2a9b1b1c1201f12a2837a3af3a54358c50f4b1bb78ecbf93b',
});
const readSuccessorRelease = Object.freeze({
  count:282,
  tree:'8d3e50a0c525a68e717b74fbecbcceabc80840f7',
  terminalSha256:'e1ff36a191e8173a2cf06db3c20aa386db58360bfceba39eed010f9444da196e',
  ledgerSha256:'be6d9aed22658af5e273010a2e1e839544fa27e74e998701fb3d9e9248f88cfc',
  readBodySha256:'57d394ea66ab184740cb085f24cba133111c1f853ab07a168c108cba5445db82',
});
const procurementArchiveRelease=Object.freeze({
  ...readSuccessorRelease,count:283,tree:'201f32c7326b7bc2378915139435b4d657be68e1',terminalSha256:'89f7b2275cdfb0a1feb75869f2ee28f1f4b5c407c2eccc01eddd3f33a871c7ca',ledgerSha256:'8e41884d7efd1b1aaa2130eaf9355a02416dd9d0a68ea3244bee5e44e17c97c8',procurementScope:true,
});
const legacyExpenseRelease=Object.freeze({
  ...procurementArchiveRelease,count:284,tree:'04ff55b3d781c6f8f33da031eead8ee314c98d62',terminalSha256:'a3680d47de75bf17dc60a44b952969420a267af76410d5ddb0955a44556654c4',ledgerSha256:'2cb0438ab2de01662ffcc238b6290343c3de3214e1d3bebd25ac74d5331e494b'
});
const projectArchiveRelease=Object.freeze({
  ...legacyExpenseRelease,count:285,tree:'7e7c60e7743adffbe7db5a0b906a88349e1d07e4',terminalSha256:'10acf25324d27a533811e7899d39373362c8f8e4b5de7d9da6a6dbf2757076c5',ledgerSha256:'e3c69b4d5637d541ea000255dc20da735ac576320b59e4a2149deda3a4ceb6c5',
  procurementScope:false,projectBusinessScope:true
});
const projectDraftRelease=Object.freeze({
  ...projectArchiveRelease,count:286,tree:'2b376dd1b3db51c4216471344288bd1765018a9b',terminalSha256:'294c8edb350ce6a40c52c027eb31ef37f56bc2f49601ebdd882b506448534e71',ledgerSha256:'95a3bcc75def5f6f81e4d51a92c24e6e8a93766125d5f2bf5b544ad0f3ce087c'
});
const projectLegacyReviewRelease=Object.freeze({
  ...projectDraftRelease,count:287,tree:'45e36af8cf7adf495e484d8196404f970fc9541c',terminalSha256:'dd5cce3d76dc155d75ff11dc40dfec949672353f06874c1144e2cf86249392a4',ledgerSha256:'059563979fd033f0be299fb8af3f603083ac3f877abaa48ff38b1ea5791bf5f3'
});
const owner = 'jg_task01_owner';
const outsideRelease = Object.freeze({
  readBodySha256:readSuccessorRelease.readBodySha256,
  count:289, tree:'a1be083076018686dd8afba68c44ff9c75502014', ledgerSha256:'5c5e77dc94502b706c6e52c5761f52573e27cca46efb812f9b8b22216ec52f67',
});
const outsideMilestones = Object.freeze([
  {count:288, migration:{"name":"20261118235900_contract_outside_original_pair_voucher_check","sha256":"8f9b15f73ef8234aecc35a16517f4351fa883ebf5d98b31e1483502012a31253","finished":true,"rolledBack":false}, ledgerSha256:'9e30b3f68e4909bbd1a7aa6beb2eb0345a49c350070062e86757da11d5cc0c44'},
  {count:289, migration:{"name":"20261119000500_contract_outside_archive_evidence_voucher_check","sha256":"90c194e51d72760db01145dca0678fdf4ff427c017074d1728c76e6dc876c0e4","finished":true,"rolledBack":false}, ledgerSha256:'5c5e77dc94502b706c6e52c5761f52573e27cca46efb812f9b8b22216ec52f67'},
]);
const outsideBodies = Object.freeze({
  'jg_enforce_exclusive_file_business_binding()': Object.freeze(['07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29', '30d0ba55bb974923629f652d55b12ddfe53735a6bebaa69132b1ae0044ad467c']),
  'jg_require_contract_direct_upward_source_v2()': Object.freeze(['8a74f938325116c532b2a6763b2b26563605dbbd74723bee60c74e597149ca3c', 'd005d2656d61326258b6fd353c504731d4042e3081d5911e5bd9a7681c970552']),
  'jg_upward_archive_catalog_projection_v2()': Object.freeze(['ebf786dd48b05ab47c62b283d702521ceb8edc00a0a8aa54f7194461560604b9', '105281430d2bd723a93626bc129ca497486787d6f8476b95f324a8b1d0324c9e']),
  'jg_upward_direct_archive_admission_v1()': Object.freeze(['eed377ea62bedf5b75e8d9b75afcb2ce132b8a1281d4fe0564525f836743c20e', 'bfbe61100be1d1705095a03e11c9ef6db48ca05d282aeff03c2d21ea137cb411']),
});
function outsideWitnessSql(count) {
  need(count===288 || count===289,'UNKNOWN_OUTSIDE_CATALOG_MILESTONE');
  const checks = Object.entries(outsideBodies).map(([name,bodies]) =>
    `(to_regprocedure('public.${name}')::oid, '${bodies[count-288]}')`).join(', ');
  return `SELECT jsonb_build_object(
    'upward',public.jg_require_contract_direct_upward_source_v2() IS NOT NULL,
    'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
    'exactPostimage', (SELECT count(*)=4 AND bool_and(encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=e.sha)
      FROM (VALUES ${checks}) e(oid,sha) JOIN pg_proc p ON p.oid=e.oid),
      'outsidePairScopeClosed', NOT EXISTS(SELECT FROM public.jg_a08_outside_original_pair_v1)
      AND EXISTS(SELECT FROM pg_proc pair WHERE pair.oid=to_regprocedure('public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)')
        AND pair.proowner=current_user::regrole::oid
        AND (SELECT count(*)=1 AND bool_and(a.grantor=pair.proowner AND a.grantee=pair.proowner
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) FROM aclexplode(pair.proacl) a))
${count===289 ? `,
      'outsideArchiveEvidenceBound', EXISTS(SELECT FROM pg_proc f
        JOIN public.jg_contract_direct_archive_intent_binding_v1 b ON b."protocolVersion"=1
        WHERE f.oid=to_regprocedure('public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text)')
          AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict
          AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='a750acd0ed0f370d90bb0106146185678c5eb60fa94e5cfdfa0794bf96ca1081'
          AND (SELECT count(*)=2 AND count(*) FILTER(WHERE acl.grantee=b."executorOwnerOid")=1
            AND bool_and(acl.grantor=f.proowner AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable
              AND acl.grantee IN (f.proowner,b."executorOwnerOid")) FROM aclexplode(f.proacl) acl)
          AND NOT has_function_privilege(b."ordinaryApplicationRoleOid",f.oid,'EXECUTE')
          AND NOT has_function_privilege(b."runtimeSessionOid",f.oid,'EXECUTE')
          AND NOT has_function_privilege(b."executorOwnerOid",'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE'))` : ''}
  );`;
}
function assertOutsideWitness(count, observed) {
  need(equal(observed,{upward:true,tls:true,exactPostimage:true,outsidePairScopeClosed:true,
    ...(count===289 ? {outsideArchiveEvidenceBound:true} : {})}), 'OUTSIDE_'+count+'_CATALOG_WITNESS');
}

function finalWitnessMismatch(observed, expected) {
  return {
    fields:Object.keys(expected).filter(name => observed?.[name] !== expected[name]),
    unexpectedCount:Object.keys(observed ?? {}).filter(name => !Object.hasOwn(expected,name)).length,
  };
}
const baseEnv = { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };

function readLedger(root) {
  const names = fs.readdirSync(path.join(root, 'migrations')).sort().filter(name => name !== 'migration_lock.toml');
  return names.map(name => {
    need(/^\d{14}_[a-z0-9_]+$/u.test(name), 'INVALID_MIGRATION_NAME');
    const dir = path.join(root, 'migrations', name);
    need(equal(fs.readdirSync(dir), ['migration.sql']), 'INVALID_MIGRATION_DIRECTORY');
    return {name, sha256: capture(path.join(dir, 'migration.sql')).sha256, finished:true, rolledBack:false};
  });
}

function verifyPinnedInputs(historical, product, seal, release) {
  const historicalLedger = readLedger(historical);
  const ledger = readLedger(product);
  need(ledger.length === release.count && historicalLedger.length === 263 &&
    equal(historicalLedger, ledger.slice(0,263)) &&
    hash(JSON.stringify(ledger.slice(0,stableRelease.count))) === stableRelease.ledgerSha256 &&
    hash(JSON.stringify(ledger)) === release.ledgerSha256, 'UNEXPECTED_MIGRATION_INVENTORY');
  if (release.count >= 281) {
    need(ledger[280].name === '20261118230000_registered_payment_voucher_fixed_binding' &&
      ledger[280].sha256 === successorRelease.terminalSha256 &&
      hash(JSON.stringify(ledger.slice(0,281))) === successorRelease.ledgerSha256, 'UNEXPECTED_281_TERMINAL');
  }
  if (release.count >= 282) {
    need(ledger[281].name === '20261118231000_registered_payment_voucher_fixed_read' &&
      ledger[281].sha256 === readSuccessorRelease.terminalSha256 &&
      hash(JSON.stringify(ledger.slice(0,282))) === readSuccessorRelease.ledgerSha256, 'UNEXPECTED_282_TERMINAL');
  }
  if(release.count>=283) need(ledger[282].name==='20261118232000_general_procurement_archive_fixed_binding' && ledger[282].sha256===procurementArchiveRelease.terminalSha256 &&
    hash(JSON.stringify(ledger.slice(0,283)))===procurementArchiveRelease.ledgerSha256,'UNEXPECTED_283_TERMINAL');
  if(release.count>=284) need(ledger[283].name==='20261118233000_legacy_procurement_expense_voucher_fixed_binding' && ledger[283].sha256===legacyExpenseRelease.terminalSha256 &&
    hash(JSON.stringify(ledger.slice(0,284)))===legacyExpenseRelease.ledgerSha256,'UNEXPECTED_284_TERMINAL');
  if(release.count>=285) need(ledger[284].name==='20261118234000_project_business_scope_archive_role' && ledger[284].sha256===projectArchiveRelease.terminalSha256 &&
    hash(JSON.stringify(ledger.slice(0,285)))===projectArchiveRelease.ledgerSha256,'UNEXPECTED_285_TERMINAL');
  if(release.count>=286) need(ledger[285].name==='20261118235000_project_scope_initial_contract_draft'
    && ledger[285].sha256===projectDraftRelease.terminalSha256 && hash(JSON.stringify(ledger.slice(0,286)))===projectDraftRelease.ledgerSha256,'UNEXPECTED_286_TERMINAL');
  if(release.count>=287) need(ledger[286].name==='20261118235500_project_scope_legacy_review_status'
    && ledger[286].sha256===projectLegacyReviewRelease.terminalSha256
    && hash(JSON.stringify(ledger.slice(0,287)))===projectLegacyReviewRelease.ledgerSha256,'UNEXPECTED_287_TERMINAL');
  if(release===outsideRelease) for(const milestone of outsideMilestones) {
    need(equal(ledger[milestone.count-1], milestone.migration) &&
      hash(JSON.stringify(ledger.slice(0,milestone.count)))===milestone.ledgerSha256,
      'UNEXPECTED_'+milestone.count+'_TERMINAL');
  }
  const schema = capture(path.join(product, 'schema.prisma'));
  need(schema.sha256 === '8154b5a52bee19a0a105ea949f2fb272f6876f7c92fbf1e0b57b0104d93b87be', 'UNEXPECTED_RELEASE_SCHEMA');
  const fromHistory = createRequire(path.join(historical, 'schema.prisma'));
  const profile = fromHistory('./task16-current259-profile.cjs').qualifyCurrent259Source({
    candidateSha:stageSha, sealSha256:seal, schemaSha256:capture(path.join(historical, 'schema.prisma')).sha256,
    migrations:historicalLedger.map(({name,sha256}) => ({path:'services/api/prisma/migrations/'+name+'/migration.sql',sha256})),
  });
  need(profile.profile === 'TASK12_ARCHIVE263_SOURCE_V1', 'UNEXPECTED_HISTORICAL_PROFILE');
  return { ledger, profile, schema, fromHistory };
}

function verifyInputs(historical, product, seal) {
  return verifyPinnedInputs(historical, product, seal, stableRelease);
}

async function migrateNativeTask16(plan,root,port,password,sql,jsonSql,command,enter,fromHistory){
 const controls=fromHistory('./local-staged-migration-controls.cjs'),{createLocalTailQualification}=fromHistory('./local-staged-tail-qualification.cjs');
 const ledger=plan.source.witness.profile.ledger,migrations=ledger.map(({name,sha256})=>({name,sha256})),database=plan.database;
 const {cli,engine}=plan.prismaTools;
 const schema=capture(path.join(plan.historical,'schema.prisma')).bytes;
 const roots=new Map();
 for(const size of [...new Set([203,205,213,215,218,221,ledger.length])]){
  const dir=path.join(root,'prefixes',String(size));fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(path.join(dir,'migrations'),{mode:0o700});
  fs.writeFileSync(path.join(dir,'schema.prisma'),schema,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(dir,'migrations/migration_lock.toml'),'provider = "postgresql"\n',{flag:'wx',mode:0o600});
  for(const row of ledger.slice(0,size)){
   const bytes=capture(path.join(plan.historical,'migrations',row.name,'migration.sql')).bytes;need(hash(bytes)===row.sha256,'NATIVE_DIRECT_MIGRATION_SOURCE');
   const target=path.join(dir,'migrations',row.name);fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'migration.sql'),bytes,{flag:'wx',mode:0o600});
  }
  roots.set(size,dir);
 }
 const baseUrl=new URL('postgresql://jg_task01_owner@127.0.0.1:'+port+'/'+database);baseUrl.password=password;
 for(const [key,value]of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:path.join(root,'ca.crt'),connect_timeout:'5',pool_timeout:'5'}))baseUrl.searchParams.set(key,value);
 const deploy=async(size,url=baseUrl)=>{enter('MIGRATE_'+size);await command(process.execPath,[cli,'migrate','deploy','--schema',path.join(roots.get(size),'schema.prisma')],{timeoutMs:plan.limits.migrationMs,extra:{DATABASE_URL:url.toString(),PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'}});};
 const identity=row=>{need(row.database===database&&row.ownerOid==='10'&&row.actorOid==='10'&&row.actor==='jg_task01_owner'&&row.sessionActor==='jg_task01_owner'&&row.version===160015&&row.encoding==='UTF8'&&row.replication==='origin','NATIVE_DIRECT_MIGRATION_IDENTITY');return Object.fromEntries(['database','databaseOid','namespaceOid','actorOid','ownerOid','systemIdentifier'].map(k=>[k,row[k]]));};
 const checkLedger=(row,size)=>{need(equal(row.ledger,ledger.slice(0,size)),'NATIVE_DIRECT_MIGRATION_LEDGER');};
 await deploy(203);const first=await jsonSql(controls.inspectSql());const bound=identity(first);checkLedger(first,203);
 const migrationPlan={...bound,runId:randomUUID(),nonce:randomBytes(32).toString('hex'),appName:'jg_fixture_app_'+randomBytes(12).toString('hex'),schemaName:'jg_fixture_'+randomBytes(12).toString('hex'),technicalProfile:'CURRENT259_OWNED_TECHNICAL_V1',resourceRunId:plan.runId,migrations:migrations.slice(0,205)};
 const setup=await jsonSql(controls.setupSql(migrationPlan));controls.checkSetup(setup,migrationPlan);
 const qualified=new URL(baseUrl);qualified.searchParams.set('options','-c app.contract_archive_v2_application_role_oid='+setup.appOid+' -c app.contract_archive_v2_file_caller_oids='+JSON.stringify(setup.fileCallerOids)+' -c app.local_migration_nonce='+migrationPlan.nonce);
 await deploy(205,qualified);const completed=controls.parseReadback((await sql(controls.readbackSql(migrationPlan,setup))).stdout);need(equal(identity(completed),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(completed,205);controls.checkCompletion(completed,migrationPlan,setup);
 await sql(controls.cleanupSql(migrationPlan,setup));const clean=await jsonSql(controls.cleanReadSql(migrationPlan,setup));need(clean.schemaAbsent===true&&clean.eventAbsent===true&&clean.appOid===setup.appOid&&clean.applicationQualified===true,'NATIVE_DIRECT_QUALIFICATION_CLEANUP');
 const materials=[];const tail=createLocalTailQualification({plan:migrationPlan,setup,migrations},{read:async(_phase,text)=>jsonSql(text),write:async(_phase,text)=>jsonSql(text),recordMaterial:row=>{need(hash(Buffer.from(row.sql))===row.afterSha256,'NATIVE_DIRECT_SQL_MATERIAL');materials.push({kind:row.kind,beforeSha256:row.beforeSha256,afterSha256:row.afterSha256});}});
 for(const size of [213,215,218,221]){await deploy(size);const row=await jsonSql(controls.inspectSql());need(equal(identity(row),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(row,size);await tail.qualify(size);}
 await deploy(ledger.length);const final=await jsonSql(controls.inspectSql());need(equal(identity(final),bound),'NATIVE_DIRECT_MIGRATION_IDENTITY');checkLedger(final,ledger.length);
 return {plan:migrationPlan,setup,materials};
}

function runCommand(file, args, {stdin, timeoutMs = 120_000, extra, allowFailure, cwd} = {}) {
  const result = spawnSync(file, args, {
    input: stdin, encoding:'utf8', timeout:timeoutMs, maxBuffer:16 * 1024 * 1024,
    cwd:cwd ?? (process.env.JG_RUN_ROOT || '/tmp'), env:{ ...baseEnv, HOME:'/tmp', ...extra },
  });
  if (result.status !== 0 && !allowFailure) {
    if (process.argv[2] === '--tls-probe' && typeof result.stderr === 'string') {
      const diagnostic = result.stderr.replace(/postgres(?:ql)?:\/\/[^\s]+/gu,'[redacted PostgreSQL URL]');
      process.stderr.write(diagnostic);
    }
    // Return only structured diagnostic codes. Stderr may contain private SQL or role secrets.
    throw Object.assign(new Error('INSTALLER_COMMAND_FAILED'), {
      command: path.basename(file), exit: result.status, signal: result.signal,
      ...(path.basename(file)==='psql'
        ? {psqlObservation:require('/qualification/owner-observation.cjs').projectPsql(result.stderr)}
        : {}),
      executionError: result.error?.code, sqlstate: /(?:Database error code:\s*|ERROR:\s+)([0-9A-Z]{5})(?=[:\s]|$)/u.exec(result.stderr || '')?.[1],
      migrationCause: [
        ['ORIGINAL_TRIGGER_SET','对上登记事务守卫集合不完整'],
        ['EXACT_SUCCESSOR_MANIFEST','PROJECT_SCOPE_DRAFT_ARCHIVE_TRIGGER_MANIFEST'],
        ['PREIMAGE','PROJECT_SCOPE_DRAFT_MANIFEST_PREIMAGE'],
        ['POSTIMAGE','PROJECT_SCOPE_DRAFT_MANIFEST_POSTIMAGE'],
        ['SOURCE_DIGEST','PROJECT_SCOPE_DRAFT_MANIFEST_DIGEST'],
        ['OWNER_OR_CLOSURE_SCOPE','PROJECT_SCOPE_DRAFT_INSTALL_SCOPE'],
      ].find(([,marker]) => (result.stderr || '').includes(marker))?.[0],
      prismaCode: /\bP[0-9]{4}\b/u.exec(result.stderr || '')?.[0],
      tlsDiagnostic: ['certificate verify failed','hostname mismatch','IP address mismatch','unable to get local issuer certificate',
        'self-signed certificate','certificate has expired','certificate is not yet valid','ee key too small','wrong version number']
        .filter(reason => (result.stderr || '').toLowerCase().includes(reason.toLowerCase())),
    });
  }
  return {stdout:result.stdout, code:result.status};
}

async function installer(receipt, probeOnly, consume, release=stableRelease) {
  const historical = '/qualification/source/services/api/prisma';
  const product = '/qualification/product/services/api/prisma';
  need(process.platform === 'linux' && process.getuid() !== 0 && process.version === 'v20.20.2'
    && ['x64','arm64'].includes(process.arch) && process.execArgv.length === 0
    && !process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'INVALID_LINUX_RUNTIME');
  const seal = fs.readFileSync('/qualification/source-seal.txt','utf8').trim();
  need(seal === historicalSeal, 'INVALID_SOURCE_SEAL');
  const sourceAdmission = readSourceAdmission('/qualification/source-admission.json');
  if (sourceAdmission.mode === sealedMode) {
    verifyClosedFiles('/qualification/source', sourceAdmission.selected, installedDependencyRoots);
  }
  const {ledger, profile, schema, fromHistory} = verifyPinnedInputs(historical, product, seal, release);
  const native = fromHistory('./run-task12-native-con18-once.cjs');
  const control = fromHistory('./local-staged-migration-controls.cjs');
  const cli = fs.realpathSync(fromHistory.resolve('prisma/build/index.js'));
  const engines = fs.realpathSync(createRequire(cli).resolve('@prisma/engines/package.json'));
  const engine = path.join(path.dirname(engines), process.arch === 'arm64' ?
    'schema-engine-linux-arm64-openssl-3.0.x' : 'schema-engine-debian-openssl-3.0.x');
  need(JSON.parse(fs.readFileSync(engines)).version === '5.22.0' &&
    runCommand(engine, ['--version']).stdout.trim() === 'schema-engine-cli 605197351a3c8bdd595af2d2a9bc3025bca48ea2', 'INVALID_PRISMA_ENGINE');
  receipt.cgroupPids = {limit:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(), before:fs.readFileSync('/sys/fs/cgroup/pids.events','utf8').trim()};
  receipt.runtime = {
    platform:process.platform, arch:process.arch, node:process.version,
    versions:runCommand('dpkg-query',['-W','postgresql-16','postgresql-client-16','openssl']).stdout.trim().split('\n'),
    nodeSha256:capture(process.execPath).sha256, prismaCliSha256:capture(cli).sha256, prismaEngineSha256:capture(engine).sha256,
    postgresSha256:capture('/usr/lib/postgresql/16/bin/postgres').sha256,
  };
  receipt.historical = {sha:stageSha, tree:stageTree, sourceSeal:seal, ledgerSha256:profile.ledgerSha256,
    sourceAdmission:{mode:sourceAdmission.mode, ...(sourceAdmission.mode === sealedMode ?
      {metadataRows:4134, verifiedFiles:318, subsetManifestSha256:subsetManifestSha} : {})}};
  const runId = randomUUID(), database = 'jg_task01_' + runId.replaceAll('-',''), started = Math.floor(Date.now()/1000);
  const root = fs.mkdtempSync('/tmp/jg394-'), data = path.join(root,'data');
  const plan = {runId, database, historical, source:{witness:{profile}}, prismaTools:{cli, engine}, limits:{migrationMs:180000}};
  receipt.runId = runId;
  const credentials = Object.fromEntries(['owner','runtime','observer'].map(k => [k,randomBytes(48).toString('hex')]));
  let pg, lifetime, postmaster;
  const enter = stage => {
    if (lifetime) need(lifetime.running(), 'POSTMASTER_NOT_RUNNING');
    if (postmaster) need(equal(readPostmaster(), postmaster), 'POSTMASTER_IDENTITY_DRIFT');
    receipt.stages.push(stage);
  };
  const readPostmaster = () => fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split('\n').slice(0,4);
  const command = async (...args) => runCommand(...args);
  const write = (name, value) => fs.writeFileSync(path.join(root,name), value, {flag:'wx',mode:0o600});
  try {
    enter('TLS_AND_INITDB');
    for (const dir of ['socket','prefixes']) fs.mkdirSync(path.join(root,dir),{mode:0o700});
    const abs = name => path.join(root,name);
    const openssl = args => runCommand('openssl',args);
    for (const name of ['ca','wrong-ca']) {
      openssl(['req','-new','-newkey','rsa:2048','-nodes','-x509','-sha256','-days','2','-subj','/CN=jg394-'+name+'-'+runId,'-keyout',abs(name+'.key'),'-out',abs(name+'.crt')]);
    }
    write('server.ext','subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
    openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=jg394-'+runId,'-keyout',abs('server.key'),'-out',abs('server.csr')]);
    openssl(['x509','-req','-sha256','-days','2','-in',abs('server.csr'),'-CA',abs('ca.crt'),'-CAkey',abs('ca.key'),'-set_serial','1','-extfile',abs('server.ext'),'-out',abs('server.crt')]);
    fs.chmodSync(abs('server.key'),0o600);
    write('initdb.secret',credentials.owner+'\n');
    try {
      runCommand('initdb',['-D',data,'-U',owner,'--encoding=UTF8','--locale=C','--auth-local=reject','--auth-host=scram-sha-256','--pwfile',abs('initdb.secret')]);
    } finally { fs.unlinkSync(abs('initdb.secret')); }
    const port = await new Promise((resolve,reject) => {
      const server = require('node:net').createServer();
      server.once('error',reject);
      server.listen(0,'127.0.0.1',() => {
        const port = server.address().port;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
    need(port > 1024 && port !== 5432, 'INVALID_POSTMASTER_PORT');
    const hba = `local all all reject
hostnossl all all 127.0.0.1/32 reject
hostssl all ${owner} 127.0.0.1/32 scram-sha-256
hostssl ${database} jg_task01_runtime,jg_task01_observer 127.0.0.1/32 scram-sha-256
${release.procurementScope ? `hostssl ${database} general_procurement_runtime 127.0.0.1/32 scram-sha-256\n` : ''}${release.projectBusinessScope ? `hostssl ${database} project_business_scope_runtime 127.0.0.1/32 scram-sha-256\n` : ''}hostssl all all 127.0.0.1/32 reject
`;
    fs.writeFileSync(abs('data/pg_hba.conf'), hba);
    const config = `listen_addresses='127.0.0.1,::1'
port=${port}
unix_socket_directories='${root}/socket'
ssl=on
ssl_min_protocol_version='TLSv1.2'
ssl_cert_file='${root}/server.crt'
ssl_key_file='${root}/server.key'
password_encryption='scram-sha-256'
max_connections=16
shared_buffers='64MB'
max_wal_size='64MB'
min_wal_size='32MB'
log_line_prefix='NATIVE_TASK16 [%p] '
lc_messages='C'
log_min_error_statement='panic'
log_parameter_max_length_on_error=0
log_error_verbosity='terse'
statement_timeout='60s'
`;
    fs.writeFileSync(abs('data/postgresql.conf'),config);
    const ownerEnv = {
      PGHOST:'127.0.0.1', PGPORT:String(port), PGUSER:owner, PGPASSWORD:credentials.owner,
      PGSSLMODE:'verify-full', PGSSLROOTCERT:abs('ca.crt'), PGCONNECT_TIMEOUT:'5',
    };
    const sql = async (text, {database:target=database,extra,allowFailure}={}) =>
      runCommand('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','--dbname',target],
        {stdin:text,extra:{...ownerEnv,...extra},allowFailure});
    const jsonSql = async (text, options) => JSON.parse((await sql(text, options)).stdout.trim());
    enter('POSTMASTER');
    const logPath = abs('postgres.log');
    const logFd = fs.openSync(logPath,'wx+',0o600);
    const logIdentity = native.assertNativeTask16LogIdentity(logFd);
    try {
      pg = spawn('postgres',['-D',data],{cwd:root,env:baseEnv,stdio:['ignore',logFd,logFd]});
      lifetime = native.trackNativeTask16Child(pg);
      let ready = false;
      const deadline = Date.now()+30_000;
      while (lifetime.running() && Date.now()<deadline) {
        if (runCommand('pg_isready',['--host','127.0.0.1','--port',String(port),'--username',owner],
          {extra:{...ownerEnv,PGDATABASE:'postgres'},allowFailure:true,timeoutMs:5_000}).code === 0) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve,250));
      }
      need(ready, 'POSTMASTER_NOT_READY');
      postmaster = readPostmaster();
      need(Number(postmaster[0]) === pg.pid && postmaster[1] === data &&
        Number(postmaster[2]) >= started && Number(postmaster[3]) === port, 'POSTMASTER_IDENTITY');
      native.assertNativeTask16LogIdentity(logFd,logIdentity,logPath);
      receipt.listeners = native.assertNativeTask12LoopbackListeners(fs.readFileSync(logPath,'utf8'),pg.pid,port);
    } finally { fs.closeSync(logFd); }

    enter('TLS_SCRAM');
    const tls = await jsonSql(`SELECT jsonb_build_object('version',current_setting('server_version_num'),
      'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'client',host(inet_client_addr()),
      'server',host(inet_server_addr()),'port',inet_server_port(),
      'scram',(SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname=current_user));`,{database:'postgres'});
    need(equal(tls,{version:'160015',tls:true,client:'127.0.0.1',server:'127.0.0.1',port,scram:true}), 'TLS_SCRAM_IDENTITY');
    for(const extra of [{PGSSLROOTCERT:abs('wrong-ca.crt')},{PGHOST:'127.0.0.2',PGHOSTADDR:'127.0.0.1'},
      {PGSSLMODE:'disable'},{PGPASSWORD:randomBytes(48).toString('hex')}]) {
      need((await sql('SELECT 1;',{database:'postgres',extra,allowFailure:true})).code === 2, 'TLS_SCRAM_NEGATIVE');
    }
    receipt.tls = {...tls,wrongCaRejected:true,wrongSanRejected:true,noTlsRejected:true,wrongPasswordRejected:true};
    receipt.resources = {postmasterStartEpoch:Number(postmaster[2]),hbaSha256:hash(hba),configSha256:hash(config),caSha256:capture(abs('ca.crt')).sha256};
    if (probeOnly) {
      enter('PRISMA_TLS_PROBE');
      const probeUrl = new URL(`postgresql://${owner}@127.0.0.1:${port}/postgres`);
      probeUrl.password = credentials.owner;
      for (const [key,value] of Object.entries({sslmode:'require',sslaccept:'strict',sslcert:abs('ca.crt'),connect_timeout:'5'})) {
        probeUrl.searchParams.set(key,value);
      }
      write('probe.prisma', 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n');
      write('probe.sql', "SELECT CASE WHEN (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) THEN 1 ELSE 1/(pg_backend_pid()-pg_backend_pid()) END;");
      await command(process.execPath,[cli,'db','execute','--file',abs('probe.sql'),'--schema',abs('probe.prisma')],{
        timeoutMs:20_000,
        extra:{DATABASE_URL:probeUrl.toString(),PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'},
      });
      receipt.status = 'PRISMA_TLS_PROBE_PASSED';
      return;
    }
    await sql(`CREATE DATABASE ${database} OWNER ${owner} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`,{database:'postgres'});
    const locale = await jsonSql("SELECT jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',datlocprovider) FROM pg_database WHERE datname=current_database();");
    need(equal(locale,{encoding:'UTF8',collate:'C',ctype:'C',provider:'c'}),'INVALID_DB_LOCALE');
    receipt.migrationMaterials = (await installHistory(plan, root, port, credentials, sql, jsonSql, command, enter, fromHistory, stageTree, receipt)).materials;

    const roleIdentity = receipt.databaseIdentity;
    const endpoint = new URL(`postgresql://${owner}@127.0.0.1:${port}/${database}`);
    endpoint.password = credentials.owner;
    for (const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:'require',sslaccept:'strict',sslcert:abs('ca.crt'),connect_timeout:'5',pool_timeout:'5'})) endpoint.searchParams.set(key,value);
    const folder = abs('prefixes/combined'+release.count);
    let previous = 0;
    receipt.orderedTails = [];
    for (let size=271;size<=release.count;size++) {
      enter(`COMPOSED_MIGRATE_${size}`);
      native.stageCombined279Prefix(folder,ledger,size,previous,schema.bytes,row => capture(path.join(product,'migrations',row.name,'migration.sql')));
      await command(process.execPath,[cli,'migrate','deploy','--schema',path.join(folder,'schema.prisma')],
        {timeoutMs:180000,extra:{DATABASE_URL:endpoint.toString(),PRISMA_SCHEMA_ENGINE_BINARY:engine,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'}});
      const observed = await jsonSql(control.inspectSql());
      need(equal(observed.ledger,ledger.slice(0,size)) && ['database','databaseOid','namespaceOid','systemIdentifier','ownerOid','actorOid','sessionActor'].every(key => observed[key] === roleIdentity[key]), 'STAGED_TAIL_CONTINUITY');
      receipt.orderedTails.push({size,ledgerSha256:hash(JSON.stringify(observed.ledger))});
      if(release===outsideRelease && size>=288) {
        enter(`OUTSIDE_CATALOG_WITNESS_${size}`);
        const witness = await jsonSql(outsideWitnessSql(size));
        assertOutsideWitness(size, witness);
        (receipt.outsideWitnesses ??= []).push({size,witness});
      }
      previous = size;
    }
    enter('FINAL_UPWARD_WITNESS');
    const finalSql = `SELECT jsonb_build_object(
      'upward',public.jg_require_contract_direct_upward_source_v2() IS NOT NULL,
      'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
      'a08VoucherOwnerOnly', EXISTS (
        SELECT FROM pg_proc f
        WHERE f.oid=to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)')
          AND f.proowner=current_user::regrole::oid AND f.prosecdef
          AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
                AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
               FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)
      )${release.count >= 281 ? `,
      'registeredVoucherScopeClosed', NOT EXISTS (
        SELECT FROM public.jg_registered_payment_voucher_check_binding_v1
      ) AND (
        SELECT count(*)=2 AND bool_and(
          f.proowner=current_user::regrole::oid AND f.prosecdef
          AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
                  AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
                 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)
        ) FROM pg_proc f WHERE f.oid IN (
          to_regprocedure('public.jg_check_registered_payment_voucher_binding_v1(text,text,text)'),
          to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')
        )
      )` : ''}${release.count >= 282 ? `,
      'registeredVoucherReadScopeClosed', EXISTS (
        SELECT FROM pg_proc f
        WHERE f.oid=to_regprocedure('public.jg_read_registered_payment_voucher_binding_v1(text,text,text)')
          AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict AND f.provolatile='s'
          AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='${release.readBodySha256}'
          AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
                AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
               FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)
      )` : ''}${release.count>=283 ? `,
      'procurementArchiveScopeClosed', NOT EXISTS(SELECT FROM public.jg_general_procurement_archive_binding_v1)
      AND EXISTS(SELECT FROM pg_class c
        WHERE c.oid='public.jg_general_procurement_archive_binding_v1'::regclass
        AND c.relowner=current_user::regrole::oid
        AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner))
      AND EXISTS(SELECT FROM pg_proc f
        WHERE f.oid=to_regprocedure('public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)')
        AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict
        AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
           AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
         FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)),
      'procurementDedicatedGuard', EXISTS(SELECT FROM pg_trigger t
        JOIN pg_proc dedicated ON dedicated.oid=t.tgfoid
        JOIN pg_proc central ON central.oid=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')
        WHERE t.tgrelid='public."GeneralProcurement"'::regclass AND t.tgname='jg_efb_general_procurement_archive'
          AND t.tgenabled='O' AND t.tgtype=23 AND NOT t.tgisinternal
          AND dedicated.oid=to_regprocedure('public.jg_general_procurement_archive_exclusive_guard_v1()')
          AND dedicated.oid<>central.oid AND dedicated.proowner=central.proowner AND NOT dedicated.prosecdef
          AND encode(sha256(convert_to(central.prosrc,'UTF8')),'hex')='${release===outsideRelease ? outsideBodies["jg_enforce_exclusive_file_business_binding()"][1] : "c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b"}')
      ` : ''}${release.count>=284 ? `,
      'legacyExpenseScopeClosed', NOT EXISTS(SELECT FROM public.jg_legacy_procurement_expense_voucher_binding_v1)
      AND EXISTS(SELECT FROM pg_class c
        WHERE c.oid='public.jg_legacy_procurement_expense_voucher_binding_v1'::regclass AND c.relowner=current_user::regrole::oid
        AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner))
      AND EXISTS(SELECT FROM pg_proc f
        WHERE f.oid=to_regprocedure('public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text)')
        AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict
        AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
              AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
             FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)),
      'legacyExpenseDedicatedGuard', EXISTS(SELECT FROM pg_trigger t
        JOIN pg_proc dedicated ON dedicated.oid=t.tgfoid
        JOIN pg_proc central ON central.oid=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')
        WHERE t.tgrelid='public."ExpenseClaimPaymentExecution"'::regclass
          AND t.tgname='jg_efb_expense_claim_payment_execution_voucher'
          AND t.tgenabled='O' AND t.tgtype=23 AND NOT t.tgisinternal
          AND dedicated.oid=to_regprocedure('public.jg_legacy_procurement_expense_voucher_guard_v1()')
          AND dedicated.oid<>central.oid AND dedicated.proowner=central.proowner AND NOT dedicated.prosecdef
          AND encode(sha256(convert_to(central.prosrc,'UTF8')),'hex')='${release===outsideRelease ? outsideBodies["jg_enforce_exclusive_file_business_binding()"][1] : "c70ff547812539fabd41f9fb0dc65cbc79550992121cfd994a489895cb40fb8b"}')
      ` : ''}${release.count>=285 ? `,
      'projectArchiveExactSuccessor', EXISTS(SELECT FROM pg_proc p
        WHERE p.oid=to_regprocedure('public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)')
          AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fe997197590944906f20617401ab9a50dfc9db6799785a900929ded7ad6a3da8')
      ` : ''}${release.count>=286 ? `,
      'projectDraftScopeClosed', NOT EXISTS(SELECT FROM public.jg_project_scope_initial_contract_binding_v1)
      AND EXISTS(SELECT FROM pg_class c WHERE c.oid='public.jg_project_scope_initial_contract_binding_v1'::regclass
        AND c.relowner=current_user::regrole::oid AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner))
      AND EXISTS(SELECT FROM pg_proc f WHERE f.oid=to_regprocedure('public.jg_create_project_scope_initial_contract_version_v1(text,text,text)')
        AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict
        AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
              AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
         FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a))
      ,
      'projectDraftDeferredCompletion', EXISTS(SELECT FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid
        WHERE t.tgrelid='public.jg_project_scope_initial_contract_binding_v1'::regclass
          AND t.tgname='jg_project_scope_initial_contract_completion'
          AND t.tgenabled='O' AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint<>0
          AND f.oid=to_regprocedure('public.jg_require_project_scope_initial_contract_completion_v1()')
          AND f.prosecdef AND f.proowner=current_user::regrole::oid
          AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='af7d01ddcf8b2c29afac641506bf477800b889ae65968a92894532d784108d26'
          AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
              AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
            FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a))
, 'projectDraftFootprint', EXISTS(SELECT FROM pg_proc f
        WHERE f.oid=to_regprocedure('public.jg_guard_project_scope_initial_contract_footprint_v1()')
          AND f.proowner=current_user::regrole::oid AND f.prosecdef
          AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
          AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='d2acc77ff836ab4e6b3573273d64c3191da92cd05a352549614e3d2d25c4d7a1'
          AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
                AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
            FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a)
          AND (SELECT count(*)=5 FROM pg_trigger t WHERE t.tgfoid=f.oid)
          AND NOT EXISTS(SELECT FROM (VALUES
            ('public."Contract"'::regclass,'jg_project_scope_initial_contract_stable',27),
            ('public."ContractVersion"'::regclass,'jg_project_scope_initial_contract_version_stable',31),
            ('public."PaymentTermsVersion"'::regclass,'jg_project_scope_initial_contract_terms_stable',31),
            ('public."PaymentTermsStage"'::regclass,'jg_project_scope_initial_contract_terms_stage_empty',31),
            ('public."AuditLog"'::regclass,'jg_project_scope_initial_contract_audit_stable',31)
          ) AS e(relation_id,trigger_name,trigger_type)
          WHERE NOT EXISTS(SELECT FROM pg_trigger t
            WHERE t.tgrelid=e.relation_id AND t.tgname=e.trigger_name AND t.tgtype=e.trigger_type
              AND t.tgfoid=f.oid AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgconstraint=0
              AND t.tgnargs=0 AND t.tgattr=''::int2vector
              AND substring(pg_get_triggerdef(t.oid,true) FROM ' WHEN [(](.*)[)] EXECUTE FUNCTION ') IN (
                'SESSION_USER = ''project_business_scope_runtime''::name',
                'SESSION_USER = ''project_business_scope_runtime''::text',
                'SESSION_USER = ''project_business_scope_runtime'''
              ))))
      ` : ''}${release.count>=287 ? `,
      'projectLegacyReviewClosed', NOT EXISTS(SELECT FROM public.jg_project_scope_legacy_review_binding_v1)
      AND EXISTS(SELECT FROM pg_class c WHERE c.oid='public.jg_project_scope_legacy_review_binding_v1'::regclass
        AND c.relowner=current_user::regrole::oid AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner))
      AND EXISTS(SELECT FROM pg_proc f WHERE f.oid=to_regprocedure('public.jg_touch_project_scope_legacy_review_v1(text,text,text,timestamptz)')
        AND f.proowner=current_user::regrole::oid AND f.prosecdef AND f.proisstrict
        AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='d319197373a0eed2f41840c6db60dbca9c64647fd3e0f7baaa77aa17adecda3c'
        AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
          FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a))
      ` : ''}
    );`;
    const final = await jsonSql(finalSql);
    const expectedFinal = {upward:true,tls:true,a08VoucherOwnerOnly:true,
      ...(release.count >= 281 ? {registeredVoucherScopeClosed:true} : {}),
      ...(release.count >= 282 ? {registeredVoucherReadScopeClosed:true} : {}),
      ...(release.count>=283 ? {procurementArchiveScopeClosed:true,procurementDedicatedGuard:true} : {}),
      ...(release.count>=284 ? {legacyExpenseScopeClosed:true,legacyExpenseDedicatedGuard:true} : {}),
      ...(release.count>=285 ? {projectArchiveExactSuccessor:true} : {}),
      ...(release.count>=286 ? {projectDraftScopeClosed:true,projectDraftDeferredCompletion:true,projectDraftFootprint:true} : {}),
      ...(release.count>=287 ? {projectLegacyReviewClosed:true} : {})};
    if (release===outsideRelease && !equal(final,expectedFinal)) {
      receipt.finalWitnessMismatch = finalWitnessMismatch(final,expectedFinal);
    }
    need(equal(final,expectedFinal), 'FINAL_UPWARD_WITNESS');
    receipt.finalWitness = final;
    receipt.status = 'INSTALLED_'+release.count+'_NOT_BUSINESS_ADMISSION';
    if (consume) {
      let active = true;
      const onlyWhileOwned = () => {
        need(active && lifetime.running() && equal(readPostmaster(), postmaster), 'OWNED_'+release.count+'_CALLBACK_EXPIRED');
      };
      const connection = (role, password) => {
        const url = new URL(endpoint);
        url.username = role;
        url.password = password;
        return url.toString();
      };
      const context = Object.freeze({
        ...(release.count === 280 ? {candidate:release.sha} :
          {candidateTree:release.tree,sourceBaseSha:stableRelease.sha}),
        runId, database, workDir:root,
        ownerUrl:connection(owner, credentials.owner),
        runtimeUrl:connection('jg_task01_runtime', credentials.runtime),
        observerUrl:connection('jg_task01_observer', credentials.observer),
        sql:statement => { onlyWhileOwned(); return sql(statement); },
        readPostgresLog:() => { onlyWhileOwned(); return fs.readFileSync(logPath, 'utf8'); },
      });
      enter('EXACT_'+release.count+'_CONSUMER');
      for (const [key,role] of [['runtime','jg_task01_runtime'], ['observer','jg_task01_observer']]) {
        const observed = await jsonSql(`SELECT jsonb_build_object(
          'database',current_database(),'role',current_user,'sessionRole',session_user,
          'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
          'client',host(inet_client_addr()),'server',host(inet_server_addr()),
          'serverPort',inet_server_port(),
          'ledgerRead',has_table_privilege(current_user,'public._prisma_migrations','SELECT')
        );`, {extra:{PGUSER:role,PGPASSWORD:credentials[key]}});
        need(equal(observed,{database,role,sessionRole:role,tls:true,client:'127.0.0.1',server:'127.0.0.1',
          serverPort:port,ledgerRead:false}), 'OWNED_'+release.count+'_CONSUMER_ROLE');
      }
      try {
        await consume(context);
        onlyWhileOwned();
      } finally {
        active = false;
      }
      const afterConsumer = await jsonSql(control.inspectSql());
      need(equal(afterConsumer.ledger,ledger) && ['database','databaseOid','namespaceOid','systemIdentifier','ownerOid','actorOid','sessionActor'].every(key => afterConsumer[key] === roleIdentity[key]), 'CONSUMER_DATABASE_CONTINUITY');
      need(equal(await jsonSql(finalSql), final), 'CONSUMER_PROTECTED_CATALOG_CONTINUITY');
      receipt.business = 'CALLBACK_COMPLETED';
    }
  } finally {
    receipt.cleanup = 'STARTED';
    if (pg && lifetime?.running()) {
      const stopped = runCommand('pg_ctl',['-D',data,'-w','-t','15','-m','fast','stop'],{timeoutMs:20_000,allowFailure:true});
      need(stopped.code === 0 && !fs.existsSync(path.join(data,'postmaster.pid')), 'POSTMASTER_CLEANUP');
    }
    receipt.cgroupPids.after=fs.readFileSync('/sys/fs/cgroup/pids.events','utf8').trim();
    receipt.cleanup = 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT';
  }
}

async function installHistory(plan,root,port,credentials,sql,jsonSql,command,enter,fromHistory,stageTree,receipt){
const {runId}=plan;
const migration=await migrateNativeTask16(plan,root,port,credentials.owner,sql,jsonSql,command,enter,fromHistory);
enter('ROLES');const roles=fromHistory('./task16-current259-role-provision.cjs');
  const roleIdentity=await jsonSql(`SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port()) FROM pg_database d WHERE d.datname=current_database();`);
  need(roleIdentity.ownerOid==='10'&&roleIdentity.actorOid==='10'&&roleIdentity.tls===true&&roleIdentity.clientAddress==='127.0.0.1'&&roleIdentity.serverAddress==='127.0.0.1'&&roleIdentity.serverPort===port,'NATIVE_DIRECT_OWNER');
  const roleScope=JSON.stringify({identity:roleIdentity,app:{name:migration.plan.appName,oid:migration.setup.appOid,nonce:migration.plan.nonce},ledger:plan.source.witness.profile.ledger,competition:false});
  const before=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,null))).stdout;roles.parseNativeTask16RoleRead(roleScope,before,'before');
  const staged=(await sql(roles.renderNativeTask16RoleInstall(roleScope,before,{runtime:credentials.runtime,observer:credentials.observer}))).stdout;const stagedRow=roles.parseNativeTask16RoleRead(roleScope,staged,'install',before);
  const committed=(await sql(roles.renderNativeTask16RoleRead(migration.setup.appOid,stagedRow.writeXid))).stdout;const roleRow=roles.parseNativeTask16RoleRead(roleScope,committed,'committed',before,staged);
  need(roleRow.state.roles.length===9,'NATIVE_DIRECT_NINE_ROLES');
  const provisioned={status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',executionAllowed:false,nativeAdmission:false,sourceSha:stageSha,runId,databaseIdentity:roleIdentity,ordinary:roleRow.state.app,roles:roleRow.state.roles,commitXid:stagedRow.writeXid,databaseAcl:{before:JSON.parse(before).state.databases,after:roleRow.state.databases}};
 const run=async(label,statement)=>{enter(label);return (await sql(statement)).stdout;};
 const source={candidateSha:stageSha,sourceSealSha256:plan.source.witness.profile.sealSha256,profile:plan.source.witness.profile,tree:stageTree};
 const archive=fromHistory('./task16-current259-archive-install.cjs').beginNativeTask12ArchiveProtocol(JSON.stringify({source,completion:provisioned,serverPort:port}));
 const seven=archive.acceptBefore(await run('ARCHIVE_BEFORE',archive.beforeSql));
 const archiveWriter=seven.acceptBefore(await run('ARCHIVE_SEVEN_BEFORE',seven.beforeSql));
 const archiveReader=archiveWriter.acceptWritten(await run('ARCHIVE_SEVEN_WRITE',archiveWriter.sql));
 const archiveResult=archiveReader.acceptCommitted(await run('ARCHIVE_SEVEN_COMMITTED',archiveReader.sql));
 receipt.databaseIdentity=roleIdentity;
 receipt.archive={roles:roleRow.state.roles.length,roleCommitXid:stagedRow.writeXid,installXid:archiveResult.installXid,bindingSha256:archiveResult.bindingSha256,upwardClosureSha256:archiveResult.upwardClosureSha256,sevenCatalogSha256:archiveResult.sevenCatalogSha256};
 return migration;
}

function readMetadata(file, sizeLimit) {
  const stat = fs.lstatSync(file);
  need(stat.isFile() && stat.size <= sizeLimit, 'SOURCE_ADMISSION_METADATA_FILE');
  return fs.readFileSync(file,'utf8');
}

function readSourceAdmission(file) {
  const input = JSON.parse(readMetadata(file,2*1024*1024));
  if (equal(input, {mode:fullMode})) return input;
  need(input && equal(Object.keys(input).sort(), ['mode','subsetManifest','witness']) &&
    input.mode === sealedMode && typeof input.subsetManifest === 'string' &&
    hash(input.subsetManifest) === subsetManifestSha, 'UNEXPECTED_SUBSET_MANIFEST');
  need(Array.isArray(input.witness) && input.witness.length === 4134 &&
    hash(JSON.stringify(input.witness)) === historicalSeal, 'UNEXPECTED_HISTORICAL_METADATA');
  const subset = JSON.parse(input.subsetManifest);
  need(subset.historical.commit === stageSha && subset.historical.tree === stageTree &&
    subset.historical.fullSeal === historicalSeal && subset.release.commit === subsetReleaseSha &&
    subset.release.tree === subsetReleaseTree && subset.selected.length === 318, 'UNEXPECTED_SUBSET_BINDING');
  const witnessByPath = new Map(input.witness.map(row => [row.path,row]));
  need(witnessByPath.size === 4134, 'DUPLICATE_HISTORICAL_PATH');
  for (const {path:file,mode,oid,sha256} of subset.selected) {
    need(equal(witnessByPath.get(file), {path:file,mode,oid,sha256}), 'SUBSET_WITNESS_MISMATCH');
  }
  return {mode:sealedMode, selected:subset.selected};
}

function verifyMaterialBytes(bytes, row) {
  const oid = createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  need(bytes.length === row.bytes && oid === row.oid && hash(bytes) === row.sha256, 'SUBSET_BLOB_MISMATCH');
}

function verifyClosedFiles(root, selected, allowedDirectories = new Set()) {
  need(fs.lstatSync(root).isDirectory(), 'INVALID_SUBSET_DIRECTORY');
  const files = new Map(selected.map(row => [row.path,row]));
  const directories = new Set();
  for (const {path:file} of selected) {
    let parent = path.posix.dirname(file);
    while (parent !== '.') {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const relative = prefix + entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (allowedDirectories.has(relative)) continue;
        need(directories.has(relative), 'UNDECLARED_SUBSET_DIRECTORY');
        visit(target, relative + '/');
        continue;
      }
      const row = files.get(relative);
      need(row && entry.isFile(), 'UNDECLARED_SUBSET_FILE');
      const stat = fs.lstatSync(target);
      need((stat.mode & 0o111) === (row.mode === '100755' ? 0o111 : 0), 'SUBSET_FILE_MODE_MISMATCH');
      verifyMaterialBytes(fs.readFileSync(target), row);
      files.delete(relative);
    }
  };
  visit(root);
  need(files.size === 0, 'MISSING_SUBSET_FILE');
}

function materializeSeal(bundle, release, destination, admissionFile) {
  need(fs.readdirSync(destination).length === 0, 'NONEMPTY_SUBSET_DESTINATION');
  const input = {
    mode:sealedMode,
    subsetManifest:readMetadata(path.join(bundle,'manifest.json'),256*1024),
    witness:JSON.parse(readMetadata(path.join(bundle,'witness.json'),1024*1024)),
  };
  fs.writeFileSync(admissionFile, JSON.stringify(input)+'\n', {flag:'wx',mode:0o644});
  const {selected} = readSourceAdmission(admissionFile);
  const readGit = (...args) => execFileSync('git', ['-C', release, ...args], {maxBuffer:16*1024*1024});
  need(readGit('rev-parse', releaseSha+'^{tree}').toString().trim() === releaseTree, 'UNEXPECTED_RELEASE_TREE');
  const overlays = selected.filter(row => row.from === 'overlay');
  need(overlays.length === 8, 'UNEXPECTED_OVERLAY_COUNT');
  verifyClosedFiles(path.join(bundle,'overlay'), overlays);
  for (const row of selected) {
    const bytes = row.from === 'overlay' ? fs.readFileSync(path.join(bundle,'overlay',row.path)) :
      readGit('show', releaseSha+':'+row.path);
    verifyMaterialBytes(bytes, row);
    const file = path.join(destination,row.path);
    fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o755});
    fs.writeFileSync(file,bytes,{flag:'wx',mode:row.mode==='100755'?0o755:0o644});
  }
  verifyClosedFiles(destination, selected);
  return historicalSeal;
}

function sourceSeal(root, treeFile) {
  const tree = fs.readFileSync(treeFile,'utf8').split('\0').filter(Boolean);
  need(tree.length > 100, 'INCOMPLETE_HISTORICAL_TREE');
  const rows = tree.map(row => {
    const [meta, relative] = row.split('\t');
    const [mode, type, oid] = meta.split(' ');
    need(type === 'blob' && ['100644','100755'].includes(mode)
      && relative && !path.isAbsolute(relative) && path.normalize(relative) === relative
      && !relative.startsWith('../'), 'INVALID_HISTORICAL_BLOB');
    const file = path.join(root,relative);
    const {bytes,sha256} = capture(file);
    const observed = createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    need(observed === oid, 'HISTORICAL_BLOB_MISMATCH');
    return {path:relative,mode,oid,sha256};
  }).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return hash(JSON.stringify(rows));
}

if (require.main === module && process.argv[2] === '--source-seal') {
  need(process.argv.length === 5, 'SOURCE_SEAL_ARGUMENTS');
  console.log(sourceSeal(process.argv[3],process.argv[4]));
} else if (require.main === module && process.argv[2] === '--materialize-sealed') {
  need(process.argv.length === 7, 'SEALED_SOURCE_ARGUMENTS');
  console.log(materializeSeal(...process.argv.slice(3)));
} else if (require.main === module && process.argv[2] === '--verify-sealed') {
  need(process.argv.length === 5, 'SEALED_SOURCE_ARGUMENTS');
  const {mode,selected} = readSourceAdmission(process.argv[4]);
  need(mode === sealedMode, 'UNEXPECTED_SOURCE_ADMISSION');
  verifyClosedFiles(process.argv[3], selected, installedDependencyRoots);
  console.log(JSON.stringify({mode,metadataRows:4134,verifiedFiles:selected.length,sourceSeal:historicalSeal}));
} else if (require.main === module && ['--describe-281','--describe-282'].includes(process.argv[2])) {
  need(process.argv.length === 3, 'INSTALLER_ARGUMENTS');
  const release = process.argv[2] === '--describe-282' ? readSuccessorRelease : successorRelease;
  process.stdout.write(release.tree+'\n');
} else if (require.main === module) {
  const mode = process.argv[2];
  need(process.argv.length <= 3 && [undefined,'--tls-probe','--prove-owned-handoff','--contract-template-ci','--contract-settlement-ci','--install-281','--install-282'].includes(mode), 'INSTALLER_ARGUMENTS');
  const release = mode === '--install-282' ? readSuccessorRelease :
    mode === '--install-281' ? successorRelease : stableRelease;
  const handoff = mode === '--prove-owned-handoff';
  const contractTemplate = mode === '--contract-template-ci';
  const contractSettlement = mode === '--contract-settlement-ci';
  const contract = contractTemplate || contractSettlement;
  const purpose = handoff ? 'TASK12_LINUX_B6_B7_280_HANDOFF_CHECK' :
    contractTemplate ? 'TASK12_LINUX_B6_B7_280_CONTRACT_TEMPLATE_CI' :
    contractSettlement ? 'TASK12_LINUX_B6_B7_280_CONTRACT_SETTLEMENT_CI' : 'TASK12_LINUX_B6_B7_'+release.count+'_INSTALLER_ONLY';
  const releaseIdentity = release.count === 280 ? {releaseSha:release.sha,releaseTree:release.tree} :
    {releaseTree:release.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'};
  const receipt = {schemaVersion:1,purpose,...releaseIdentity,stages:[],
    status:'STOPPED',business:'NOT_ENTERED',executionAllowed:false};
  let expiredSql;
  async function proveHandoff({candidate,runId,database,ownerUrl,runtimeUrl,observerUrl,sql}) {
    need(candidate === releaseSha && database === 'jg_task01_' + runId.replaceAll('-',''), 'HANDOFF_CANDIDATE');
    for (const [value,role] of [[ownerUrl,owner],[runtimeUrl,'jg_task01_runtime'],[observerUrl,'jg_task01_observer']]) {
      const url = new URL(value);
      need(url.username === role && url.hostname === '127.0.0.1' && url.pathname === '/' + database &&
        url.searchParams.get('sslmode') === 'require' && url.searchParams.get('sslaccept') === 'strict', 'HANDOFF_ENDPOINT');
    }
    const observed = JSON.parse((await sql(`SELECT jsonb_build_object(
      'database',current_database(),'owner',current_user,'qualified',public.jg_require_contract_direct_upward_source_v2() IS NOT NULL
    );`)).stdout);
    need(equal(observed,{database,owner,qualified:true}), 'HANDOFF_CATALOG');
    expiredSql = sql;
  }
  const consume = contract ? async context => {
    receipt.contract = await require('./contract-ci.cjs').verify(mode,context);
  } : handoff ? proveHandoff : undefined;
  installer(receipt, mode === '--tls-probe', consume, release).then(async () => {
    if (contract) receipt.status = contractTemplate ? 'CONTRACT_TEMPLATE_CI_PASSED' : 'CONTRACT_SETTLEMENT_CI_PASSED';
    if (!handoff) return;
    let rejected = false;
    try {
      await expiredSql('SELECT 1;');
    } catch (error) {
      if (error.message !== 'OWNED_'+release.count+'_CALLBACK_EXPIRED') throw error;
      rejected = true;
    }
    need(rejected && receipt.business === 'CALLBACK_COMPLETED', 'HANDOFF_LIFETIME');
    receipt.business = 'NOT_ENTERED';
    receipt.status = 'OWNED_280_HANDOFF_PROVED';
  }).catch(error => {
    receipt.status='STOPPED';
    receipt.failure = {
      stage:receipt.stages.at(-1) ?? 'INPUTS', code:/^[A-Z0-9_]+$/u.test(error.code ?? error.message) ? error.code ?? error.message : 'UNCLASSIFIED_INSTALLER_FAILURE',
      command:error.command,exit:error.exit,signal:error.signal,executionError:error.executionError,
      sqlstate:error.sqlstate,prismaCode:error.prismaCode,tlsDiagnostic:error.tlsDiagnostic,
    };
    process.exitCode=1;
  }).finally(() => process.stdout.write(JSON.stringify(receipt)+'\n'));
}
function withInstalled280(receipt, consume) {
  need(receipt && Array.isArray(receipt.stages) && typeof consume === 'function', 'OWNED_280_CALLBACK_ARGUMENTS');
  return installer(receipt, false, consume);
}

function withInstalled281(receipt, consume) {
  need(receipt && Array.isArray(receipt.stages) && typeof consume === 'function', 'OWNED_281_CALLBACK_ARGUMENTS');
  Object.assign(receipt,{
    releaseTree:successorRelease.tree, sourceBaseSha:stableRelease.sha, sourceKind:'UNCOMMITTED_EXACT_GIT_TREE',
  });
  return installer(receipt, false, consume, successorRelease);
}

function withInstalled282(receipt, consume) {
  need(receipt && Array.isArray(receipt.stages) && typeof consume === 'function', 'OWNED_282_CALLBACK_ARGUMENTS');
  const release = readSuccessorRelease;
  Object.assign(receipt,{
    releaseTree:release.tree, sourceBaseSha:stableRelease.sha, sourceKind:'UNCOMMITTED_EXACT_GIT_TREE',
  });
  return installer(receipt, false, consume, release);
}

module.exports = { verifyInputs, withInstalled280, withInstalled281, withInstalled282 };

module.exports.withProcurement282=(receipt,consume)=>installer(receipt,false,consume,Object.freeze({...readSuccessorRelease,procurementScope:true}));

module.exports.withProcurement283=(receipt,consume)=>{
  Object.assign(receipt,{releaseTree:procurementArchiveRelease.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,procurementArchiveRelease);
};

module.exports.withLegacyProcurementExpense284=(receipt,consume)=>{
  Object.assign(receipt,{releaseTree:legacyExpenseRelease.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,legacyExpenseRelease);
};

module.exports.withProjectBusinessSignature284=(receipt,consume)=>{
  const release=Object.freeze({...legacyExpenseRelease,procurementScope:false,projectBusinessScope:true});
  Object.assign(receipt,{releaseTree:release.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,release);
};

module.exports.withProjectBusinessArchive285=(receipt,consume)=>{
  const release=projectArchiveRelease;
  Object.assign(receipt,{releaseTree:release.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,release);
};

module.exports.withProjectScopeDraft286=(receipt,consume)=>{
  const release=projectDraftRelease;
  Object.assign(receipt,{releaseTree:release.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,release);
};

module.exports.withProjectScopeLegacyReview287=(receipt,consume)=>{
  const release=projectLegacyReviewRelease;
  Object.assign(receipt,{releaseTree:release.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,consume,release);
};

module.exports.verifyOutside289Inputs = (historical, product, seal) => verifyPinnedInputs(historical, product, seal, outsideRelease);
module.exports.withOutside289InstallOnly = receipt => {
  const {contract289, verifyMaterialized} = require('./checkout.cjs');
  verifyMaterialized('/qualification/product', contract289);
  Object.assign(receipt,{releaseTree:outsideRelease.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,undefined,outsideRelease);
};
module.exports.outsideWitnessSql = outsideWitnessSql;
module.exports.assertOutsideWitness = assertOutsideWitness;

module.exports.finalWitnessMismatch = finalWitnessMismatch;

module.exports.withOutside289Settlement = receipt => {
  const {contract289, verifyMaterialized} = require('./checkout.cjs');
  verifyMaterialized('/qualification/product', contract289);
  Object.assign(receipt,{releaseTree:outsideRelease.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,async context => {
    need(context.candidateTree===outsideRelease.tree,'OWNED_289_SETTLEMENT_SOURCE');
    receipt.settlement = require('./contract-ci.cjs').verify('--contract-settlement-ci',context);
    assertOutsideWitness(289,JSON.parse((await context.sql(outsideWitnessSql(289))).stdout.trim()));
  },outsideRelease);
};

function withFreshOutside289(receipt, purpose, consume) {
  const {contract289, verifyMaterialized} = require('./checkout.cjs');
  verifyMaterialized('/qualification/product', contract289);
  Object.assign(receipt,{purpose,releaseTree:outsideRelease.tree,sourceBaseSha:stableRelease.sha,sourceKind:'UNCOMMITTED_EXACT_GIT_TREE'});
  return installer(receipt,false,async context => {
    need(context.candidateTree===outsideRelease.tree,'OWNED_289_FRESH_SOURCE');
    const verify = async () =>
      assertOutsideWitness(289,JSON.parse((await context.sql(outsideWitnessSql(289))).stdout.trim()));
    await verify();
    await consume(context,receipt,runCommand,need,equal);
    await verify();
    receipt.sameInstancePostConsume=true;
  },outsideRelease);
}

module.exports.withOutside289FundExecution = receipt =>
  withFreshOutside289(receipt,'FUND_EXECUTION_V7_289_CI',require('./fresh-owner289.cjs').fundExecution);
module.exports.withOutside289Invoice = receipt =>
  withFreshOutside289(receipt,'INVOICE_LEDGER_POL260_289_CI',require('./fresh-owner289.cjs').invoice);
module.exports.withOutside289Pol279 = receipt =>
  withFreshOutside289(receipt,'NECESSARY_EXPENSE_RESERVE_POL279_289_CI',require('./fresh-owner289.cjs').pol279);

module.exports.withOutside289RemainingDirectCapacity = receipt =>
  withFreshOutside289(receipt,'REMAINING_DIRECT_PAYMENT_CAPACITY_289_CI',
    require('./remaining-direct-capacity.cjs').consume);

module.exports.withOutside289RemainingOwner = (receipt, lane) => {
  const runner = require('./remaining-owner.cjs');
  runner.mode(lane);
  return withFreshOutside289(receipt,'REMAINING_OWNER_289_CI',
    (context, output) => runner.consume(context, output, lane));
};
