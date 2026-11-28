'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');

const name = '20260802010000_project_financing_quota_request_idempotency';
const checksum = 'd3d0d07a6cc9a49da1cca1478822a873fad7c7324b9d189e2a55a4d3f57bfe61';
const markers=Object.freeze({
  duplicate:'project_financing_quota_duplicate_attachment',
  cross_business:'project_financing_quota_cross_business_attachment',
  replacement_child:'project_financing_quota_cross_business_attachment',
  replacement_parent:'project_financing_quota_cross_business_attachment',
});
const rollbackMarker = Object.freeze({name, sha256:checksum, finished:false, rolledBack:true});
function hasPostgresMarker(delta, kind) {
  const pattern=kind==='duplicate'
    ? /^NATIVE_TASK16 \[\d+\] (?:[A-Z0-9]+ )?ERROR: +(?:23514: +)?project_financing_quota_duplicate_attachment *$/mu
    : /^NATIVE_TASK16 \[\d+\] (?:[A-Z0-9]+ )?ERROR: +(?:23514: +)?project_financing_quota_cross_business_attachment fileId=pfq-pre115-attachment *$/mu;
  return Object.hasOwn(markers,kind)&&pattern.test(delta);
}

function markerEvidence(ledgerMarker, observed) {
  const sources = {
    markerInFailedLedger:ledgerMarker === true,
    markerInPrismaStdout:observed.markerInPrismaStdout === true,
    markerInPrismaStderr:observed.markerInPrismaStderr === true,
    markerInPostgres:observed.markerInPostgres === true,
  };
  return {sources,originalMarker:Object.values(sources).some(Boolean)};
}

const materialHash='fb27ad2ca98929b53f262d9a42ef9df655239e4b9248f6fd0679d912dbb2e8db';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, label) => { if (!ok) throw new Error('PFQ_CROSS_ATTACHMENT_'+label); };

function material(kind) {
  need(Object.hasOwn(markers,kind),'MATERIAL_SCOPE');
  const bytes=fs.readFileSync(path.join(__dirname,'task12-pfq-recovery.json'));
  need(hash(bytes)===materialHash,'MATERIAL');
  const fixture=JSON.parse(bytes)[kind];
  need(fixture?.case===kind&&fixture.marker===markers[kind],'MATERIAL_SCOPE');
  return fixture;
}

function expectedLedger(completed, size) {
  need(completed[114]?.name === name && completed[114].sha256 === checksum &&
    completed.every(row => row.finished === true && row.rolledBack === false), 'LEDGER_SOURCE');
  const ledger = completed.slice(0,size);
  return size < 115 ? ledger : [...ledger.slice(0,114), rollbackMarker, ...ledger.slice(114)];
}

function assertLedger(observed, completed, size) {
  need(equal(observed, expectedLedger(completed,size)), 'LEDGER');
}

function bindArchiveLedger(sql, completed) {
  const expected = "'" + JSON.stringify(completed) + "'::jsonb";
  const replacement = "'" + JSON.stringify(expectedLedger(completed,completed.length)) + "'::jsonb";
  const anchor = /ORDER BY migration_name COLLATE "C"\) FROM public\._prisma_migrations\)(\s+IS DISTINCT FROM )/gu;
  const patches = [...sql.matchAll(anchor)].map(match => {
    const start=match.index, end=start+match[0].length;
    need(sql.startsWith(expected,end),'ARCHIVE_LEDGER_EXPECTED');
    return [start,end+expected.length,match[1]];
  });
  need(patches.length > 0 && patches.length <= 4,'ARCHIVE_LEDGER_ANCHOR');
  for(const [start,end,comparison] of patches.reverse()) {
    sql=sql.slice(0,start)+'ORDER BY migration_name COLLATE "C",started_at,id) FROM public._prisma_migrations)'+
      comparison+replacement+sql.slice(end);
  }
  return sql;
}

const tailModule = historical => require(path.join(historical,'local-staged-tail-qualification.cjs'));

async function recover({ledger,deploy,resolve,sql,jsonSql,inspect,enter,identity,kind}) {
  const input=material(kind);
  const prefix=114;
  const terminal=115;
  need(ledger[115]?.name==='20260802020000_project_financing_quota_termination_idempotency'&&
    ledger[115].sha256==='a713473b527c5ba6201f35e11f27a54f62a15e72db5bc65a1f84094a0a276b03','TERMINATION_SOURCE');
  need(input.case===kind&&input.prefix===prefix&&input.request===name,'MATERIAL_SCOPE');
  need(ledger[prefix-1]?.name==='20260728161000_spot_procurement_application_revision_status','PREFIX');
  await deploy(prefix);
  const pre=await jsonSql(inspect);
  const binding=identity(pre);
  assertLedger(pre.ledger,ledger,prefix);
  enter('PFQ_CROSS_ATTACHMENT_ORIGINAL_SEED');
  for(const batch of input.seed) await sql(batch);
  const observeBinding=`SELECT
    COALESCE((SELECT "signatureFileId" FROM public."User" WHERE id='pfq-pre115-user'),'-'),
    COALESCE((SELECT "supersedesFileObjectId" FROM public."FileObject" WHERE id='pfq-pre115-attachment'),'-'),
    COALESCE((SELECT "supersedesFileObjectId" FROM public."FileObject" WHERE id='pfq-pre115-replacement'),'-');`;
  const originalBinding={
    cross_business:'pfq-pre115-attachment|-|-',
    replacement_child:'-|pfq-pre115-replacement|-',
    replacement_parent:'-|-|pfq-pre115-attachment',
  }[kind];
  if(kind!=='duplicate') need((await sql(observeBinding)).stdout.trim()===originalBinding,'EXACT_ORIGINAL_BINDING');
  const before=(await sql(input.snapshot)).stdout.trim();
  need(/^[a-f0-9]{32}(\|[a-f0-9]{32}){2}$/u.test(before),'SNAPSHOT');
  const failure=await deploy(terminal,undefined,true);
  const rowsSql=`SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'id',id,'checksum',checksum,'startedAt',started_at,'finished',finished_at IS NOT NULL,
     'rolledBackAt',rolled_back_at,'steps',applied_steps_count,
     'marker',position('${markers[kind]}' in COALESCE(logs,''))>0,
     'logsSha256',CASE WHEN logs IS NOT NULL THEN encode(sha256(convert_to(logs,'UTF8')),'hex') END)
     ORDER BY started_at,id),'[]'::jsonb)
    FROM public._prisma_migrations WHERE migration_name='${name}';`;
  const [failed,...unexpected]=await jsonSql(rowsSql);
  const failedState=await jsonSql(inspect);
  const after=(await sql(input.snapshot)).stdout.trim();
  const rollback=(await sql(input.rollback)).stdout.trim().split('\n').map(line=>line.trim());
  const {sources,originalMarker}=markerEvidence(failed?.marker,failure);
  const observation={
    checksumMatched:failed?.checksum===checksum,expectedRow:unexpected.length===0&&
      typeof failed?.id==='string'&&/^[a-f0-9-]{36}$/u.test(failed.id)&&typeof failed.startedAt==='string',
    exactOriginalMarker:originalMarker,noPartialObjects:equal(rollback,['0','1|0|0']),
    businessUnchanged:before===after,unapplied:failed?.steps===0&&failed.finished===false&&failed.rolledBackAt===null,
    sameDatabase:equal(identity(failedState),binding),
    exactFailedLedger:equal(failedState.ledger,[...ledger.slice(0,prefix),{...rollbackMarker,rolledBack:false}]),
  };
  if(!Object.values(observation).every(Boolean)) {
    throw Object.assign(new Error('PFQ_CROSS_ATTACHMENT_ORIGINAL_FAILURE'),{
      recoveryObservation:{...observation,...sources,prismaCode:failure.prismaCode},
    });
  }
  enter('PFQ_CROSS_ATTACHMENT_ORIGINAL_REMEDIATION');
  await sql(input.repair);
  if(kind!=='duplicate') need((await sql(observeBinding)).stdout.trim()==='-|-|-','EXACT_ORIGINAL_REPAIR');
  enter('PFQ_CROSS_ATTACHMENT_PRISMA_RESOLVE');
  await resolve(name);
  const resolved=await jsonSql(rowsSql);
  need(resolved.length===1&&typeof resolved[0].rolledBackAt==='string'&&
    equal({...resolved[0],rolledBackAt:null},failed),'RESOLVED_ORIGINAL_ROW');
  await deploy(terminal);
  const fixed=await jsonSql(inspect);
  need(equal(identity(fixed),binding),'IDENTITY');
  assertLedger(fixed.ledger,ledger,terminal);
  const witness=await jsonSql(rowsSql);
  need(witness.length===2&&equal(witness[0],resolved[0])&&witness[1].id!==failed.id&&
    witness[1].checksum===checksum&&witness[1].finished===true&&witness[1].rolledBackAt===null,'RETRY_LEDGER');
  const verify=async()=>{
    need(equal(await jsonSql(rowsSql),witness),'ROW_IDENTITY');
    need((await sql(input.historicalNullReadback)).stdout.trim()==='1|1','HISTORICAL_NULL');
  };
  await verify();
  return Object.freeze({binding,verify,receipt:Object.freeze({
    kind,prefix,terminal,checksum,originalMarker,...sources,prismaCode:failure.prismaCode,
    sameDatabase:true,...(kind!=='duplicate'&&{caseSpecificBindingConfirmed:true,caseSpecificBindingCleared:true}),unapplied:true,businessUnchanged:true,noPartialObjects:true,PrismaResolve:true,
    originalRowPreserved:true,rolledBackRowCount:1,activeFinishedRowCount:1,historicalNull:true,
  })});
}

module.exports={expectedLedger,assertLedger,bindArchiveLedger,tailModule,recover,hasPostgresMarker};
